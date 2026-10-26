// Held-out steps 01.1, 19.5 and 61.x: the repository's own tasks, each run in a fresh clone of the
// checkout in a temporary folder, so the checkout itself never changes. Slow: run with a long timeout.
import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");
const LONG = 30 * 60 * 1000;

type R = { code: number; out: string };
function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R {
  const run = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}
function clone(): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-"))), "werk");
  const r = sh(CHECKOUT, ["git", "clone", "--quiet", CHECKOUT, dir]);
  if (r.code !== 0) throw new Error(r.out);
  return dir;
}
const make = (dir: string, target: string, env?: Record<string, string | undefined>) => sh(dir, ["make", target], env);
const status = (dir: string) => sh(dir, ["git", "status", "--porcelain"]).out;

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = clone();
    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/\d+\.\d+%/);
    const c1 = make(dir, "test-coverage");
    const list = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .filter((l) => l !== "" && !l.startsWith("#"));
    for (const file of list) expect(c1.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replaceAll(".", "\\.")}`));
    expect(c1.code).toBe(0);
    unlinkSync(join(dir, "web", "escape.test.ts"));
    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").find((l) => l.includes("web/escape.ts")) ?? "";
    expect(line).toMatch(/\b0(\.00)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("web/escape.test.ts");
    const t2 = make(dir, "test");
    if (t2.code !== 0)
      console.error(
        t2.out
          .split("\n")
          .filter((l) => /fail|error/i.test(l))
          .slice(0, 40)
          .join("\n"),
      );
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage/i);
  },
  LONG,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = clone();
    const link = join(dir, ".claude", "agents", "test-scope.md");
    expect(make(dir, "test").code).toBe(0);
    const text = readFileSync(link, "utf8");
    unlinkSync(link);
    writeFileSync(link, text);
    const failed = make(dir, "test");
    expect(failed.code).not.toBe(0);
    expect(failed.out).toContain("test-scope");
    unlinkSync(link);
    sh(dir, ["ln", "-s", "../../src/agent/subagents/test-scope.md", link]);
    expect(status(dir)).toBe("");
    expect(make(dir, "test").code).toBe(0);
  },
  LONG,
);

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    const dir = clone();
    const roots = sh(CHECKOUT, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
    expect(roots.length).toBe(1);
    const root = roots[0] as string;
    expect(sh(CHECKOUT, ["git", "ls-tree", "-r", root]).out.trim()).toBe("");
    const all = sh(CHECKOUT, ["git", "rev-list", "main"]).out.trim().split("\n");
    for (const c of all) expect(sh(CHECKOUT, ["git", "merge-base", "--is-ancestor", root, c]).code).toBe(0);
    const results: Record<string, number> = {};
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = make(dir, target);
      results[target] = r.code;
      if (r.code !== 0) console.error(`make ${target}:\n${r.out.slice(-3000)}`);
    }
    expect(results).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
  },
  LONG,
);

test(
  "61.2 the help verb lists every registered verb, and a new verb module appears with no other edit",
  () => {
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const help1 = sh(dir, ["bun", "src/cli.ts", "help"]);
    expect(help1.code).toBe(0);
    const verbs1 = [...help1.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    expect(verbs1).toContain("help");
    const files = sh(dir, ["ls", "src/verbs"])
      .out.split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts");
    expect(verbs1.length).toBeGreaterThanOrEqual(files.length);
    writeFileSync(
      join(dir, "src", "verbs", "ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  positionals: [],\n  flags: [],\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const help2 = sh(dir, ["bun", "src/cli.ts", "help"]);
    const verbs2 = [...help2.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    expect(verbs2).toContain("ping");
    for (const v of verbs1) expect(verbs2).toContain(v);
    expect(status(dir).trim()).toBe("?? src/verbs/ping.ts");
  },
  LONG,
);

test(
  "61.3 the tests pass on a machine with no real agent installed",
  () => {
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const path = (process.env.PATH ?? "")
      .split(delimiter)
      .filter((p) => p !== "" && !existsSync(join(p, "claude")))
      .join(delimiter);
    const env = { ...process.env, PATH: path };
    expect(sh(dir, ["sh", "-c", "command -v claude"], env).code).not.toBe(0);
    const before = status(dir);
    const r = make(dir, "test", env);
    if (r.code !== 0) console.error(r.out.slice(-4000));
    expect(r.code).toBe(0);
    // The fake agent's own tests ran and passed in the run.
    expect(r.out).toMatch(/\b0 fail\b/);
    expect(status(dir)).toBe(before);
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above",
  () => {
    const dir = clone();
    expect(make(dir, "test-coverage").code).toBe(0);
    const testFile = join(dir, "src", "map", "fold.test.ts");
    const text = readFileSync(testFile, "utf8");
    // Keep the imports and the first test only.
    const second = text.indexOf("\ntest(", text.indexOf("\ntest(") + 1);
    writeFileSync(testFile, `${text.slice(0, second)}\n`);
    expect(make(dir, "test").code).toBe(0);
    const c = make(dir, "test-coverage");
    expect(c.code).not.toBe(0);
    const line = c.out.split("\n").find((l) => l.includes("src/map/fold.ts")) ?? "";
    expect(line).toMatch(/\d+(\.\d+)?%/);
    const pct = Number(/(\d+(?:\.\d+)?)%/.exec(line)?.[1]);
    expect(pct).toBeLessThan(90);
    writeFileSync(testFile, text);
    expect(make(dir, "test-coverage").code).toBe(0);
  },
  LONG,
);

// Keep imports used.
void cpSync;
void statSync;
