import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cloneHead, ROOT, sh } from "./repo.ts";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});
const settings = () => JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));

function hook(repo: string, file: string) {
  const input = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } });
  const p = Bun.spawnSync(["bun", join(repo, "src/claude/lint-hook.ts")], { cwd: repo, stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe", env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

test("48.1 a make target runs freely while accept, remove and restore still ask, whatever a personal allow says", () => {
  const s = settings();
  const allow: string[] = s.permissions.allow;
  const ask: string[] = s.permissions.ask;
  // make lint is allowed by a make rule
  expect(allow).toContain("Bash(make:*)");
  // The accept, remove and restore commands ask, in both of the ways an agent runs werk.
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask).toContain(`Bash(werk ${verb}:*)`);
    expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
  }
  // A personal file that allows every werk command. Claude Code evaluates deny, then ask, then allow, across all settings files,
  // so a rule in "ask" wins over a broader allow rule. This test reads the rules; it does not run Claude Code.
  const personal = { permissions: { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"] } };
  expect(personal.permissions.allow.every((r) => allow.includes(r))).toBe(true);
  expect(allow.some((r) => /make/.test(r) && ask.some((a) => /make/.test(a)))).toBe(false);
});

test("48.2 an edit that leaves an unused import is repaired and the agent hears nothing; a missing hook dependency is reported", () => {
  const c = cloneHead(true);
  disposers.push(c.dispose);
  const file = join(c.repo, "client", "app", "heldout-sample.tsx");
  writeFileSync(file, `import { useEffect, useState } from "react";\nimport { Button } from "../components/ui/button";\nexport function Sample() {\n        const [n] = useState(0);\n  return <p>{n}</p>;\n}\n`);
  const first = hook(c.repo, file);
  expect(first.code).toBe(0);
  expect(first.out + first.err).toBe("");
  const fixed = readFileSync(file, "utf8");
  expect(fixed).not.toContain("useEffect");
  expect(fixed).not.toContain("Button");
  expect(fixed).not.toContain("        const [n]");
  writeFileSync(file, `import { useEffect, useState } from "react";\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <p>{n}</p>;\n}\n`);
  const second = hook(c.repo, file);
  expect(existsSync(file)).toBe(true);
  expect(second.code).toBe(2);
  expect(second.err).toMatch(/useExhaustiveDependencies|dependenc/i);
  writeFileSync(file, `import { useEffect, useState } from "react";\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <p>{n}</p>;\n}\n`);
  const third = hook(c.repo, file);
  expect(third.code).toBe(0);
  expect(third.err).toBe("");
});

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const c = cloneHead(true);
  disposers.push(c.dispose);
  const check = () => sh(c.repo, ["bun", "src/claude/check-subagent-links.ts"]);
  expect(check().code).toBe(0);
  const agent = join(c.repo, ".claude/agents/prototyper.md");
  const target = join(c.repo, "src/agent/subagents/prototyper.md");
  rmSync(agent);
  copyFileSync(target, agent);
  expect(lstatSync(agent).isSymbolicLink()).toBe(false);
  const copied = check();
  expect(copied.code).not.toBe(0);
  expect(copied.out).toContain("prototyper");
  expect(copied.out).toMatch(/not a link/);
  rmSync(agent);
  symlinkSync("../../src/agent/subagents/prototyper.md", agent);
  expect(check().code).toBe(0);
  rmSync(agent);
  const missing = check();
  expect(missing.code).not.toBe(0);
  expect(missing.out).toContain("prototyper");
  symlinkSync("../../src/agent/subagents/prototyper.md", agent);
  writeFileSync(join(c.repo, ".claude/agents/dev-only.md"), "---\nname: dev-only\ndescription: werk development only\n---\nHelp.\n");
  expect(check().code).toBe(0);
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const s = settings();
  const allow: string[] = s.permissions.allow;
  expect(allow.length).toBeLessThanOrEqual(5);
  const targets = [...readFileSync(join(ROOT, "Makefile"), "utf8").matchAll(/^([a-z0-9-]+):.*##/gm)].map((m) => m[1]);
  expect(targets.length).toBeGreaterThan(5);
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
  for (const rule of allow) {
    expect(rule).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(rule).not.toMatch(/curl|wget|ssh|scp|gh |git push|npm|rm |sudo|\.\.\/|~\//);
  }
  expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(s)).not.toMatch(/mcpServers|enabledMcp/);
  expect(readdirSync(join(ROOT, ".claude")).sort()).toEqual(["agents", "settings.json"]);
  const c = cloneHead(false);
  disposers.push(c.dispose);
  writeFileSync(join(c.repo, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }));
  expect(sh(c.repo, ["git", "check-ignore", ".claude/settings.local.json"]).code).toBe(0);
  expect(sh(c.repo, ["git", "status", "--porcelain"]).out).not.toContain("settings.local.json");
});
