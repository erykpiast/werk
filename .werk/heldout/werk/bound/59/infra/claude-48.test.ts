import { afterAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = (what: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `werk-heldout-${what}-`)));
  dirs.push(d);
  return d;
};
const settings = JSON.parse(
  readFileSync(join(CHECKOUT, ".claude/settings.json"), "utf8"),
);

function linkModules(dir: string) {
  mkdirSync(join(dir, "node_modules"));
  for (const name of readdirSync(join(CHECKOUT, "node_modules"))) {
    if (name === ".vite") continue;
    symlinkSync(join(CHECKOUT, "node_modules", name), join(dir, "node_modules", name));
  }
}

// --- A model of Claude Code's rule order: deny, then ask, then allow; no match means ask. ---
type Rules = { allow?: string[]; ask?: string[]; deny?: string[] };
const matches = (rule: string, command: string) => {
  const m = /^Bash\((.*?)(:\*)?\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1] as string;
  return m[2] ? command === prefix || command.startsWith(`${prefix} `) : command === prefix;
};
function decide(scopes: Rules[], command: string): "allow" | "ask" | "deny" {
  const any = (key: keyof Rules) =>
    scopes.some((s) => (s[key] ?? []).some((r) => matches(r, command)));
  if (any("deny")) return "deny";
  if (any("ask")) return "ask";
  if (any("allow")) return "allow";
  return "ask";
}

test("48.1 a make target runs with no question, accept, remove and restore still ask despite a personal allow", () => {
  const shared: Rules = settings.permissions;
  const personal: Rules = { allow: ["Bash(werk:*)", "Bash(bun src/cli.ts:*)", "Bash(make:*)"] };
  const scopes = [shared, personal];
  for (const target of ["lint", "typecheck", "test", "test-coverage", "e2e", "check", "dev", "smoke", "release-build"]) {
    expect(decide(scopes, `make ${target}`)).toBe("allow");
  }
  for (const verb of ["accept", "remove", "restore"]) {
    expect(decide(scopes, `werk ${verb} some-card`)).toBe("ask");
    expect(decide(scopes, `bun src/cli.ts ${verb} some-card`)).toBe("ask");
    // The personal allow alone would allow them: only the shared ask entry makes the question.
    expect(decide([personal], `werk ${verb} some-card`)).toBe("allow");
  }
  expect(decide(scopes, "werk status some-card")).toBe("allow");
  // The commands that the agent is told to run are the quoted absolute self command, which no entry names.
  const selfCommand = `"${process.execPath}" "${CHECKOUT}/src/cli.ts" accept some-card`;
  expect(decide(scopes, selfCommand)).toBe("ask");
});

const FIXTURE_BAD = `import { useState } from "react";
export function A() {
        const x = 1;
    return <div>{x}</div>;
}
`;
const HOOK_SETTINGS_COMMAND: string =
  settings.hooks.PostToolUse[0].hooks[0].command;

function hookProject() {
  const dir = tmp("hook");
  mkdirSync(join(dir, "src/claude"), { recursive: true });
  mkdirSync(join(dir, "client"), { recursive: true });
  cpSync(join(CHECKOUT, "src/claude/lint-hook.ts"), join(dir, "src/claude/lint-hook.ts"));
  for (const f of ["biome.json", "package.json", ".gitignore", "tsconfig.json"]) {
    cpSync(join(CHECKOUT, f), join(dir, f));
  }
  linkModules(dir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  return dir;
}
async function runSettingsHook(dir: string, file: string, tool = "Edit") {
  const proc = Bun.spawn(["sh", "-c", HOOK_SETTINGS_COMMAND], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    stdin: new Response(JSON.stringify({ tool_name: tool, tool_input: { file_path: file } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

test("48.2 the hook repairs an unused import silently, then reports a missing hook dependency, then goes quiet", async () => {
  expect(settings.hooks.PostToolUse[0].matcher).toContain("Edit");
  const dir = hookProject();
  const file = join(dir, "client/a.tsx");
  writeFileSync(file, FIXTURE_BAD);
  const first = await runSettingsHook(dir, file);
  expect(first.err).toBe("");
  expect(first.code).toBe(0);
  expect(first.out).toBe("");
  const fixed = readFileSync(file, "utf8");
  expect(existsSync(file)).toBe(true);
  expect(fixed).not.toContain("useState");
  expect(fixed).toContain("\n  const x = 1;\n");
  expect(fixed).toContain("\n  return <div>{x}</div>;\n");

  const withHook = `import { useEffect } from "react";
export function A({ id }: { id: number }) {
  useEffect(() => {
    console.log(id);
  }, []);
  return <div>{id}</div>;
}
`;
  writeFileSync(file, withHook);
  const second = await runSettingsHook(dir, file);
  expect(readFileSync(file, "utf8")).toContain("useEffect");
  expect(second.code).toBe(2);
  expect(second.err).toMatch(/useExhaustiveDependencies|dependenc/i);
  expect(second.err).toContain("id");

  writeFileSync(file, withHook.replace("[]", "[id]"));
  const third = await runSettingsHook(dir, file);
  expect(third.code).toBe(0);
  expect(third.err).toBe("");
}, 120000);

function linkProject() {
  const dir = tmp("links");
  cpSync(join(CHECKOUT, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(CHECKOUT, "package.json"), join(dir, "package.json"));
  cpSync(join(CHECKOUT, "tsconfig.json"), join(dir, "tsconfig.json"));
  mkdirSync(join(dir, ".claude/agents"), { recursive: true });
  for (const name of readdirSync(join(CHECKOUT, ".claude/agents"))) {
    symlinkSync(
      `../../src/agent/subagents/${name}`,
      join(dir, ".claude/agents", name),
    );
  }
  linkModules(dir);
  return dir;
}
async function check(dir: string) {
  const proc = Bun.spawn(["bun", "src/claude/check-subagent-links.ts"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { text: out + err, code };
}

test("48.3 a copied subagent fails the check, a restored link passes, a removed link fails, a dev-only file is ignored", async () => {
  const dir = linkProject();
  const agents = join(dir, ".claude/agents");
  expect(lstatSync(join(agents, "prototyper.md")).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(agents, "test-scope.md")).isSymbolicLink()).toBe(true);
  expect((await check(dir)).code).toBe(0);

  const link = join(agents, "prototyper.md");
  const body = readFileSync(link, "utf8");
  unlinkSync(link);
  writeFileSync(link, body);
  const copied = await check(dir);
  expect(copied.code).not.toBe(0);
  expect(copied.text).toContain("prototyper");
  expect(copied.text).toMatch(/not a link/);
  expect(copied.text).not.toContain("test-scope");

  unlinkSync(link);
  symlinkSync("../../src/agent/subagents/prototyper.md", link);
  expect((await check(dir)).code).toBe(0);

  unlinkSync(join(agents, "test-scope.md"));
  const removed = await check(dir);
  expect(removed.code).not.toBe(0);
  expect(removed.text).toContain("test-scope");
  expect(removed.text).toMatch(/no link/);

  symlinkSync("../../src/agent/subagents/test-scope.md", join(agents, "test-scope.md"));
  writeFileSync(join(agents, "dev-only.md"), "---\nname: dev-only\ndescription: only werk's development uses this\n---\nBody\n");
  const devOnly = await check(dir);
  expect(devOnly.text).toBe("");
  expect(devOnly.code).toBe(0);
}, 120000);

test("48.4 the shared settings allow make and werk only, hold no skill or server, and a personal file is ignored", () => {
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(make:*)");
  expect(allow.some((r) => r.startsWith("Bash(werk"))).toBe(true);
  expect(allow.length).toBeLessThanOrEqual(5);
  const programs = allow.map((r) => /^Bash\(([a-z]+)/.exec(r)?.[1]);
  for (const p of programs) expect(["make", "werk", "bun"]).toContain(p as string);
  for (const r of allow) {
    expect(r).not.toMatch(/curl|wget|ssh|scp|rsync|git push|npm publish|sudo|\.\.|~\//);
  }
  // Every make target the Makefile lists is allowed by the one make entry.
  const makefile = readFileSync(join(CHECKOUT, "Makefile"), "utf8");
  const targets = [...makefile.matchAll(/^([a-z0-9-]+):.*##/gm)].map((m) => m[1]);
  expect(targets.length).toBeGreaterThan(8);
  const scopes = [settings.permissions as Rules];
  for (const t of targets) expect(decide(scopes, `make ${t}`)).toBe("allow");
  // No recipe line names a path outside the repository or a network program, other than the package manager.
  const recipes = makefile.split("\n").filter((l) => l.startsWith("\t"));
  const outside = recipes.filter((l) => /(^|\s)(\/|~|\$HOME)\S*/.test(l.replace(/\/dev\/null/g, "")) && !/echo/.test(l));
  console.log("recipe lines naming an absolute path:", outside);
  const network = recipes.filter((l) => /curl|wget|bun install|bunx playwright install/.test(l));
  console.log("recipe lines that can reach the network:", network);

  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: CHECKOUT }).stdout.toString().split("\n");
  expect(tracked.filter((f) => /(^|\/)SKILL\.md$|(^|\/)\.claude\/skills\//.test(f))).toEqual([]);
  expect(tracked.filter((f) => /(^|\/)\.mcp\.json$/.test(f))).toEqual([]);
  for (const key of ["mcpServers", "enabledMcpjsonServers", "enableAllProjectMcpServers", "skills"]) {
    expect(settings[key]).toBeUndefined();
  }

  const repo = tmp("ignore");
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  cpSync(join(CHECKOUT, ".gitignore"), join(repo, ".gitignore"));
  mkdirSync(join(repo, ".claude"));
  cpSync(join(CHECKOUT, ".claude/settings.json"), join(repo, ".claude/settings.json"));
  writeFileSync(join(repo, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git:*)"] } }));
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString();
  expect(status).not.toContain("settings.local.json");
  const ignored = Bun.spawnSync(["git", "check-ignore", ".claude/settings.local.json"], { cwd: repo });
  expect(ignored.exitCode).toBe(0);
});
