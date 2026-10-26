import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
) as {
  permissions: { allow: string[]; ask: string[]; deny?: string[] };
  hooks?: unknown;
  mcpServers?: unknown;
};

/** Claude Code's Bash rule: `Bash(prefix:*)` matches the prefix at a word boundary. */
function matches(rule: string, command: string): boolean {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1] as string;
  return command === prefix || command.startsWith(`${prefix} `);
}
/** Documented order: deny, then ask, then allow. The first level that matches decides. */
function decide(
  allow: string[],
  ask: string[],
  command: string,
): "deny" | "ask" | "allow" | "prompt" {
  if (ask.some((r) => matches(r, command))) return "ask";
  if (allow.some((r) => matches(r, command))) return "allow";
  return "prompt";
}

describe("48.1 a make target runs freely while accept, remove and restore still ask", () => {
  // The person's personal file allows every werk command.
  const personalAllow = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"];
  const allow = [...settings.permissions.allow, ...personalAllow];
  const ask = settings.permissions.ask;
  test("make lint is allowed without a question", () => {
    expect(decide(allow, ask, "make lint")).toBe("allow");
    expect(decide(settings.permissions.allow, ask, "make lint")).toBe("allow");
  });
  for (const verb of ["accept", "remove", "restore"]) {
    test(`werk ${verb} asks, even with a personal allow`, () => {
      expect(decide(allow, ask, `werk ${verb} login --actor you`)).toBe("ask");
      expect(decide(allow, ask, `bun src/cli.ts ${verb} login`)).toBe("ask");
    });
  }
  test("another werk command is allowed", () => {
    expect(decide(allow, ask, "werk show root")).toBe("allow");
  });
});

describe("48.4 the shared settings", () => {
  test("every make target and the werk command line are allowed", () => {
    expect(settings.permissions.allow).toContain("Bash(make:*)");
    expect(settings.permissions.allow).toContain("Bash(werk:*)");
  });
  test("no allowed command writes outside the repository or reaches the network", () => {
    for (const rule of settings.permissions.allow) {
      expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
      expect(rule).not.toMatch(/curl|wget|ssh|\bgh\b|git push|\brm\b|sudo|~/);
    }
  });
  test("no skill definition and no MCP server entry", () => {
    expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
    expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
    expect(settings.mcpServers).toBeUndefined();
    const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO })
      .stdout.toString()
      .split("\n");
    expect(tracked.filter((f) => /SKILL\.md$|(^|\/)skills\//.test(f))).toEqual([]);
  });
  test("a personal settings file is ignored by git", () => {
    const root = mkdtempSync(join(tmpdir(), "heldout-48-4-"));
    try {
      Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: root });
      cpSync(join(REPO, ".gitignore"), join(root, ".gitignore"));
      mkdirSync(join(root, ".claude"));
      cpSync(join(REPO, ".claude/settings.json"), join(root, ".claude/settings.json"));
      Bun.spawnSync(["git", "add", "-A"], { cwd: root });
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: root });
      writeFileSync(join(root, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(ls:*)"]}}');
      const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: root }).stdout.toString();
      expect(status).toBe("");
      const ignored = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: root });
      expect(ignored.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("48.2 the lint hook", () => {
  test("settings run the hook after Write, Edit and MultiEdit", () => {
    const text = JSON.stringify(settings.hooks);
    expect(text).toContain("Write|Edit|MultiEdit");
    expect(text).toContain("lint-hook.ts");
  });
  test("fixes are silent; a remaining lint error is shown and the file is kept", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-48-2-")));
    try {
      Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: root });
      cpSync(join(REPO, "biome.json"), join(root, "biome.json"));
      cpSync(join(REPO, ".gitignore"), join(root, ".gitignore"));
      cpSync(join(REPO, "package.json"), join(root, "package.json"));
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
      mkdirSync(join(root, "client"));
      const file = join(root, "client", "thing.tsx");
      const hook = (path: string) =>
        Bun.spawnSync(["bun", join(REPO, "src/claude/lint-hook.ts")], {
          cwd: root,
          stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: path } })),
          stdout: "pipe",
          stderr: "pipe",
        });
      writeFileSync(
        file,
        `import { useState } from "react";\nimport { useEffect } from "react";\nexport function A() {\n      const x = 1;\n  useEffect(() => {}, []);\n      return <p>{x}</p>;\n}\n`,
      );
      const first = hook(file);
      const after = readFileSync(file, "utf8");
      expect(after).not.toContain("useState");
      expect(after).toContain("\n  const x = 1;\n");
      expect(first.stdout.toString() + first.stderr.toString()).toBe("");
      expect(first.exitCode).toBe(0);

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport function A({ n }: { n: number }) {\n  const [s, setS] = useState(0);\n  useEffect(() => {\n    setS(n);\n  }, []);\n  return <p>{s}</p>;\n}\n`,
      );
      const second = hook(file);
      const out = second.stdout.toString() + second.stderr.toString();
      expect(existsSync(file)).toBe(true);
      expect(out).toMatch(/useExhaustiveDependencies/);
      expect(second.exitCode).toBe(2);

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport function A({ n }: { n: number }) {\n  const [s, setS] = useState(0);\n  useEffect(() => {\n    setS(n);\n  }, [n]);\n  return <p>{s}</p>;\n}\n`,
      );
      const third = hook(file);
      expect(third.stdout.toString() + third.stderr.toString()).toBe("");
      expect(third.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("48.3 the subagent link check", () => {
  const SHIPPED = ["prototyper", "test-scope"];
  function check(root: string) {
    const r = Bun.spawnSync(["bun", join(REPO, "src/claude/check-subagent-links.ts"), root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
  }
  test("copy fails and names it; restored link passes; missing link fails; dev-only file is fine", () => {
    const root = mkdtempSync(join(tmpdir(), "heldout-48-3-"));
    try {
      mkdirSync(join(root, "src/agent"), { recursive: true });
      cpSync(join(REPO, "src/agent/subagents"), join(root, "src/agent/subagents"), { recursive: true });
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      for (const n of SHIPPED) symlinkSync(`../../src/agent/subagents/${n}.md`, join(root, `.claude/agents/${n}.md`));
      // a dev-only plain file
      writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: dev-only\n---\nx\n");
      expect(check(root).code).toBe(0);

      const p = join(root, ".claude/agents/prototyper.md");
      unlinkSync(p);
      cpSync(join(root, "src/agent/subagents/prototyper.md"), p);
      expect(lstatSync(p).isSymbolicLink()).toBe(false);
      const copied = check(root);
      expect(copied.code).not.toBe(0);
      expect(copied.out).toContain("prototyper");
      expect(copied.out).toMatch(/not a link/);
      expect(copied.out).not.toContain("dev-only");

      unlinkSync(p);
      symlinkSync("../../src/agent/subagents/prototyper.md", p);
      expect(check(root).code).toBe(0);

      const t = join(root, ".claude/agents/test-scope.md");
      unlinkSync(t);
      const missing = check(root);
      expect(missing.code).not.toBe(0);
      expect(missing.out).toContain("test-scope");
      expect(missing.out).toMatch(/no link/);
      expect(missing.out).not.toContain("dev-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("the repository itself passes", () => {
    expect(check(REPO).code).toBe(0);
  });
});
