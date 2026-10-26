import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
);
const allow: string[] = settings.permissions?.allow ?? [];
const ask: string[] = settings.permissions?.ask ?? [];

/**
 * Claude Code's rule: a deny rule beats an ask rule, an ask rule beats an allow rule,
 * and the rules of every settings file are merged. So a personal allow cannot switch an ask off.
 */
function decision(command: string, personalAllow: string[]): "ask" | "allow" | "none" {
  const matches = (rule: string) => {
    const m = /^Bash\((.*)\)$/.exec(rule);
    if (!m) return false;
    const pattern = m[1] as string;
    return pattern.endsWith(":*")
      ? command === pattern.slice(0, -2) ||
          command.startsWith(`${pattern.slice(0, -2)} `)
      : command === pattern;
  };
  if (ask.some(matches)) return "ask";
  if ([...allow, ...personalAllow].some(matches)) return "allow";
  return "none";
}

function run(argv: string[], cwd: string, input?: string, env?: Record<string, string>) {
  const r = Bun.spawnSync(argv, {
    cwd,
    env: env ?? (process.env as Record<string, string>),
    stdin: input === undefined ? "ignore" : new Response(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("48.1 make runs freely, accept asks", () => {
  test("48.1 make target runs with no question; accept, remove and restore ask even with a personal allow", () => {
    const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"];
    expect(decision("make lint", [])).toBe("allow");
    expect(decision("make lint", personal)).toBe("allow");
    for (const verb of ["accept", "remove", "restore"]) {
      expect(decision(`werk ${verb} login --actor you`, personal)).toBe("ask");
      expect(decision(`bun src/cli.ts ${verb} login --actor you`, personal)).toBe("ask");
    }
    // The question is not turned off by the personal entries above.
    expect(ask.length).toBeGreaterThanOrEqual(6);
  });
});

describe("48.2 lint hook", () => {
  test("48.2 unused import repaired silently, hook error reported, fixed edit clean", () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "heldout-hook-"));
    try {
      cpSync(join(REPO, "biome.json"), join(dir, "biome.json"));
      cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
      run(["git", "init", "-q"], dir);
      mkdirSync(join(dir, "client"));
      const file = join(dir, "client", "thing.tsx");
      writeFileSync(
        file,
        `import { useEffect } from "react";\nimport { unused } from "./unused";\nexport function A() {\n      return <div>hi</div>;\n}\n`,
      );
      const hook = join(REPO, ".claude/../src/claude/lint-hook.ts");
      // The shared settings name this hook for Write, Edit and MultiEdit.
      expect(settings.hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
      const input = JSON.stringify({ tool_input: { file_path: file } });
      const first = run(["bun", hook], dir, input);
      expect(first.err).toBe("");
      expect(first.code).toBe(0);
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("unused");
      expect(text).toContain('  return <div>hi</div>;');

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport function A({ n }: { n: number }) {\n  const [v, setV] = useState(0);\n  useEffect(() => {\n    setV(n);\n  }, []);\n  return <div>{v}</div>;\n}\n`,
      );
      const second = run(["bun", hook], dir, input);
      expect(second.code).toBe(2);
      expect(second.err).toContain("useExhaustiveDependencies");
      expect(readFileSync(file, "utf8")).toContain("setV(n)");

      writeFileSync(
        file,
        `import { useEffect, useState } from "react";\nexport function A({ n }: { n: number }) {\n  const [v, setV] = useState(0);\n  useEffect(() => {\n    setV(n);\n  }, [n]);\n  return <div>{v}</div>;\n}\n`,
      );
      const third = run(["bun", hook], dir, input);
      expect(third.err).toBe("");
      expect(third.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("48.3 subagent links", () => {
  const checker = join(REPO, "src/claude/check-subagent-links.ts");
  test("48.3 copy fails, restored link passes, missing link fails, dev-only plain file is fine", () => {
    const root = mkdtempSync(join(tmpdir(), "heldout-links-"));
    try {
      const agents = join(root, ".claude/agents");
      mkdirSync(agents, { recursive: true });
      cpSync(join(REPO, "src/agent/subagents"), join(root, "src/agent/subagents"), { recursive: true });
      const shipped = readdirSync(join(REPO, ".claude/agents")).filter((n) => lstatSync(join(REPO, ".claude/agents", n)).isSymbolicLink());
      expect(shipped.length).toBeGreaterThan(0);
      const link = (n: string) => symlinkSync(`../../src/agent/subagents/${n}`, join(agents, n));
      for (const n of shipped) link(n);
      // A dev-only subagent stays a plain file.
      writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\nx\n");
      expect(run(["bun", checker, root], REPO).code).toBe(0);

      const one = shipped[0] as string;
      rmSync(join(agents, one));
      cpSync(join(root, "src/agent/subagents", one), join(agents, one));
      const copy = run(["bun", checker, root], REPO);
      expect(copy.code).toBe(1);
      expect(copy.err).toContain(one.replace(/\.md$/, ""));
      expect(copy.err).toContain("not a link");

      rmSync(join(agents, one));
      link(one);
      expect(run(["bun", checker, root], REPO).code).toBe(0);

      rmSync(join(agents, one));
      const gone = run(["bun", checker, root], REPO);
      expect(gone.code).toBe(1);
      expect(gone.err).toContain(one.replace(/\.md$/, ""));
      expect(gone.err).toContain("no link");
      expect(gone.err).not.toContain("dev-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("48.4 shared settings", () => {
  test("48.4 allowed commands are small and safe; no skills or MCP; personal file ignored", () => {
    expect(allow).toEqual(["Bash(make:*)", "Bash(werk:*)", "Bash(bun src/cli.ts:*)"]);
    const net = /\b(curl|wget|ssh|scp|nc|git push|npm publish|gh)\b/;
    const outside = /(\brm\b|\bmv\b|\bcp\b|\btee\b|~\/|\/etc|\/usr|sudo)/;
    for (const rule of allow) {
      expect(net.test(rule)).toBe(false);
      expect(outside.test(rule)).toBe(false);
    }
    // every make target is covered by the one make rule
    expect(decision("make e2e", [])).toBe("allow");
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers).toBeUndefined();
    const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout.toString().split("\n");
    expect(tracked.filter((f) => /(^|\/)SKILL\.md$|(^|\/)\.claude\/skills\/|(^|\/)\.mcp\.json$/.test(f))).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "heldout-ignore-"));
    try {
      cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
      run(["git", "init", "-q"], dir);
      mkdirSync(join(dir, ".claude"));
      writeFileSync(join(dir, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(*)"]}}');
      const status = run(["git", "status", "--porcelain", "-uall"], dir).out;
      expect(status).not.toContain("settings.local.json");
      expect(existsSync(join(dir, ".claude/settings.local.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
