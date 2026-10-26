import { expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./repo-copy.ts";

const ROOT = join(import.meta.dir, "..", "..");
const settings = JSON.parse(await Bun.file(join(ROOT, ".claude/settings.json")).text());
const allow: string[] = settings.permissions.allow;
const ask: string[] = settings.permissions.ask;

/** Does a rule of the form Bash(prefix:*) match the command? */
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.+):\*\)$/.exec(rule);
  return !!m && (command === m[1] || command.startsWith(`${m[1]} `));
};
/** Claude Code's precedence: a matching ask rule wins over any allow rule, also a personal one. */
const decision = (command: string, personalAllow: string[] = []) =>
  ask.some((r) => matches(r, command)) ? "ask" : [...allow, ...personalAllow].some((r) => matches(r, command)) ? "allow" : "ask";

test("48.1 make targets run freely, accept/remove/restore ask, and a personal allow does not turn it off", () => {
  const personal = ["Bash(werk:*)", "Bash(bun src/cli.ts:*)"];
  expect(decision("make lint", personal)).toBe("allow");
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decision(`werk ${verb} login`, personal)).toBe("ask");
    expect(decision(`bun src/cli.ts ${verb} login`, personal)).toBe("ask");
  }
  expect(decision("werk show login", personal)).toBe("allow");
});

async function hookDir() {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-hook-"));
  for (const f of ["biome.json", "package.json", "tsconfig.json"]) cpSync(join(ROOT, f), join(dir, f));
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "client"));
  await sh(["git", "init", "-q"], dir);
  return dir;
}
async function hook(dir: string, file: string) {
  const p = Bun.spawn(["bun", join(ROOT, "src/claude/lint-hook.ts")], {
    cwd: dir,
    stdin: new Response(JSON.stringify({ tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { err, code };
}

test("48.2 the hook repairs an unused import and bad indentation silently, then reports a hook dependency error", async () => {
  const dir = await hookDir();
  try {
    const file = join(dir, "client", "view.tsx");
    writeFileSync(file, 'import { x } from "./x";\nexport const a = () => {\n        return 1;\n};\n');
    const first = await hook(dir, file);
    expect(first.err).toBe("");
    expect(first.code).toBe(0);
    expect(await Bun.file(file).text()).toBe("export const a = () => {\n  return 1;\n};\n");

    writeFileSync(
      file,
      'import { useEffect } from "react";\nexport function V({ a }: { a: number }) {\n  useEffect(() => {\n    console.log(a);\n  }, []);\n  return null;\n}\n',
    );
    const second = await hook(dir, file);
    expect(second.code).toBe(2);
    expect(second.err).toContain("useEffect");
    expect(second.err.toLowerCase()).toContain("dependenc");
    expect(await Bun.file(file).text()).toContain("useEffect");

    writeFileSync(
      file,
      'import { useEffect } from "react";\nexport function V({ a }: { a: number }) {\n  useEffect(() => {\n    console.log(a);\n  }, [a]);\n  return null;\n}\n',
    );
    const third = await hook(dir, file);
    expect(third.err).toBe("");
    expect(third.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);

async function linkRoot() {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  mkdirSync(join(root, "src/agent/subagents"), { recursive: true });
  mkdirSync(join(root, ".claude/agents"), { recursive: true });
  for (const n of readdirSync(join(ROOT, "src/agent/subagents")).filter((f) => f.endsWith(".md"))) {
    cpSync(join(ROOT, "src/agent/subagents", n), join(root, "src/agent/subagents", n));
    symlinkSync(`../../src/agent/subagents/${n}`, join(root, ".claude/agents", n));
  }
  return root;
}
const check = (root: string) => sh(["bun", join(ROOT, "src/claude/check-subagent-links.ts"), root], ROOT);

test("48.3 a copied subagent fails, a restored link passes, a missing link fails, a dev-only plain file is fine", async () => {
  const root = await linkRoot();
  try {
    expect((await check(root)).code).toBe(0);
    const agent = join(root, ".claude/agents/prototyper.md");
    rmSync(agent);
    cpSync(join(root, "src/agent/subagents/prototyper.md"), agent);
    const copied = await check(root);
    expect(copied.code).not.toBe(0);
    expect(copied.all).toContain("prototyper");
    expect(copied.all).toMatch(/copy, not a link/);
    rmSync(agent);
    symlinkSync("../../src/agent/subagents/prototyper.md", agent);
    expect((await check(root)).code).toBe(0);
    // A subagent only werk's own development uses is a plain file and is not checked.
    writeFileSync(join(root, ".claude/agents/dev-only.md"), "---\nname: dev-only\n---\n");
    expect((await check(root)).code).toBe(0);
    rmSync(agent);
    const missing = await check(root);
    expect(missing.code).not.toBe(0);
    expect(missing.all).toContain("prototyper");
    expect(missing.all).toMatch(/no link/);
    expect(lstatSync(join(root, ".claude/agents/test-scope.md")).isSymbolicLink()).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);

test("48.4 the shared settings are small and safe, have no skills or servers, and a personal file is ignored", async () => {
  expect(allow.every((r) => /^Bash\((make|werk|bun src\/cli\.ts):\*\)$/.test(r))).toBe(true);
  expect(allow).toContain("Bash(make:*)");
  expect(allow).toContain("Bash(werk:*)");
  // No allowed command names a network tool or an absolute or parent path.
  for (const r of allow) expect(r).not.toMatch(/curl|wget|ssh|scp|git push|\.\.|\/(?:etc|usr|tmp|Users|home)/);
  expect(existsSync(join(ROOT, ".claude/skills"))).toBe(false);
  expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  expect(JSON.stringify(settings)).not.toMatch(/mcpServers|enabledMcp/);

  const repo = mkdtempSync(join(tmpdir(), "werk-heldout-ignore-"));
  try {
    await sh(["git", "init", "-q"], repo);
    cpSync(join(ROOT, ".gitignore"), join(repo, ".gitignore"));
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(werk:*)"]}}');
    const status = await sh(["git", "status", "--porcelain", "-uall"], repo);
    expect(status.stdout).not.toContain("settings.local.json");
    expect((await sh(["git", "check-ignore", ".claude/settings.local.json"], repo)).code).toBe(0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
