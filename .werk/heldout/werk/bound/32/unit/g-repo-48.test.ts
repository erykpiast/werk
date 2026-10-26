import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
);

/** Claude Code rule `Bash(prefix:*)` matches a command that starts with prefix. */
function matches(rule: string, command: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const body = m[1] as string;
  if (body.endsWith(":*")) {
    const prefix = body.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === body;
}
const any = (rules: string[] | undefined, command: string) =>
  (rules ?? []).some((r) => matches(r, command));
/** Claude Code precedence: deny, then ask, then allow, whatever file a rule came from. */
function decide(command: string, personalAllow: string[] = []) {
  const p = settings.permissions;
  if (any(p.deny, command)) return "deny";
  if (any(p.ask, command)) return "ask";
  if (any([...(p.allow ?? []), ...personalAllow], command)) return "allow";
  return "ask";
}

describe("48.1 make runs freely, accept/remove/restore ask", () => {
  const personal = ["Bash(werk:*)", "Bash(*)", "Bash(bun src/cli.ts:*)"];
  test("make targets are allowed with no question", () => {
    for (const t of ["lint", "typecheck", "test", "e2e", "check", "smoke"]) {
      expect(decide(`make ${t}`)).toBe("allow");
      expect(decide(`make ${t}`, personal)).toBe("allow");
    }
  });
  test("accept, remove, restore ask even with a personal allow of every werk command", () => {
    for (const verb of ["accept", "remove", "restore"]) {
      expect(decide(`werk ${verb} some-card`)).toBe("ask");
      expect(decide(`werk ${verb} some-card`, personal)).toBe("ask");
      expect(decide(`bun src/cli.ts ${verb} some-card`, personal)).toBe("ask");
    }
  });
  test("other werk commands are allowed", () => {
    expect(decide("werk show a")).toBe("allow");
    expect(decide("bun src/cli.ts show a")).toBe("allow");
  });
});

describe("48.2 the lint hook repairs silently, then reports a hook error", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-hook-")));
  test("hook flow", () => {
    try {
      const post = settings.hooks.PostToolUse[0];
      expect(post.matcher).toContain("Edit");
      expect(post.matcher).toContain("Write");
      const command: string = post.hooks[0].command;
      mkdirSync(join(root, "src/claude"), { recursive: true });
      cpSync(
        join(REPO, "src/claude/lint-hook.ts"),
        join(root, "src/claude/lint-hook.ts"),
      );
      for (const f of ["biome.json", "package.json", ".gitignore"]) {
        cpSync(join(REPO, f), join(root, f));
      }
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      mkdirSync(join(root, "client/app"), { recursive: true });
      const file = join(root, "client/app/thing.tsx");
      const run = () =>
        Bun.spawnSync(["sh", "-c", command], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          stdin: new TextEncoder().encode(
            JSON.stringify({
              hook_event_name: "PostToolUse",
              tool_name: "Edit",
              tool_input: { file_path: file },
            }),
          ),
          stdout: "pipe",
          stderr: "pipe",
        });

      writeFileSync(
        file,
        `import { useState } from "react";\nexport function Thing() {\n      return <div>hi</div>;\n}\n`,
      );
      const first = run();
      const firstOut = first.stdout.toString() + first.stderr.toString();
      expect(first.exitCode, firstOut).toBe(0);
      expect(first.stdout.toString() + first.stderr.toString()).toBe("");
      const fixed = readFileSync(file, "utf8");
      expect(fixed).not.toContain("useState");
      expect(fixed).toContain("\n  return <div>hi</div>;\n");

      writeFileSync(
        file,
        `import { useEffect } from "react";\nexport function Thing({ id }: { id: string }) {\n  useEffect(() => {\n    console.log(id);\n  }, []);\n  return <div>hi</div>;\n}\n`,
      );
      const second = run();
      // The edit stays saved; the hook reports exit 2 with the error on stderr.
      expect(readFileSync(file, "utf8")).toContain("useEffect");
      expect(second.exitCode).toBe(2);
      const out = second.stdout.toString() + second.stderr.toString();
      expect(out).toMatch(/useExhaustiveDependencies/);
      expect(out).toContain("id");

      writeFileSync(
        file,
        `import { useEffect } from "react";\nexport function Thing({ id }: { id: string }) {\n  useEffect(() => {\n    console.log(id);\n  }, [id]);\n  return <div>hi</div>;\n}\n`,
      );
      const third = run();
      expect(third.exitCode).toBe(0);
      expect(third.stdout.toString() + third.stderr.toString()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("48.3 the subagent link check", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-links-"));
  const check = () =>
    Bun.spawnSync(
      ["bun", join(REPO, "src/claude/check-subagent-links.ts"), root],
      { stdout: "pipe", stderr: "pipe" },
    );
  test("pass, copy fails, restore passes, missing fails, dev-only stays a file", () => {
    try {
      mkdirSync(join(root, ".claude"), { recursive: true });
      cpSync(
        join(REPO, "src/agent/subagents"),
        join(root, "src/agent/subagents"),
        {
          recursive: true,
        },
      );
      // Copy the shipped folder to the root; links are relative: ../../src/agent/subagents/x.md
      cpSync(join(REPO, ".claude/agents"), join(root, ".claude/agents"), {
        recursive: true,
        verbatimSymlinks: true,
      });
      const link = join(root, ".claude/agents/prototyper.md");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(check().exitCode).toBe(0);

      // replace one link with a copy
      const src = join(root, "src/agent/subagents/prototyper.md");
      rmSync(link);
      writeFileSync(link, readFileSync(src));
      const copy = check();
      expect(copy.exitCode).toBe(1);
      const msg = copy.stderr.toString();
      expect(msg).toContain("prototyper");
      expect(msg).toMatch(/copy, not a link/);
      expect(msg).not.toContain("test-scope");

      // restore
      rmSync(link);
      symlinkSync("../../src/agent/subagents/prototyper.md", link);
      expect(check().exitCode).toBe(0);

      // a dev-only subagent stays a plain file
      writeFileSync(
        join(root, ".claude/agents/dev-only.md"),
        "---\ndescription: x\n---\nx\n",
      );
      expect(check().exitCode).toBe(0);

      // remove a link
      rmSync(join(root, ".claude/agents/test-scope.md"));
      const gone = check();
      expect(gone.exitCode).toBe(1);
      expect(gone.stderr.toString()).toContain("test-scope");
      expect(gone.stderr.toString()).toMatch(/no link/);
      expect(gone.stderr.toString()).not.toContain("prototyper");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("the checkout itself passes", () => {
    const r = Bun.spawnSync(
      ["bun", join(REPO, "src/claude/check-subagent-links.ts")],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(r.exitCode).toBe(0);
  });
});

describe("48.4 the shared settings are small, safe, with no skills or servers", () => {
  const allow: string[] = settings.permissions.allow;
  test("every make target and the werk command line are allowed", () => {
    const make = readFileSync(join(REPO, "Makefile"), "utf8");
    const targets = [...make.matchAll(/^([a-z0-9-]+):.*## /gm)].map(
      (m) => m[1] as string,
    );
    expect(targets.length).toBeGreaterThan(5);
    for (const t of targets) expect(any(allow, `make ${t}`)).toBe(true);
    expect(any(allow, "werk show x")).toBe(true);
    expect(any(allow, "bun src/cli.ts show x")).toBe(true);
  });
  test("no allowed command writes outside the repo or reaches the network", () => {
    const bad =
      /\b(curl|wget|ssh|scp|nc|rm|mv|cp|tee|git push|npm|bunx?\s+(add|install|x)|sudo|chmod|dd)\b|\.\.\/|~|\/(etc|tmp|Users|home)\b|>|\bhttps?:/;
    for (const rule of allow) {
      expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
      expect(bad.test(rule)).toBe(false);
    }
    expect(
      settings.permissions.allow.some((r: string) =>
        /^(Read|Write|Edit|WebFetch|WebSearch|mcp__)/.test(r),
      ),
    ).toBe(false);
  });
  test("no skills and no MCP server entries", () => {
    expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
    expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers).toBeUndefined();
    expect(settings.enableAllProjectMcpServers).toBeUndefined();
    const files = Bun.spawnSync(["git", "ls-files"], { cwd: REPO })
      .stdout.toString()
      .split("\n");
    expect(
      files.filter(
        (f) => /(^|\/)SKILL\.md$/.test(f) || /(^|\/)\.mcp\.json$/.test(f),
      ),
    ).toEqual([]);
  });
  test("a personal settings file is ignored by git", () => {
    const r = Bun.spawnSync(
      ["git", "check-ignore", ".claude/settings.local.json"],
      { cwd: REPO },
    );
    expect(r.exitCode).toBe(0);
  });
});
