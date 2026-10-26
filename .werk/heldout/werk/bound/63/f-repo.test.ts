// Held-out steps 01.1 and 61.1-61.4: the make targets, the coverage gate, the help verb and the
// git history. Each step that runs a make target or edits a file works on a fresh clone of the
// checkout in a temporary folder, never on the checkout itself.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import "../src/verbs/index.ts";
import { registry } from "../src/cli/registry.ts";

const CHECKOUT = realpathSync(join(import.meta.dir, ".."));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Run = { code: number; out: string };

function sh(cwd: string, command: string[], env: Record<string, string | undefined> = process.env): Run {
  const run = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

const head = sh(CHECKOUT, ["git", "rev-parse", "HEAD"]).out.trim();

/** A fresh clone of the checkout at its HEAD commit, with no node_modules and no held-out folder. */
function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-f-")));
  roots.push(root);
  const dir = join(root, "werk");
  expect(sh(root, ["git", "clone", "-q", "--no-checkout", CHECKOUT, dir]).code).toBe(0);
  expect(sh(dir, ["git", "checkout", "-q", head]).code).toBe(0);
  expect(existsSync(join(dir, ".werk-heldout"))).toBe(false);
  return dir;
}

const make = (dir: string, target: string, env?: Record<string, string | undefined>) => sh(dir, ["make", target], env);

/** The coverage line of one file: "ok    95.00%  path" or "FAIL   0.00%  path (reason)". */
function coverageLine(out: string, file: string): string | undefined {
  return out.split("\n").find((line) => /^(ok|FAIL)\s+\d+\.\d+%\s+/.test(line) && line.includes(`  ${file}`));
}

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = clone();
  const list = pureList(dir);
  expect(list.length).toBeGreaterThan(0);
  expect(existsSync(join(dir, list[0] as string))).toBe(true);
  expect(existsSync(join(dir, (list[0] as string).replace(/\.tsx?$/, ".test.ts")))).toBe(true);

  const unit = make(dir, "test");
  expect(unit.code).toBe(0);
  expect(unit.out).toMatch(/\d+ pass/);
  expect(unit.out).not.toMatch(/under 90% of lines/);
  expect(unit.out).not.toMatch(/^(ok|FAIL)\s+\d+\.\d+%/m);

  const coverage = make(dir, "test-coverage");
  for (const file of list) expect(coverageLine(coverage.out, file)).toBeDefined();
  expect(coverage.code).toBe(0);

  const victim = "src/cli/card-id.ts";
  const victimTest = "src/cli/card-id.test.ts";
  expect(list).toContain(victim);
  rmSync(join(dir, victimTest));
  const again = make(dir, "test-coverage");
  const line = coverageLine(again.out, victim);
  expect(line).toMatch(/0\.00%/);
  expect(again.code).not.toBe(0);
  expect(again.out).toContain("card-id.test.ts");

  const unitAgain = make(dir, "test");
  expect(unitAgain.code).toBe(0);
  expect(unitAgain.out).not.toMatch(/under 90% of lines/);
});

test("61.1 a fresh clone builds on an empty first commit and passes every check", () => {
  const roots = sh(CHECKOUT, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
  expect(roots.length).toBe(1);
  const first = roots[0] as string;
  expect(sh(CHECKOUT, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
  const commits = sh(CHECKOUT, ["git", "rev-list", "main"]).out.trim().split("\n");
  for (const commit of commits)
    expect(sh(CHECKOUT, ["git", "merge-base", "--is-ancestor", first, commit]).code).toBe(0);

  const dir = clone();
  expect(readdirSync(join(dir, "e2e")).length).toBeGreaterThan(0);
  const results: Record<string, Run> = {};
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) results[target] = make(dir, target);
  for (const [target, run] of Object.entries(results)) {
    if (run.code !== 0) console.error(`make ${target} failed:\n${run.out.slice(-3000)}`);
    expect({ target, code: run.code }).toEqual({ target, code: 0 });
  }
});

test("61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit", () => {
  const dir = clone();
  expect(make(dir, "help").code).toBe(0);
  const help = sh(dir, [process.execPath, "src/cli.ts", "help"]);
  expect(help.code).toBe(0);
  const names = registry.list().map((verb) => verb.name);
  expect(names).toContain("help");
  for (const name of names) expect(help.out).toMatch(new RegExp(`^  ${name}\\b`, "m"));

  writeFileSync(
    join(dir, "src", "verbs", "ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Print pong.",
  run: (_args, io) => {
    io.out("pong\\n");
    return 0;
  },
});
`,
  );
  const after = sh(dir, [process.execPath, "src/cli.ts", "help"]);
  expect(after.code).toBe(0);
  for (const name of names) expect(after.out).toMatch(new RegExp(`^  ${name}\\b`, "m"));
  expect(after.out).toMatch(/^ {2}ping\b/m);
  expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
});

test("61.3 the tests pass on a machine with no real agent installed", () => {
  const dir = clone();
  const path = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((folder) => folder !== "" && !existsSync(join(folder, "claude")))
    .join(delimiter);
  const env = { ...process.env, PATH: path };
  expect(sh(dir, ["sh", "-c", "command -v claude"], env).code).not.toBe(0);
  expect(sh(dir, ["sh", "-c", "command -v bun && command -v make && command -v git"], env).code).toBe(0);
  const before = sh(dir, ["git", "status", "--porcelain"]).out;
  const run = make(dir, "test", env);
  if (run.code !== 0) console.error(run.out.slice(-4000));
  expect(run.code).toBe(0);
  // The tests of the command line that start the agent ran and passed against the fake agent.
  expect(run.out).toMatch(/fake-agent\.test\.ts/);
  expect(run.out).toMatch(/serve\/chat\.test\.ts/);
  expect(run.out).not.toMatch(/\(fail\)/);
  const after = sh(dir, ["git", "status", "--porcelain", "--ignored"]).out;
  // node_modules is the only new folder: make installs the locked packages there.
  const changed = after
    .split("\n")
    .filter((line) => line !== "" && !/^!! node_modules\/$/.test(line) && !before.includes(line));
  expect(changed).toEqual([]);
});

test("61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above", () => {
  const dir = clone();
  const file = "src/map/search.ts";
  const testFile = join(dir, "src/map/search.test.ts");
  expect(pureList(dir)).toContain(file);
  const baseline = make(dir, "test-coverage");
  expect(baseline.code).toBe(0);

  // Keep only the first test of the file's own test file.
  const text = readFileSync(testFile, "utf8");
  const starts = [...text.matchAll(/^test\(/gm)].map((match) => match.index as number);
  expect(starts.length).toBeGreaterThan(1);
  writeFileSync(testFile, text.slice(0, starts[1]));

  const unit = make(dir, "test");
  expect(unit.code).toBe(0);

  const coverage = make(dir, "test-coverage");
  const line = coverageLine(coverage.out, file);
  expect(line).toBeDefined();
  const percent = Number(/(\d+\.\d+)%/.exec(line as string)?.[1]);
  console.error(`61.4 coverage line: ${line}`);
  expect(percent).toBeLessThan(90);
  expect(percent).toBeGreaterThan(0);
  expect(coverage.code).not.toBe(0);

  expect(sh(dir, ["git", "checkout", "--", "src/map/search.test.ts"]).code).toBe(0);
  const restored = make(dir, "test-coverage");
  expect(restored.code).toBe(0);
});
