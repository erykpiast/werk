import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

test("48.1 a make target is allowed, accept, remove and restore ask", () => {
  const allow: string[] = settings.permissions.allow;
  const ask: string[] = settings.permissions.ask;
  expect(allow.some((r) => /^Bash\(make[ :]/.test(r))).toBe(true);
  // An ask rule beats an allow rule from any settings file, so a personal allow entry cannot turn it off.
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask.some((r) => r.startsWith(`Bash(werk ${verb}`))).toBe(true);
    expect(ask.some((r) => r.startsWith(`Bash(bun src/cli.ts ${verb}`))).toBe(true);
  }
  // The shared file puts no accept, remove or restore in its own allow list.
  for (const r of allow) expect(r).not.toMatch(/accept|remove|restore/);
});

const hook = (file: string) =>
  Bun.spawnSync(["bun", join(ROOT, "src", "claude", "lint-hook.ts")], {
    cwd: ROOT,
    stdin: Buffer.from(JSON.stringify({ tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });

test("48.2 the hook repairs the file silently, then reports a lint error and the agent fixes it", () => {
  const dir = join(ROOT, ".werk-heldout", "fixtures-48");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "sample.tsx");
  writeFileSync(file, `import { useState } from "react";\nimport { useEffect } from "react";\n\nexport function A() {\n      const [n] = useState(0);\n  return <div>{n}</div>;\n}\n`);
  try {
    const first = hook(file);
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString() + first.stderr.toString()).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("useEffect");
    expect(fixed).toContain("\n  const [n] = useState(0);");
    writeFileSync(file, `import { useEffect, useState } from "react";\n\nexport function A({ x }: { x: number }) {\n  const [n] = useState(0);\n  useEffect(() => {\n    console.log(x);\n  }, []);\n  return <div>{n}</div>;\n}\n`);
    const second = hook(file);
    expect(second.exitCode).toBe(2);
    expect(second.stderr.toString()).toMatch(/useExhaustiveDependencies|dependenc/i);
    expect(readFileSync(file, "utf8")).toContain("console.log(x)");
    writeFileSync(file, `import { useEffect, useState } from "react";\n\nexport function A({ x }: { x: number }) {\n  const [n] = useState(0);\n  useEffect(() => {\n    console.log(x);\n  }, [x]);\n  return <div>{n}</div>;\n}\n`);
    const third = hook(file);
    expect(third.exitCode).toBe(0);
    expect(third.stdout.toString() + third.stderr.toString()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repoWithLinks() {
  const root = mkdtempSync(join(tmpdir(), "heldout-48-"));
  mkdirSync(join(root, "src", "agent", "subagents"), { recursive: true });
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  for (const name of ["prototyper", "test-scope"]) {
    cpSync(join(ROOT, "src", "agent", "subagents", `${name}.md`), join(root, "src", "agent", "subagents", `${name}.md`));
    symlinkSync(`../../src/agent/subagents/${name}.md`, join(root, ".claude", "agents", `${name}.md`));
  }
  return root;
}
const check = (root: string) => {
  const r = Bun.spawnSync(["bun", join(ROOT, "src", "claude", "check-subagent-links.ts"), root], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("48.3 a copied subagent fails the check, a restored link passes it", () => {
  const root = repoWithLinks();
  try {
    expect(check(root).code).toBe(0);
    const link = join(root, ".claude", "agents", "prototyper.md");
    rmSync(link);
    cpSync(join(root, "src", "agent", "subagents", "prototyper.md"), link);
    const copied = check(root);
    expect(copied.code).not.toBe(0);
    expect(copied.out).toContain("prototyper");
    expect(copied.out).toMatch(/not a link/);
    rmSync(link);
    symlinkSync("../../src/agent/subagents/prototyper.md", link);
    expect(check(root).code).toBe(0);
    rmSync(link);
    const missing = check(root);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("prototyper");
    symlinkSync("../../src/agent/subagents/prototyper.md", link);
    writeFileSync(join(root, ".claude", "agents", "dev-only.md"), "---\nname: dev-only\n---\nonly for werk's development\n");
    expect(check(root).code).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 the shared settings are small, safe, and free of skills and servers", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow.length).toBeLessThanOrEqual(5);
  for (const r of allow) expect(r).toMatch(/^Bash\((make|werk|bun src\/cli\.ts)[ :]/);
  for (const r of allow) expect(r).not.toMatch(/curl|wget|ssh|npm|rm |sudo|install|git push/);
  const mk = readFileSync(join(ROOT, "Makefile"), "utf8");
  void mk;
  expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcpjsonServers/);
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" }).stdout.toString();
  expect(tracked).not.toMatch(/SKILL\.md|\.mcp\.json/);
  // A personal settings file is ignored by git.
  const tmp = mkdtempSync(join(tmpdir(), "heldout-48g-"));
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: tmp });
    cpSync(join(ROOT, ".gitignore"), join(tmp, ".gitignore"));
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(join(tmp, ".claude", "settings.local.json"), "{}");
    const status = Bun.spawnSync(["git", "status", "--porcelain", "-uall"], { cwd: tmp, stdout: "pipe" }).stdout.toString();
    expect(status).not.toContain("settings.local.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
