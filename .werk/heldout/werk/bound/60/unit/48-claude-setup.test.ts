import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(
  readFileSync(join(REPO, ".claude", "settings.json"), "utf8"),
) as {
  permissions: { allow: string[]; ask?: string[]; deny?: string[] };
  hooks: unknown;
  mcpServers?: unknown;
};

/** Claude Code's documented rule order across all merged settings files: deny, then ask, then allow. */
function decide(command: string, personalAllow: string[]): "deny" | "ask" | "allow" | "none" {
  const matches = (rule: string) => {
    const m = /^Bash\((.*)\)$/.exec(rule);
    if (!m) return false;
    const pat = m[1] as string;
    if (pat.endsWith(":*")) {
      const prefix = pat.slice(0, -2);
      return command === prefix || command.startsWith(`${prefix} `);
    }
    return command === pat;
  };
  const p = settings.permissions;
  if ((p.deny ?? []).some(matches)) return "deny";
  if ((p.ask ?? []).some(matches)) return "ask";
  if ([...p.allow, ...personalAllow].some(matches)) return "allow";
  return "none";
}

describe("48.1 permissions", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(*)"];
  test("make targets run free; accept, remove, restore ask even with a personal allow", () => {
    const targets = readFileSync(join(REPO, "Makefile"), "utf8")
      .split("\n")
      .flatMap((l) => /^([a-z0-9-]+):.*## /.exec(l)?.[1] ?? []);
    expect(targets).toContain("lint");
    for (const t of targets) expect(decide(`make ${t}`, [])).toBe("allow");
    for (const verb of ["accept", "remove", "restore"]) {
      expect(decide(`werk ${verb} login`, personal)).toBe("ask");
      expect(decide(`bun src/cli.ts ${verb} login`, personal)).toBe("ask");
      expect(decide(`werk ${verb} login`, [])).toBe("ask");
    }
    // other werk commands stay free
    expect(decide("werk show login", [])).toBe("allow");
  });
});

describe("48.4 shared settings", () => {
  test("allowed commands are only make and werk's command line, and nothing writes or fetches by itself", () => {
    expect(settings.permissions.allow).toEqual([
      "Bash(make:*)",
      "Bash(werk:*)",
      "Bash(bun src/cli.ts:*)",
    ]);
    for (const rule of settings.permissions.allow) {
      expect(rule).not.toMatch(/curl|wget|ssh|scp|rsync|git push|npm|rm |\.\.|~|\/tmp|sudo/);
    }
  });
  test("no skill definition and no MCP server entry", () => {
    expect(settings.mcpServers).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain("mcp");
    expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
    expect(existsSync(join(REPO, ".claude", "skills"))).toBe(false);
    const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout
      .toString()
      .split("\n");
    expect(tracked.filter((f) => /(^|\/)SKILL\.md$|(^|\/)\.mcp\.json$|\/skills\//.test(f))).toEqual([]);
  });
  test("a personal settings file is ignored by git", () => {
    const check = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: REPO });
    expect(check.exitCode).toBe(0);
  });
});

describe("48.2 lint hook", () => {
  function runHook(root: string, file: string) {
    const run = Bun.spawnSync(["bun", join(REPO, "src/claude/lint-hook.ts")], {
      cwd: root,
      stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: file } })),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
  }
  test("unused import and indentation are fixed silently; a hook-dependency error is shown; fixing it clears it", () => {
    const root = mkdtempSync(join(tmpdir(), "werk-48-hook-"));
    try {
      copyFileSync(join(REPO, "biome.json"), join(root, "biome.json"));
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      mkdirSync(join(root, "client"));
      const file = join(root, "client", "a.tsx");
      writeFileSync(file, 'import { x } from "./x";\nexport const y = () => {\n      return 1;\n};\n');
      const first = runHook(root, file);
      expect(first.code).toBe(0);
      expect(first.err + first.out).toBe("");
      const fixed = readFileSync(file, "utf8");
      expect(fixed).not.toContain("import { x }");
      expect(fixed).toContain("\n  return 1;");

      writeFileSync(
        file,
        'import { useEffect, useState } from "react";\nexport function C({ n }: { n: number }) {\n  const [s, setS] = useState(0);\n  useEffect(() => {\n    setS(n);\n  }, []);\n  return <b>{s}</b>;\n}\n',
      );
      const second = runHook(root, file);
      expect(existsSync(file)).toBe(true);
      expect(second.code).toBe(2);
      expect(second.err).toContain("useExhaustiveDependencies");
      expect(readFileSync(file, "utf8")).toContain("useEffect");

      writeFileSync(
        file,
        'import { useEffect, useState } from "react";\nexport function C({ n }: { n: number }) {\n  const [s, setS] = useState(0);\n  useEffect(() => {\n    setS(n);\n  }, [n]);\n  return <b>{s}</b>;\n}\n',
      );
      const third = runHook(root, file);
      expect(third.code).toBe(0);
      expect(third.err).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
  test("settings wire the hook to Write|Edit|MultiEdit PostToolUse", () => {
    const hooks = (settings.hooks as { PostToolUse: { matcher: string; hooks: { command: string }[] }[] }).PostToolUse;
    expect(hooks[0]?.matcher).toBe("Write|Edit|MultiEdit");
    expect(hooks[0]?.hooks[0]?.command).toContain("lint-hook.ts");
  });
});

describe("48.3 subagent link check", () => {
  const check = (root: string) => {
    const r = Bun.spawnSync(["bun", join(REPO, "src/claude/check-subagent-links.ts"), root], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, err: r.stderr.toString() };
  };
  test("copy fails and is named, restored link passes, removed link fails and is named, dev-only plain file is fine", () => {
    expect(check(REPO).code).toBe(0);
    const root = mkdtempSync(join(tmpdir(), "werk-48-links-"));
    try {
      const src = join(root, "src/agent/subagents");
      mkdirSync(src, { recursive: true });
      const shipped = readdirSync(join(REPO, "src/agent/subagents")).filter((f) => f.endsWith(".md"));
      for (const f of shipped) copyFileSync(join(REPO, "src/agent/subagents", f), join(src, f));
      const agents = join(root, ".claude/agents");
      mkdirSync(agents, { recursive: true });
      const link = (f: string) => symlinkSync(`../../src/agent/subagents/${f}`, join(agents, f));
      for (const f of shipped) link(f);
      writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\nonly for werk's own work\n");
      expect(check(root).code).toBe(0);

      const [a, b] = shipped as [string, string];
      unlinkSync(join(agents, a));
      copyFileSync(join(src, a), join(agents, a));
      let r = check(root);
      expect(r.code).toBe(1);
      expect(r.err).toContain(a.replace(".md", ""));
      expect(r.err).toContain("not a link");

      unlinkSync(join(agents, a));
      link(a);
      expect(check(root).code).toBe(0);

      unlinkSync(join(agents, b));
      r = check(root);
      expect(r.code).toBe(1);
      expect(r.err).toContain(b.replace(".md", ""));
      expect(r.err).toContain("no link");
      expect(r.err).not.toContain("dev-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
