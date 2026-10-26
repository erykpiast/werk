import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8"));
const allow: string[] = settings.permissions.allow;
const ask: string[] = settings.permissions.ask;

/** Does a Claude Code Bash rule "Bash(prefix:*)" match a command line? */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
  if (!m) return false;
  return m[2] ? command === m[1] || command.startsWith(`${m[1]} `) : command === m[1];
};
/** Claude Code's order: deny, then ask, then allow. A matching ask rule decides "ask". */
const decide = (command: string, allowRules: string[]) =>
  ask.some((r) => matches(r, command))
    ? "ask"
    : allowRules.some((r) => matches(r, command))
      ? "allow"
      : "ask";

describe("48.1 permissions", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"];
  test("a make target runs with no question", () => {
    expect(decide("make lint", allow)).toBe("allow");
  });
  test("accept, remove and restore ask, even with a personal allow entry", () => {
    for (const verb of ["accept", "remove", "restore"]) {
      for (const prefix of ["werk", "bun src/cli.ts"]) {
        const cmd = `${prefix} ${verb} card --actor you`;
        expect(decide(cmd, allow)).toBe("ask");
        expect(decide(cmd, [...allow, ...personal])).toBe("ask");
      }
    }
  });
});

describe("48.2 lint hook", () => {
  const hook = settings.hooks.PostToolUse[0].hooks[0].command as string;
  test("settings run the hook after Write|Edit|MultiEdit", () => {
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
  });
  test("repairs silently, then reports a hook error, then is silent after the fix", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-48-")));
    try {
      for (const f of ["biome.json", ".gitignore", "tsconfig.json", "package.json"])
        cpSync(join(REPO, f), join(dir, f));
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
      mkdirSync(join(dir, "client"));
      const file = join(dir, "client", "thing.tsx");
      const run = () =>
        Bun.spawnSync(["sh", "-c", hook], {
          cwd: dir,
          env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
          stdin: new TextEncoder().encode(
            JSON.stringify({ tool_input: { file_path: file } }),
          ),
          stdout: "pipe",
          stderr: "pipe",
        });
      writeFileSync(
        file,
        `import { useState } from "react";\nexport const A = () => {\n      return <p>hi</p>;\n};\n`,
      );
      const first = run();
      expect(first.stderr.toString() + first.stdout.toString()).toBe("");
      expect(first.exitCode).toBe(0);
      expect(first.stderr.toString() + first.stdout.toString()).toBe("");
      const fixed = readFileSync(file, "utf8");
      expect(fixed).not.toContain("useState");
      expect(fixed).toContain("\n  return <p>hi</p>;");

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport const A = ({ n }: { n: number }) => {\n  const [v, setV] = useState(0);\n  useEffect(() => {\n    setV(n);\n  }, []);\n  return <p>{v}</p>;\n};\n`,
      );
      const second = run();
      expect(readFileSync(file, "utf8")).toContain("useEffect");
      expect(second.exitCode).toBe(2);
      expect(second.stderr.toString()).toMatch(/useExhaustiveDependencies/);

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport const A = ({ n }: { n: number }) => {\n  const [v, setV] = useState(0);\n  useEffect(() => {\n    setV(n);\n  }, [n]);\n  return <p>{v}</p>;\n};\n`,
      );
      const third = run();
      expect(third.exitCode).toBe(0);
      expect(third.stderr.toString() + third.stdout.toString()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("48.3 subagent link check", () => {
  const check = (root: string) => {
    const r = Bun.spawnSync(
      ["bun", join(REPO, "src/claude/check-subagent-links.ts"), root],
      { stdout: "pipe", stderr: "pipe" },
    );
    return { code: r.exitCode, out: r.stderr.toString() + r.stdout.toString() };
  };
  test("link, copy, restore, remove, and a dev-only plain file", () => {
    const root = mkdtempSync(join(tmpdir(), "werk-heldout-48-3-"));
    try {
      mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      const names = ["prototyper", "test-scope"];
      for (const n of names) {
        cpSync(
          join(REPO, "src/agent/subagents", `${n}.md`),
          join(root, "src/agent/subagents", `${n}.md`),
        );
        symlinkSync(`../../src/agent/subagents/${n}.md`, join(root, ".claude/agents", `${n}.md`));
      }
      writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: dev\n---\nx\n");
      expect(check(root).code).toBe(0);

      const p = join(root, ".claude/agents/prototyper.md");
      rmSync(p);
      cpSync(join(root, "src/agent/subagents/prototyper.md"), p);
      expect(lstatSync(p).isSymbolicLink()).toBe(false);
      const copied = check(root);
      expect(copied.code).not.toBe(0);
      expect(copied.out).toContain("prototyper");
      expect(copied.out).toMatch(/not a link/);

      rmSync(p);
      symlinkSync("../../src/agent/subagents/prototyper.md", p);
      expect(check(root).code).toBe(0);

      rmSync(p);
      expect(existsSync(p)).toBe(false);
      const gone = check(root);
      expect(gone.code).not.toBe(0);
      expect(gone.out).toContain("prototyper");
      expect(gone.out).toMatch(/no link/);
      expect(gone.out).not.toContain("test-scope");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("48.4 shared settings", () => {
  test("every make target and werk are allowed", () => {
    const targets = [...readFileSync(join(REPO, "Makefile"), "utf8").matchAll(/^([a-z0-9-]+):.*$/gm)]
      .map((m) => m[1] as string);
    for (const t of targets) expect(decide(`make ${t}`, allow)).toBe("allow");
    expect(decide("werk show root", allow)).toBe("allow");
  });
  test("no allowed command writes outside the repository or reaches the network", () => {
    for (const rule of allow) {
      expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
      expect(rule).not.toMatch(/curl|wget|gh |ssh|scp|git push|\brm\b|~/);
    }
  });
  test("no project skill and no MCP server entry", () => {
    const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout.toString();
    expect(tracked).not.toMatch(/^\.claude\/skills\//m);
    expect(tracked).not.toMatch(/(^|\/)SKILL\.md$/m);
    expect(tracked).not.toMatch(/^\.mcp\.json$/m);
    expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcpjsonServers/);
  });
  test("a personal settings file is ignored by git", () => {
    const dir = mkdtempSync(join(tmpdir(), "werk-heldout-48-4-"));
    try {
      Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
      cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
      mkdirSync(join(dir, ".claude"));
      writeFileSync(join(dir, ".claude/settings.local.json"), "{}");
      const status = Bun.spawnSync(["git", "status", "--porcelain", "-uall"], { cwd: dir }).stdout.toString();
      expect(status).not.toContain("settings.local.json");
      const ignored = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: dir });
      expect(ignored.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
