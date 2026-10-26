// g10: the check tasks, the coverage gate and the help verb, run in copies of the checkout.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CHECKOUT = realpathSync(join(import.meta.dir, ".."));
const COPY_SH = join(import.meta.dir, "g10-copy.sh");
const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

type Out = { code: number; out: string };

function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}): Out {
  const run = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, CI: "true", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

function copy(): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "g10-copy-"))), "w");
  const run = sh(["sh", COPY_SH, CHECKOUT, dir], CHECKOUT);
  if (run.code !== 0) throw new Error(run.out);
  return dir;
}

function gitCommitAll(dir: string): void {
  for (const a of [
    ["init", "-q", "--initial-branch=main"],
    ["config", "user.name", "g10"],
    ["config", "user.email", "g10@x.invalid"],
    ["add", "-A"],
    ["commit", "-q", "-m", "copy"],
  ]) {
    const r = sh(["git", ...a], dir, GIT_ENV);
    if (r.code !== 0) throw new Error(r.out);
  }
}

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));

test("01.1 make test without coverage; make test-coverage lists each pure file; a deleted own test gives 0% and fails", () => {
  const dir = copy();
  const t = sh(["make", "test"], dir);
  expect(t.code, t.out).toBe(0);
  expect(t.out).not.toMatch(/% of lines|pure files,|Coverage|coverage/);
  const c = sh(["make", "test-coverage"], dir);
  expect(c.code, c.out).toBe(0);
  const files = pureList(dir);
  for (const f of files) {
    const line = c.out.split("\n").find((l) => l.includes(` ${f}`) && /\d+\.\d\d%/.test(l));
    expect(line, `no percentage line for ${f}`).toBeDefined();
  }
  const target = "src/cli/card-id.ts";
  const own = "src/cli/card-id.test.ts";
  expect(files).toContain(target);
  sh(["rm", join(dir, own)], dir);
  const c2 = sh(["make", "test-coverage"], dir);
  expect(c2.code).not.toBe(0);
  const line = c2.out.split("\n").find((l) => l.includes(target));
  console.log("01.1 line after delete:", line);
  expect(line).toMatch(/0\.00%/);
  expect(line).toContain(own);
  const t2 = sh(["make", "test"], dir);
  expect(t2.code, t2.out.slice(-800)).toBe(0);
  expect(t2.out).not.toContain("pure files,");
}, 1_200_000);

test("61.4 coverage gate fails below 90% on a pure file and passes again after restore", () => {
  const dir = copy();
  const base = sh(["make", "test-coverage"], dir);
  expect(base.code, base.out).toBe(0);
  const own = join(dir, "src/cli/card-id.test.ts");
  const original = readFileSync(own, "utf8");
  writeFileSync(own, `import { expect, test } from "bun:test";\ntest("only one", () => { expect(1).toBe(1); });\n`);
  const t = sh(["make", "test"], dir);
  expect(t.code, t.out.slice(-800)).toBe(0);
  const c = sh(["make", "test-coverage"], dir);
  expect(c.code).not.toBe(0);
  const line = c.out.split("\n").find((l) => l.includes("src/cli/card-id.ts"));
  console.log("61.4 line:", line);
  expect(line).toMatch(/FAIL\s+\d+\.\d\d%\s+src\/cli\/card-id\.ts/);
  writeFileSync(own, original);
  const again = sh(["make", "test-coverage"], dir);
  expect(again.code, again.out.slice(-800)).toBe(0);
}, 1_800_000);

test("61.3 make test passes with no claude on PATH and leaves the tree clean", () => {
  const dir = copy();
  gitCommitAll(dir);
  const dirs = (process.env.PATH ?? "")
    .split(":")
    .filter((d) => d !== "" && !d.endsWith("fake-bin") && !existsSync(join(d, "claude")));
  const PATH = dirs.join(":");
  const which = sh(["sh", "-c", "command -v claude || echo none"], dir, { PATH });
  expect(which.out.trim()).toBe("none");
  const t = sh(["make", "test"], dir, { PATH });
  expect(t.code, t.out.slice(-1200)).toBe(0);
  const st = sh(["git", "status", "--porcelain"], dir, GIT_ENV);
  expect(st.out.trim()).toBe("");
  // the fake-agent tests exist and read a script + edit in a temporary project
  const fa = readFileSync(join(dir, "src/test/fake-agent.test.ts"), "utf8");
  expect(fa).toContain("edit");
}, 1_200_000);

test("61.2 werk help lists every verb; a new verb module appears with no other edit", () => {
  const dir = copy();
  gitCommitAll(dir);
  const h1 = sh(["bun", "src/cli.ts", "help"], dir);
  expect(h1.code).toBe(0);
  const verbs = readdirVerbs(dir);
  for (const v of verbs) expect(h1.out, `verb ${v}`).toMatch(new RegExp(`^  ${v}\\b`, "m"));
  expect(h1.out).toMatch(/^ {2}help$/m);
  writeFileSync(
    join(dir, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Print pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
  );
  const h2 = sh(["bun", "src/cli.ts", "help"], dir);
  expect(h2.code).toBe(0);
  expect(h2.out).toMatch(/^ {2}ping$/m);
  for (const v of verbs) expect(h2.out).toMatch(new RegExp(`^  ${v}\\b`, "m"));
  const st = sh(["git", "status", "--porcelain"], dir, GIT_ENV);
  expect(st.out.trim()).toBe("?? src/verbs/ping.ts");
});

function readdirVerbs(dir: string): string[] {
  const out = sh(["sh", "-c", "ls src/verbs/*.ts | grep -v '\\.test\\.ts' | grep -v index.ts"], dir).out;
  return out
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^src\/verbs\//, "").replace(/\.ts$/, ""));
}
void dirname;
