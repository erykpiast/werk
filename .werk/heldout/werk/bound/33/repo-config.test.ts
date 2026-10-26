import { expect, test } from "bun:test";
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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const settings = () =>
  JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8"));
const sh = (cmd: string[], cwd = REPO, input?: string) =>
  Bun.spawnSync(cmd, {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
  });

// 48.1
test("48.1 make is allowed; accept, remove and restore are in the ask list (ask outranks a personal allow)", () => {
  const s = settings();
  expect(s.permissions.allow).toContain("Bash(make:*)");
  const ask: string[] = s.permissions.ask ?? [];
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask.some((e) => e.includes(`werk ${verb}`))).toBe(true);
    expect(ask.some((e) => e.includes(`src/cli.ts ${verb}`))).toBe(true);
  }
  // the shared file must not itself allow those verbs
  for (const a of s.permissions.allow as string[])
    expect(a).not.toMatch(/accept|remove|restore/);
  expect(s.permissions.deny ?? []).toBeDefined();
});

// 48.2
test("48.2 the hook fixes unused import and indentation silently, and reports a hook dependency error with exit 2", () => {
  const dir = join(REPO, ".werk-heldout", "hook-tmp");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "sample.tsx");
  const hook = (path: string) =>
    sh(
      ["bun", join(REPO, "src/claude/lint-hook.ts")],
      REPO,
      JSON.stringify({ tool_input: { file_path: path } }),
    );
  try {
    writeFileSync(
      file,
      `import { useState } from "react";\nimport { useEffect } from "react";\nexport const a = () => {\n      return useState(1);\n};\n`,
    );
    const r = hook(file);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("  return useState(1);");

    writeFileSync(
      file,
      `import { useEffect, useState } from "react";\nexport function C({ id }: { id: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id);\n  }, []);\n  return n;\n}\n`,
    );
    const bad = hook(file);
    expect(readFileSync(file, "utf8")).toContain("useEffect");
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString() + bad.stdout.toString()).toMatch(
      /useExhaustiveDependencies|dependenc/i,
    );

    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("[]", "[id]"),
    );
    const ok = hook(file);
    expect(ok.exitCode).toBe(0);
    expect(ok.stderr.toString()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 48.3
test("48.3 the subagent link check passes, fails on a copy, passes on restore, fails on a missing link, ignores dev-only agents", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-sub-"));
  try {
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    cpSync(join(REPO, "src/agent/subagents"), join(root, "src/agent/subagents"), {
      recursive: true,
    });
    const names = readdirSync(join(root, "src/agent/subagents"));
    const link = (n: string) =>
      symlinkSync(
        `../../src/agent/subagents/${n}`,
        join(root, ".claude/agents", n),
      );
    for (const n of names) link(n);
    const check = () =>
      sh(["bun", join(REPO, "src/claude/check-subagent-links.ts"), root]);
    expect(check().exitCode).toBe(0);
    const n0 = names[0] as string;
    const p = join(root, ".claude/agents", n0);
    unlinkSync(p);
    cpSync(join(root, "src/agent/subagents", n0), p);
    const copied = check();
    expect(copied.exitCode).toBe(1);
    expect(copied.stderr.toString()).toContain(n0.replace(".md", ""));
    expect(copied.stderr.toString()).toMatch(/link/);
    unlinkSync(p);
    link(n0);
    expect(check().exitCode).toBe(0);
    unlinkSync(p);
    const missing = check();
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain(n0.replace(".md", ""));
    link(n0);
    writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\n---\nx\n");
    expect(check().exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 48.4
test("48.4 shared settings: make and werk allowed, nothing outside the repo or on the network, no skills or MCP, local settings ignored", () => {
  const s = settings();
  const allow: string[] = s.permissions.allow;
  expect(allow.join(" ")).toContain("make");
  expect(allow.join(" ")).toContain("werk");
  for (const a of allow) {
    expect(a).not.toMatch(/curl|wget|ssh|\bnc\b|fetch|WebFetch|WebSearch|\brm\b|\bcp\b|\bmv\b|\/tmp|~|\/Users/);
  }
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(s.mcpServers).toBeUndefined();
  expect(s.enableAllProjectMcpServers).toBeUndefined();
  const probe = join(REPO, ".claude/settings.local.json");
  expect(existsSync(probe)).toBe(false);
  writeFileSync(probe, "{}");
  try {
    const ign = sh(["git", "check-ignore", ".claude/settings.local.json"]);
    expect(ign.exitCode).toBe(0);
    const st = sh(["git", "status", "--porcelain", "--", ".claude"]).stdout.toString();
    expect(st).not.toContain("settings.local.json");
  } finally {
    unlinkSync(probe);
  }
});
