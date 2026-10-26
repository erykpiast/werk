import { expect, test } from "bun:test";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const settings = JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8"));
const allow: string[] = settings.permissions?.allow ?? [];
const ask: string[] = settings.permissions?.ask ?? [];

/** Claude Code matches a Bash(prefix:*) rule against the start of the command. */
const matches = (rule: string, cmd: string) => {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  return m ? cmd === m[1] || cmd.startsWith(`${m[1]} `) : false;
};
const decision = (cmd: string) => {
  if (ask.some((r) => matches(r, cmd))) return "ask"; // ask outranks allow, also from a personal file
  if (allow.some((r) => matches(r, cmd))) return "allow";
  return "prompt";
};

test("48.1 make runs freely, accept/remove/restore ask", () => {
  expect(decision("make lint")).toBe("allow");
  for (const v of ["accept", "remove", "restore"]) {
    expect(decision(`werk ${v} login --actor you`)).toBe("ask");
    expect(decision(`bun src/cli.ts ${v} login --actor you`)).toBe("ask");
  }
  expect(decision("werk show root")).toBe("allow");
  // Claude Code ranks deny, then ask, then allow, whatever file holds the allow entry.
  expect(settings.permissions.deny ?? []).not.toContain("Bash(make:*)");
});

test("48.2 hook repairs, stays silent, then reports a hook dependency error", () => {
  const dir = mkdtempSync(join(REPO, ".werk-heldout", ".tmp48-"));
  const file = join(dir, "thing.tsx");
  const hook = (f: string) =>
    Bun.spawnSync(["bun", join(REPO, "src/claude/lint-hook.ts")], {
      cwd: REPO,
      stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: f } })),
      stdout: "pipe",
      stderr: "pipe",
    });
  try {
    writeFileSync(file, `import { useState } from "react";\nexport function A() {\n      return <div>hi</div>;\n}\n`);
    const r1 = hook(file);
    expect(r1.exitCode, r1.stderr.toString()).toBe(0);
    expect(`${r1.stdout}${r1.stderr}`.trim()).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("useState");
    expect(fixed).toContain('  return <div>hi</div>;');
    writeFileSync(file, `import { useEffect } from "react";\nexport function B({ x }: { x: number }) {\n  useEffect(() => {\n    console.log(x);\n  }, []);\n  return <div>hi</div>;\n}\n`);
    const r2 = hook(file);
    expect(r2.exitCode).toBe(2);
    expect(r2.stderr.toString()).toMatch(/useExhaustiveDependencies/);
    expect(readFileSync(file, "utf8")).toContain("console.log(x)");
    writeFileSync(file, readFileSync(file, "utf8").replace("[]", "[x]"));
    const r3 = hook(file);
    expect(r3.exitCode).toBe(0);
    expect(`${r3.stdout}${r3.stderr}`.trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("48.3 subagent link check", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-g6-links-"));
  try {
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
    const shipped = readdirSync(join(REPO, "src/agent/subagents")).filter((f) => f.endsWith(".md"));
    expect(shipped.length).toBeGreaterThan(0);
    for (const f of shipped) {
      copyFileSync(join(REPO, "src/agent/subagents", f), join(root, "src/agent/subagents", f));
      symlinkSync(`../../src/agent/subagents/${f}`, join(root, ".claude/agents", f));
    }
    const check = () => Bun.spawnSync(["bun", "src/claude/check-subagent-links.ts", root], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    const text = (r: ReturnType<typeof check>) => `${r.stdout}${r.stderr}`;
    expect(check().exitCode).toBe(0);
    const name = shipped[0] as string;
    const link = join(root, ".claude/agents", name);
    rmSync(link);
    copyFileSync(join(root, "src/agent/subagents", name), link);
    const copied = check();
    expect(copied.exitCode).toBe(1);
    expect(text(copied)).toContain(name.replace(/\.md$/, ""));
    expect(text(copied)).toMatch(/copy|not a link/);
    rmSync(link);
    symlinkSync(`../../src/agent/subagents/${name}`, link);
    expect(check().exitCode).toBe(0);
    rmSync(link);
    const missing = check();
    expect(missing.exitCode).toBe(1);
    expect(text(missing)).toContain(name.replace(/\.md$/, ""));
    expect(text(missing)).toMatch(/no link/);
    symlinkSync(`../../src/agent/subagents/${name}`, link);
    writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: dev-only\n---\nonly dev\n");
    expect(check().exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 shared settings are small, safe, free of skills and servers", () => {
  const make = readFileSync(join(REPO, "Makefile"), "utf8");
  const targets = [...make.matchAll(/^([a-z0-9-]+):/gm)].map((m) => m[1] as string);
  expect(allow.some((r) => r === "Bash(make:*)")).toBe(true);
  expect(allow.some((r) => /^Bash\(werk[ :]/.test(r))).toBe(true);
  expect(targets.length).toBeGreaterThan(5);
  for (const r of allow) {
    expect(r).not.toMatch(/curl|wget|ssh|scp|npm|git push|git clone|rm |sudo|\.\.\/|~|\/tmp|\/Users|nc /);
  }
  expect(settings.mcpServers).toBeUndefined();
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  expect(existsSync(join(REPO, ".claude/commands/../skills"))).toBe(false);
  const ig = Bun.spawnSync(["git", "check-ignore", "-v", ".claude/settings.local.json"], { cwd: REPO, stdout: "pipe" });
  expect(ig.exitCode).toBe(0);
});
