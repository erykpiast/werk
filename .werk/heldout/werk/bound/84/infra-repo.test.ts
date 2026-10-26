// Held-out checks of the repository tasks. Every destructive step runs on a temporary copy.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = realpathSync(join(import.meta.dir, ".."));
const roots: string[] = [];

type R = { code: number; out: string };
function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}): R {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
}

/** A copy of the checkout as one git repository with a commit, and its own installed packages. */
function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-infra-copy-")));
  roots.push(root);
  const files = sh(CHECKOUT, ["git", "ls-files", "-co", "--exclude-standard"]).out
    .split("\n").filter((f) => f !== "" && !f.startsWith(".werk-heldout/") && existsSync(join(CHECKOUT, f)));
  for (const f of files) cpSync(join(CHECKOUT, f), join(root, f), { recursive: true, verbatimSymlinks: true });
  const install = sh(root, ["bun", "install", "--frozen-lockfile"]);
  if (install.code !== 0) throw new Error(install.out);
  sh(root, ["git", "init", "-q", "--initial-branch=main"]);
  sh(root, ["git", "config", "user.name", "t"]);
  sh(root, ["git", "config", "user.email", "t@t.invalid"]);
  sh(root, ["git", "add", "-A"]);
  sh(root, ["git", "commit", "-q", "-m", "copy"]);
  return root;
}

const cleanup = () => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); };
import { afterAll } from "bun:test";
afterAll(cleanup);

const T = 900_000;
const PURE = "src/cli/card-id.ts";
const OWN = "src/cli/card-id.test.ts";

test("01.1 make test has no coverage check; make test-coverage lists pure files; a deleted own test gives 0%", () => {
  const dir = copy();
  const t = sh(dir, ["make", "test"]);
  if (t.code !== 0) throw new Error(t.out.split("\n").filter((l) => !l.startsWith("(pass)")).slice(-60).join("\n"));
  expect(t.out).not.toMatch(/coverage|% Lines|pure files/i);
  const c = sh(dir, ["make", "test-coverage"]);
  expect(c.code).toBe(0);
  const listed = readFileSync(join(dir, "pure-files.txt"), "utf8").split("\n").filter((l) => l !== "" && !l.startsWith("#"));
  for (const f of listed) expect(c.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  unlinkSync(join(dir, OWN));
  const c2 = sh(dir, ["make", "test-coverage"]);
  expect(c2.code).not.toBe(0);
  expect(c2.out).toMatch(new RegExp(`\\b0(\\.0+)?%\\s+${PURE}`));
  expect(c2.out).toContain(OWN);
  const t2 = sh(dir, ["make", "test"]);
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/pure files|under 90%/i);
}, T);

test("61.4 coverage gate fails below 90% and passes again after restore", () => {
  const dir = copy();
  expect(sh(dir, ["make", "test-coverage"]).code).toBe(0);
  const orig = readFileSync(join(dir, OWN), "utf8");
  writeFileSync(join(dir, OWN), `import { expect, test } from "bun:test";\nimport "./card-id.ts";\ntest("x", () => expect(1).toBe(1));\n`);
  expect(sh(dir, ["make", "test"]).code).toBe(0);
  const c = sh(dir, ["make", "test-coverage"]);
  expect(c.code).not.toBe(0);
  expect(c.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${PURE}`));
  writeFileSync(join(dir, OWN), orig);
  expect(sh(dir, ["make", "test-coverage"]).code).toBe(0);
}, T);

test("61.2 werk help lists every verb, and a new verb module appears with no other edit", () => {
  const dir = copy();
  const help = sh(dir, ["bun", "src/cli.ts", "help"]);
  expect(help.code).toBe(0);
  const verbs = readFileSync(join(dir, "src/cli/verb-modules.ts"), "utf8");
  void verbs;
  const names = [...help.out.matchAll(/^ {2}([a-z-]+)(?: |$)/gm)].map((m) => m[1]);
  expect(names).toContain("help");
  // every module in src/verbs registers a name; each must be named
  const modules = sh(dir, ["ls", "src/verbs"]).out.split("\n").filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts");
  for (const m of modules) {
    const src = readFileSync(join(dir, "src/verbs", m), "utf8");
    for (const mm of src.matchAll(/registerVerb\(\{\s+name: "([a-z-]+)"/g)) expect(names).toContain(mm[1]);
  }
  writeFileSync(join(dir, "src/verbs/ping.ts"), `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Print pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`);
  const again = sh(dir, ["bun", "src/cli.ts", "help"]);
  expect(again.out).toMatch(/^ {2}ping(?: |$)/m);
  for (const n of names) expect(again.out).toContain(`  ${n}`);
  expect(sh(dir, ["git", "status", "--short"]).out.trim()).toBe("?? src/verbs/ping.ts");
}, T);

test("61.3 make test passes with no claude on PATH and leaves the tree clean", () => {
  const dir = copy();
  const bin = join(dir, "..", "nobin-" + Math.random().toString(36).slice(2));
  mkdirSync(bin);
  roots.push(bin);
  for (const tool of ["bun", "make", "git"]) {
    const found = sh(dir, ["which", tool]).out.trim();
    symlinkSync(found, join(bin, tool));
  }
  const PATH = `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  expect(sh(dir, ["/bin/sh", "-c", "command -v claude"], { PATH }).code).not.toBe(0);
  const r = sh(dir, ["make", "test"], { PATH });
  if (r.code !== 0) throw new Error(r.out.split("\n").filter((l) => !l.startsWith("(pass)")).slice(-60).join("\n"));
  expect(sh(dir, ["git", "status", "--short"]).out.trim()).toBe("");
}, T);

test("61.1 fresh clone: empty first commit, and the five checks pass", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-infra-clone-")));
  roots.push(root);
  const clone = join(root, "werk");
  const c = sh(root, ["git", "clone", "-q", CHECKOUT, clone]);
  expect(c.code).toBe(0);
  const first = sh(clone, ["git", "rev-list", "--max-parents=0", "HEAD"]).out.trim().split("\n");
  expect(first.length).toBe(1);
  expect(sh(clone, ["git", "ls-tree", "-r", "--name-only", first[0] as string]).out.trim()).toBe("");
  const head = sh(clone, ["git", "rev-parse", "HEAD"]).out.trim();
  expect(sh(clone, ["git", "merge-base", "--is-ancestor", first[0] as string, head]).code).toBe(0);
  for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const r = sh(clone, ["make", t]);
    if (r.code !== 0) throw new Error(`make ${t} exited ${r.code}\n${r.out.slice(-3000)}`);
  }
}, T);

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = copy();
  const link = join(dir, ".claude/agents/test-scope.md");
  const target = join(dir, "src/agent/subagents/test-scope.md");
  const saved = readFileSync(target);
  void saved;
  rmSync(link);
  cpSync(target, link);
  const bad = sh(dir, ["make", "test"]);
  expect(bad.code).not.toBe(0);
  expect(bad.out).toContain("test-scope");
  rmSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const good = sh(dir, ["make", "test"]);
  expect(good.code).toBe(0);
}, T);
void renameSync; void unlinkSync;
