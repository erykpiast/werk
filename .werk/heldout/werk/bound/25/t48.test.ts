import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  copyFileSync,
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
import { CHECKOUT } from "./support.ts";

const settings = JSON.parse(readFileSync(join(CHECKOUT, ".claude", "settings.json"), "utf8")) as {
  permissions: { allow: string[]; ask?: string[]; deny?: string[] };
  hooks?: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
  mcpServers?: unknown;
};

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-48-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// ---- a model of Claude Code's permission rules: deny, then ask, then allow, from every settings file ----
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const pattern = m[1]!;
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === pattern;
};
const decide = (command: string, files: { allow?: string[]; ask?: string[]; deny?: string[] }[]) => {
  const all = (k: "allow" | "ask" | "deny") => files.flatMap((f) => f[k] ?? []);
  if (all("deny").some((r) => matches(r, command))) return "deny";
  if (all("ask").some((r) => matches(r, command))) return "ask";
  if (all("allow").some((r) => matches(r, command))) return "allow";
  return "ask";
};

test("48.1 a make target runs freely while an accept command still asks", () => {
  const personal = { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(make:*)"] };
  const files = [settings.permissions, personal];
  expect(decide("make lint", files)).toBe("allow");
  expect(decide("make lint", [settings.permissions])).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} some-card --actor you`, files)).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} some-card --actor you`, files)).toBe("ask");
  }
  expect(decide("werk show some-card", files)).toBe("allow");
});

test("48.2 an edit that leaves an unused import is repaired, and the agent hears nothing", () => {
  const copy = join(root, "repo");
  mkdirSync(join(copy, "client", "app"), { recursive: true });
  for (const f of ["biome.json", "tsconfig.json", "package.json", ".gitignore"]) copyFileSync(join(CHECKOUT, f), join(copy, f));
  cpSync(join(CHECKOUT, "src", "claude"), join(copy, "src", "claude"), { recursive: true });
  symlinkSync(join(CHECKOUT, "node_modules"), join(copy, "node_modules"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: copy });
  const hook = settings.hooks?.PostToolUse?.find((h) => /Edit/.test(h.matcher))?.hooks[0]?.command;
  expect(hook).toBeDefined();
  const file = join(copy, "client", "app", "probe.tsx");
  const run = () => {
    const r = Bun.spawnSync(["sh", "-c", hook!], {
      cwd: copy,
      env: { ...process.env, CLAUDE_PROJECT_DIR: copy },
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } })),
    });
    return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
  };
  writeFileSync(file, `import { useState } from "react";\nimport { useEffect } from "react";\n\nexport function Probe() {\n      const [n] = useState(0);\n  return <p>{n}</p>;\n}\n`);
  // useEffect is the unused import.
  const first = run();
  expect(first.out).toBe("");
  expect(first.code).toBe(0);
  const fixed = readFileSync(file, "utf8");
  expect(fixed).not.toContain("useEffect");
  expect(fixed).toContain("  const [n] = useState(0);");
  writeFileSync(file, `import { useEffect, useState } from "react";\n\nexport function Probe({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <p>{n}</p>;\n}\n`);
  const second = run();
  expect(readFileSync(file, "utf8")).toContain("useEffect");
  expect(second.code).not.toBe(0);
  expect(second.out).toMatch(/useExhaustiveDependencies|dependenc/i);
  writeFileSync(file, `import { useEffect, useState } from "react";\n\nexport function Probe({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <p>{n}</p>;\n}\n`);
  const third = run();
  expect(third.code).toBe(0);
  expect(third.out.trim()).toBe("");
});

test("48.3 a copied subagent fails the check, a restored link passes it", () => {
  const repo = join(root, "repo");
  const agents = join(repo, ".claude", "agents");
  const src = join(repo, "src", "agent", "subagents");
  mkdirSync(agents, { recursive: true });
  mkdirSync(src, { recursive: true });
  const shipped = ["prototyper", "test-scope"];
  for (const n of shipped) {
    copyFileSync(join(CHECKOUT, "src", "agent", "subagents", `${n}.md`), join(src, `${n}.md`));
    symlinkSync(`../../src/agent/subagents/${n}.md`, join(agents, `${n}.md`));
  }
  writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\n---\nOnly for werk's own development.\n");
  const check = () => {
    const r = Bun.spawnSync(["bun", join(CHECKOUT, "src", "claude", "check-subagent-links.ts"), repo], { cwd: root });
    return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
  };
  expect(check().code).toBe(0);
  unlinkSync(join(agents, "prototyper.md"));
  copyFileSync(join(src, "prototyper.md"), join(agents, "prototyper.md"));
  expect(lstatSync(join(agents, "prototyper.md")).isSymbolicLink()).toBe(false);
  const copied = check();
  expect(copied.code).not.toBe(0);
  expect(copied.out).toContain("prototyper");
  expect(copied.out).toMatch(/not a link/);
  unlinkSync(join(agents, "prototyper.md"));
  symlinkSync("../../src/agent/subagents/prototyper.md", join(agents, "prototyper.md"));
  expect(check().code).toBe(0);
  unlinkSync(join(agents, "test-scope.md"));
  const gone = check();
  expect(gone.code).not.toBe(0);
  expect(gone.out).toContain("test-scope");
  expect(gone.out).not.toContain("dev-only");
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow = settings.permissions.allow;
  expect(allow.some((r) => matches(r, "make lint"))).toBe(true);
  expect(allow.some((r) => matches(r, "make test"))).toBe(true);
  expect(allow.some((r) => matches(r, "werk show x"))).toBe(true);
  const makefile = readFileSync(join(CHECKOUT, "Makefile"), "utf8");
  for (const [, target] of makefile.matchAll(/^([a-z0-9-]+):.*##/gm)) {
    expect(allow.some((r) => matches(r, `make ${target}`))).toBe(true);
  }
  // Every allowed command is a make target or werk itself; none is a general tool that writes elsewhere or reaches the network.
  for (const rule of allow) {
    expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
  }
  expect(settings.mcpServers).toBeUndefined();
  expect(existsSync(join(CHECKOUT, ".mcp.json"))).toBe(false);
  expect(existsSync(join(CHECKOUT, ".claude", "skills"))).toBe(false);
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: CHECKOUT }).stdout.toString();
  expect(tracked).not.toMatch(/(^|\/)SKILL\.md$/m);
  expect(tracked).not.toMatch(/\.claude\/(skills|commands)\//);
  // A personal settings file is ignored.
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  copyFileSync(join(CHECKOUT, ".gitignore"), join(repo, ".gitignore"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  writeFileSync(join(repo, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }));
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString();
  expect(status).not.toContain("settings.local.json");
  expect(Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: repo }).exitCode).toBe(0);
});
