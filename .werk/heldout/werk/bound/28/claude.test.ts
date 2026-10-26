import { expect, test } from "bun:test";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const settings = JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8"));

/** A Bash rule matches a command by prefix, as Claude Code does for `Bash(prefix:*)`. */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
  if (!m) return false;
  return m[2] ? command === m[1] || command.startsWith(`${m[1]} `) : command === m[1];
};
/** Claude Code decides deny first, then ask, then allow, whichever settings file holds the rule. */
function decide(command: string, files: { allow?: string[]; ask?: string[]; deny?: string[] }[]) {
  const any = (key: "allow" | "ask" | "deny") =>
    files.some((f) => (f[key] ?? []).some((r) => matches(r, command)));
  if (any("deny")) return "deny";
  if (any("ask")) return "ask";
  if (any("allow")) return "allow";
  return "prompt";
}

test("48.1 a make target runs freely while an accept command still asks", () => {
  const shared = settings.permissions;
  const personal = { allow: ["Bash(werk:*)", "Bash(bun:*)", "Bash(bun src/cli.ts:*)"] };
  expect(decide("make lint", [shared, personal])).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(`werk ${verb} login --actor you`, [shared, personal]), `werk ${verb}`).toBe("ask");
    expect(decide(`bun src/cli.ts ${verb} login --actor you`, [shared, personal]), `bun src/cli.ts ${verb}`).toBe("ask");
  }
});

/** A temporary repository with the biome config, so the hook never touches the checkout. */
function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-hook-")));
  for (const name of ["biome.json", "package.json", "tsconfig.json", ".gitignore"]) {
    if (existsSync(join(REPO, name))) cpSync(join(REPO, name), join(root, name));
  }
  const modules = join(REPO, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(root, "node_modules"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  mkdirSync(join(root, "client"));
  return root;
}
const hook = (root: string, file: string) =>
  Bun.spawnSync(["bun", join(REPO, "src", "claude", "lint-hook.ts")], {
    cwd: root,
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });

test("48.2 an unused import is repaired silently and a hook dependency error reaches the agent", () => {
  const root = sandbox();
  try {
    const file = join(root, "client", "sample.tsx");
    writeFileSync(
      file,
      [
        'import { useEffect, useState } from "react";',
        'import { gone } from "./nope";',
        "",
        "export function Sample() {",
        "    const [n] = useState(0);",
        "    return <div>{n}</div>;",
        "}",
        "",
      ].join("\n"),
    );
    const first = hook(root, file);
    expect(first.exitCode).toBe(0);
    expect(`${first.stdout}${first.stderr}`.trim()).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("gone");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("\n  const [n] = useState(0);");

    writeFileSync(
      file,
      fixed.replace('import { useState }', "import { useEffect, useState }").replace(
        "  return <div>{n}</div>;",
        "  useEffect(() => {\n    console.log(n);\n  }, []);\n  return <div>{n}</div>;",
      ),
    );
    const second = hook(root, file);
    expect(readFileSync(file, "utf8")).toContain("console.log(n)");
    expect(second.exitCode).toBe(2);
    expect(`${second.stdout}${second.stderr}`).toMatch(/useExhaustiveDependencies/);

    writeFileSync(file, readFileSync(file, "utf8").replace("}, []);", "}, [n]);"));
    const third = hook(root, file);
    expect(third.exitCode).toBe(0);
    expect(`${third.stdout}${third.stderr}`.trim()).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const check = (root: string) =>
  Bun.spawnSync(["bun", join(REPO, "src", "claude", "check-subagent-links.ts"), root], { stdout: "pipe", stderr: "pipe" });

test("48.3 a copied subagent fails the check and a restored link passes it", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    cpSync(join(REPO, "src", "agent", "subagents"), join(root, "src", "agent", "subagents"), { recursive: true });
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    const shipped = readdirSync(join(root, "src", "agent", "subagents")).filter((n) => n.endsWith(".md"));
    expect(shipped.length).toBeGreaterThan(0);
    for (const name of shipped) symlinkSync(`../../src/agent/subagents/${name}`, join(root, ".claude", "agents", name));
    // A subagent that only werk's own development uses stays a plain file.
    writeFileSync(join(root, ".claude", "agents", "dev-only.md"), "---\ndescription: dev\n---\nx\n");
    expect(check(root).exitCode).toBe(0);

    const [name] = shipped as [string];
    const link = join(root, ".claude", "agents", name);
    rmSync(link);
    cpSync(join(root, "src", "agent", "subagents", name), link);
    const copied = check(root);
    expect(copied.exitCode).toBe(1);
    expect(copied.stderr.toString()).toContain(name.replace(/\.md$/, ""));
    expect(copied.stderr.toString()).toMatch(/not a link/);

    rmSync(link);
    symlinkSync(`../../src/agent/subagents/${name}`, link);
    expect(check(root).exitCode).toBe(0);

    rmSync(link);
    const missing = check(root);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain(name.replace(/\.md$/, ""));
    expect(missing.stderr.toString()).toMatch(/no link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings stay small, safe and free of skills and servers", () => {
  const allow: string[] = settings.permissions.allow;
  const makefile = readFileSync(join(REPO, "Makefile"), "utf8");
  expect(allow.some((r) => matches(r, "make lint"))).toBe(true);
  const targets = [...makefile.matchAll(/^([a-z0-9-]+):.*## /gm)].map((m) => m[1] as string);
  for (const target of targets) expect(allow.some((r) => matches(r, `make ${target}`)), `make ${target}`).toBe(true);
  expect(allow.some((r) => matches(r, "werk show root"))).toBe(true);
  for (const rule of allow) {
    expect(rule).not.toMatch(/^(Write|Edit|MultiEdit)\(/);
    expect(rule).not.toMatch(/\b(curl|wget|ssh|scp|nc|git push|gh|npm publish|WebFetch)\b/);
    expect(rule).not.toMatch(/(~|\.\.\/|\/etc\/|\/Users\/)/);
  }
  expect(existsSync(join(REPO, ".claude", "skills"))).toBe(false);
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(settings.mcpServers).toBeUndefined();
  expect(JSON.stringify(settings)).not.toMatch(/mcp__|enableAllProjectMcpServers/);
  // A personal settings file is ignored by git.
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-ignore-"));
  try {
    cpSync(join(REPO, ".gitignore"), join(root, ".gitignore"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "settings.local.json"), "{}");
    const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: root }).stdout.toString();
    expect(status).not.toContain("settings.local.json");
    expect(Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: root }).exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
