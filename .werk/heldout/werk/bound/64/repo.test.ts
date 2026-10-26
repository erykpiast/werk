// Held-out steps 01.1, 19.5, 61.1-61.4: each runs the make targets on its own clone of the
// checkout, so no edit touches the checkout itself.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const LONG = 1_200_000;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Run = { code: number; out: string };

function sh(cwd: string, command: string[], env: Record<string, string | undefined> = process.env): Run {
  const run = Bun.spawnSync(command, { cwd, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

/** A fresh clone of the checkout's main branch. */
function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  roots.push(root);
  const dir = join(root, "werk");
  const run = sh(root, ["git", "clone", "--quiet", "--no-hardlinks", "--branch", "main", CHECKOUT, dir]);
  if (run.code !== 0) throw new Error(`clone failed: ${run.out}`);
  return dir;
}

const make = (dir: string, target: string, env?: Record<string, string | undefined>) => sh(dir, ["make", target], env);

test(
  "01.1 unit tests, then the coverage gate, then a missing own test file",
  () => {
    const dir = clone();
    const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));

    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/pure files|under 90%|% Lines|\d+\.\d+%\s+\S+\.ts/);

    const c1 = make(dir, "test-coverage");
    for (const file of pure) {
      const line = c1.out
        .split("\n")
        .find((l) => l.endsWith(file) || l.includes(`  ${file}  `) || l.includes(`  ${file}`));
      expect(line, `line for ${file}`).toMatch(/\d+(\.\d+)?%/);
    }
    expect(c1.code).toBe(0);

    const victim = "src/cli/card-id.ts";
    rmSync(join(dir, "src/cli/card-id.test.ts"));
    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").find((l) => l.includes(` ${victim}`)) ?? "";
    expect(line).toMatch(/\b0(\.00)?%/);
    expect(line).toContain("src/cli/card-id.test.ts");
    expect(c2.code).not.toBe(0);

    const t2 = make(dir, "test");
    expect(t2.code).toBe(0);
    expect(t2.out).not.toContain("card-id.test.ts");
  },
  LONG,
);

test(
  "19.5 the repository checks catch a subagent copy that replaces its link",
  () => {
    const dir = clone();
    const link = join(dir, ".claude/agents/test-scope.md");
    const before = make(dir, "test");
    expect(before.code).toBe(0);

    const text = readFileSync(link, "utf8");
    rmSync(link);
    writeFileSync(link, text);
    const broken = make(dir, "test");
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");

    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const again = make(dir, "test");
    expect(again.code).toBe(0);
  },
  LONG,
);

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    const dir = clone();
    const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
    expect(roots).toHaveLength(1);
    const first = roots[0] as string;
    expect(sh(dir, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
    const all = sh(dir, ["git", "rev-list", "main"]).out.trim().split("\n");
    for (const commit of all) expect(sh(dir, ["git", "merge-base", "--is-ancestor", first, commit]).code).toBe(0);

    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const run = make(dir, target);
      expect(run.code, `make ${target}: ${run.out.slice(-3000)}`).toBe(0);
    }
  },
  LONG,
);

test(
  "61.2 a new verb module appears in help with no other edit",
  () => {
    const dir = clone();
    expect(make(dir, "help").code).toBe(0);
    const help = sh(dir, ["bun", "src/cli.ts", "help"]);
    expect(help.code).toBe(0);
    const verbs = [...help.out.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] as string);
    const registered = readFileSync(join(dir, "src/verbs/index.ts"), "utf8")
      .split("\n")
      .flatMap((l) => /^import "\.\/(.+)\.ts";$/.exec(l)?.[1] ?? []);
    expect(verbs).toContain("help");
    for (const name of registered) expect(verbs).toContain(name);

    writeFileSync(
      join(dir, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run(_args, io) {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const after = sh(dir, ["bun", "src/cli.ts", "help"]);
    const now = [...after.out.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] as string);
    const status = sh(dir, ["git", "status", "--porcelain"]).out.trim();
    expect(status).toBe("?? src/verbs/ping.ts");
    for (const name of verbs) expect(now).toContain(name);
    expect(now).toContain("ping");
  },
  LONG,
);

test(
  "61.3 the tests pass on a machine with no real agent installed",
  () => {
    const dir = clone();
    const bunDir = dirname(realpathSync(Bun.which("bun") as string));
    const PATH = [bunDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
    const env = { HOME: process.env.HOME, PATH, TMPDIR: process.env.TMPDIR };
    expect(sh(dir, ["/bin/sh", "-c", "command -v claude || echo none"], env).out.trim()).toBe("none");
    expect(existsSync(join(bunDir, "claude"))).toBe(false);

    const run = make(dir, "test", env);
    expect(run.code, run.out.slice(-3000)).toBe(0);
    const fake = sh(dir, ["bun", "test", "./src/test/fake-agent.test.ts"], env);
    expect(fake.code, fake.out).toBe(0);
    expect(fake.out).toMatch(/\d+ pass/);
    expect(fake.out).toMatch(/ 0 fail/);
    expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again",
  () => {
    const dir = clone();
    const testFile = join(dir, "src/map/search.test.ts");
    const original = readFileSync(testFile, "utf8");
    const head = original.slice(0, original.indexOf("\ntest("));
    writeFileSync(
      testFile,
      `${head}\ntest("one left", () => {\n  expect(typeof formatSearch).toBe("function");\n});\n`,
    );

    const t = make(dir, "test");
    expect(t.code, t.out.slice(-3000)).toBe(0);

    const c = make(dir, "test-coverage");
    expect(c.code).not.toBe(0);
    const line = c.out.split("\n").find((l) => l.includes(" src/map/search.ts")) ?? "";
    expect(line).toMatch(/FAIL\s+\d+(\.\d+)?%/);
    const percent = Number(/(\d+(?:\.\d+)?)%/.exec(line)?.[1]);
    expect(percent).toBeLessThan(90);

    writeFileSync(testFile, original);
    const again = make(dir, "test-coverage");
    expect(again.code, again.out.slice(-3000)).toBe(0);
  },
  LONG,
);
