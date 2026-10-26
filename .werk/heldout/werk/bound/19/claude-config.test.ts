import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const settings = JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8"));
const allow: string[] = settings.permissions?.allow ?? [];
const ask: string[] = settings.permissions?.ask ?? [];

test("48.1 a make target runs freely while accept, remove and restore still ask", () => {
  expect(allow).toContain("Bash(make:*)");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask).toContain(`Bash(werk ${verb}:*)`);
    expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
  }
  // A rule in "ask" outranks a rule in "allow", also from a personal file (Claude Code evaluates deny, ask, then allow).
  // A personal allow of every werk command is "Bash(werk:*)": it must not be needed to lift the ask.
  expect(ask.some((rule) => rule.startsWith("Bash(werk accept"))).toBe(true);
  expect(settings.permissions.deny ?? []).not.toContain("Bash(make:*)");
});

function repoCopy(): string {
  const dest = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-cc-")));
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout.toString().split("\n").filter(Boolean);
  for (const f of tracked) {
    if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dest, f), { recursive: true, verbatimSymlinks: true });
  }
  symlinkSync(join(REPO, "node_modules"), join(dest, "node_modules"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dest });
  return dest;
}

const hook = (dir: string, file: string) =>
  Bun.spawnSync(["bun", join(dir, "src/claude/lint-hook.ts")], {
    cwd: dir,
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { file_path: join(dir, file) } })),
  });

test("48.2 the hook repairs an unused import and wrong indentation silently, and reports a missing hook dependency", () => {
  const dir = repoCopy();
  try {
    const file = "client/app/heldout-sample.tsx";
    writeFileSync(
      join(dir, file),
      `import { useEffect, useState } from "react";\nimport { clsx } from "clsx";\n\nexport function Sample() {\n      const [n] = useState(0);\n  return <p>{n}</p>;\n}\n`,
    );
    const first = hook(dir, file);
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString() + first.stderr.toString()).toBe("");
    const fixed = readFileSync(join(dir, file), "utf8");
    expect(fixed).not.toContain("clsx");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("\n  const [n] = useState(0);");

    writeFileSync(
      join(dir, file),
      `import { useEffect, useState } from "react";\n\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, []);\n  return <p>{n}</p>;\n}\n`,
    );
    const second = hook(dir, file);
    expect(readFileSync(join(dir, file), "utf8")).toContain("useEffect");
    expect(second.exitCode).toBe(2);
    expect(second.stderr.toString() + second.stdout.toString()).toMatch(/useExhaustiveDependencies|dependenc/i);

    writeFileSync(
      join(dir, file),
      `import { useEffect, useState } from "react";\n\nexport function Sample({ id }: { id: string }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(id.length);\n  }, [id]);\n  return <p>{n}</p>;\n}\n`,
    );
    const third = hook(dir, file);
    expect(third.exitCode).toBe(0);
    expect(third.stdout.toString() + third.stderr.toString()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

test("48.3 a copied subagent fails the link check and a restored link passes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    cpSync(join(REPO, "src/agent/subagents"), join(dir, "src/agent/subagents"), { recursive: true });
    mkdirSync(join(dir, ".claude/agents"), { recursive: true });
    const shipped = readdirSync(join(dir, "src/agent/subagents")).filter((f) => f.endsWith(".md"));
    expect(shipped.length).toBeGreaterThan(0);
    const link = (name: string) =>
      symlinkSync(`../../src/agent/subagents/${name}`, join(dir, ".claude/agents", name));
    for (const name of shipped) link(name);
    writeFileSync(join(dir, ".claude/agents/dev-only.md"), "---\nname: dev-only\n---\nOnly for werk's own development.\n");
    const check = () =>
      Bun.spawnSync(["bun", join(REPO, "src/claude/check-subagent-links.ts"), dir], { cwd: REPO });
    const out = (r: ReturnType<typeof check>) => r.stdout.toString() + r.stderr.toString();

    expect(check().exitCode, out(check())).toBe(0);
    const name = shipped[0] as string;
    const target = join(dir, ".claude/agents", name);
    rmSync(target);
    cpSync(join(dir, "src/agent/subagents", name), target);
    const copied = check();
    expect(copied.exitCode).not.toBe(0);
    expect(out(copied)).toContain(name.replace(/\.md$/, ""));
    expect(out(copied)).toMatch(/not a link|link/);
    rmSync(target);
    link(name);
    expect(check().exitCode, out(check())).toBe(0);
    rmSync(target);
    const missing = check();
    expect(missing.exitCode).not.toBe(0);
    expect(out(missing)).toContain(name.replace(/\.md$/, ""));
    link(name);
    expect(check().exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("48.4 the shared settings stay small and safe, with no skills or servers, and a personal file is ignored", () => {
  expect(allow.length).toBeLessThanOrEqual(5);
  for (const rule of allow) {
    expect(rule).not.toMatch(/curl|wget|ssh|scp|git push|npm publish|\bsudo\b|rm -rf|\/Users|~\/|\/tmp|\.\.\//);
  }
  expect(allow.some((r) => r.startsWith("Bash(make"))).toBe(true);
  expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcp/);
  expect(existsSync(join(REPO, ".mcp.json"))).toBe(false);
  expect(existsSync(join(REPO, ".claude/skills"))).toBe(false);
  const skills = Bun.spawnSync(["git", "ls-files", "*SKILL.md", ".claude/skills", ".claude/commands"], { cwd: REPO });
  expect(skills.stdout.toString().trim()).toBe("");

  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-ignore-"));
  try {
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
    cpSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(ls:*)"]}}');
    const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: dir });
    expect(status.stdout.toString()).not.toContain("settings.local.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
