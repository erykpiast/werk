import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

test("48.1 make and werk are allowed, accept/remove/restore ask, a personal allow cannot turn the question off", () => {
  const allow: string[] = settings.permissions.allow;
  const ask: string[] = settings.permissions.ask;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((a) => a.startsWith("Bash(werk"))).toBe(true);
  for (const verb of ["accept", "remove", "restore"]) {
    expect(ask).toContain(`Bash(werk ${verb}:*)`);
    expect(ask).toContain(`Bash(bun src/cli.ts ${verb}:*)`);
  }
  // Claude Code resolves a deny first, then an ask, then an allow, whichever file holds each rule,
  // so the shared ask entries beat a personal "Bash(werk:*)" allow. The ask entries are in the shared file, not in a deny list.
  expect(settings.permissions.deny ?? []).toEqual([]);
  // no ask entry is overridden by a shared allow entry of the same command
  for (const a of ask) expect(allow).not.toContain(a);
});

async function runHook(file: string) {
  const r = Bun.spawn(["bash", "-c", settings.hooks.PostToolUse[0].hooks[0].command], {
    cwd: ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    stdin: new Response(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, out, code] = await Promise.all([new Response(r.stderr).text(), new Response(r.stdout).text(), r.exited]);
  return { code, err, out };
}

test("48.2 the lint hook repairs silently and reports what it cannot fix", async () => {
  expect(settings.hooks.PostToolUse[0].matcher).toMatch(/Edit/);
  const dir = mkdtempSync(join(ROOT, ".werk-heldout", "hook-"));
  try {
    const file = join(dir, "widget.tsx");
    writeFileSync(file, `import { useEffect } from "react";\nimport { unused } from "./unused";\nexport function Widget() {\n        return <div>hi</div>;\n}\n`);
    const first = await runHook(file);
    expect(first.code).toBe(0);
    expect(first.err).toBe("");
    const fixed = readFileSync(file, "utf8");
    expect(fixed).not.toContain("unused");
    expect(fixed).toContain("\n  return <div>hi</div>;\n");
    // add a hook with a missing dependency
    writeFileSync(file, `import { useEffect } from "react";\nexport function Widget({ id }: { id: string }) {\n  useEffect(() => {\n    console.log(id);\n  }, []);\n  return <div>hi</div>;\n}\n`);
    const second = await runHook(file);
    expect(readFileSync(file, "utf8")).toContain("console.log(id)");
    expect(second.err).toMatch(/useExhaustiveDependencies|dependenc/i);
    expect(second.code).toBe(2);
    writeFileSync(file, `import { useEffect } from "react";\nexport function Widget({ id }: { id: string }) {\n  useEffect(() => {\n    console.log(id);\n  }, [id]);\n  return <div>hi</div>;\n}\n`);
    const third = await runHook(file);
    expect(third.code).toBe(0);
    expect(third.err).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);

const check = (root: string) => {
  const r = Bun.spawnSync(["bun", join(ROOT, "src/claude/check-subagent-links.ts"), root], { cwd: ROOT });
  return { code: r.exitCode, err: r.stderr.toString() };
};

test("48.3 a copied subagent fails, a restored link passes, a missing link fails, a dev-only file is fine", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-ho-agents-"));
  try {
    mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
    mkdirSync(join(root, ".claude/agents"), { recursive: true });
    for (const n of ["prototyper", "test-scope"]) {
      cpSync(join(ROOT, "src/agent/subagents", `${n}.md`), join(root, "src/agent/subagents", `${n}.md`));
      symlinkSync(`../../src/agent/subagents/${n}.md`, join(root, ".claude/agents", `${n}.md`));
    }
    writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: dev-only\n---\nonly for werk's development\n");
    expect(check(root).code).toBe(0);
    rmSync(join(root, ".claude/agents/prototyper.md"));
    cpSync(join(root, "src/agent/subagents/prototyper.md"), join(root, ".claude/agents/prototyper.md"));
    const copied = check(root);
    expect(copied.code).not.toBe(0);
    expect(copied.err).toContain("prototyper");
    expect(copied.err).toMatch(/not a link/);
    rmSync(join(root, ".claude/agents/prototyper.md"));
    symlinkSync("../../src/agent/subagents/prototyper.md", join(root, ".claude/agents/prototyper.md"));
    expect(check(root).code).toBe(0);
    rmSync(join(root, ".claude/agents/test-scope.md"));
    const gone = check(root);
    expect(gone.code).not.toBe(0);
    expect(gone.err).toContain("test-scope");
    expect(gone.err).not.toContain("dev-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("48.4 shared settings are small and safe, no skills or servers, a personal file is ignored", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow.length).toBeLessThanOrEqual(6);
  for (const a of allow) {
    expect(a).toMatch(/^Bash\((make|werk|bun src\/cli\.ts):\*\)$/);
    expect(a).not.toMatch(/curl|wget|ssh|scp|git push|npm publish|rm |sudo|>|\/\.\.|~/);
  }
  expect(settings.mcpServers).toBeUndefined();
  expect(settings.enableAllProjectMcpServers).toBeUndefined();
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(existsSync(join(ROOT, ".claude", "skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".claude", "commands"))).toBe(existsSync(join(ROOT, ".claude", "commands")));
  const tracked = Bun.spawnSync(["git", "ls-files", ".claude", ".mcp.json"], { cwd: ROOT }).stdout.toString();
  expect(tracked).not.toMatch(/skills\/|SKILL\.md|\.mcp\.json/);
  // a personal settings file: ignored by git, in a repository that has the project's ignore file
  const repo = mkdtempSync(join(tmpdir(), "werk-ho-ign-"));
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    cpSync(join(ROOT, ".gitignore"), join(repo, ".gitignore"));
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(werk:*)"]}}');
    const st = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString();
    expect(st).not.toContain("settings.local.json");
    expect(Bun.spawnSync(["git", "check-ignore", "-q", ".claude/settings.local.json"], { cwd: repo }).exitCode).toBe(0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  void readdirSync;
});
