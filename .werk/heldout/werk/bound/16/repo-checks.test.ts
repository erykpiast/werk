// Held-out steps 01.1 and 61.1-61.4: the repository's make targets, each run on a fresh clone of
// this checkout in a temporary folder, so no edit touches the checkout itself.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const LONG = 40 * 60 * 1000;
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Run = { code: number; out: string };

function sh(cwd: string, command: string[], env: Record<string, string | undefined> = process.env): Run {
  const run = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

/** A fresh clone of the checkout's main branch, with its locked packages installed. */
function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  roots.push(root);
  const dir = join(root, "werk");
  const c = sh(root, ["git", "clone", "--quiet", "--branch", "main", CHECKOUT, dir]);
  if (c.code !== 0) throw new Error(c.out);
  return dir;
}

const make = (dir: string, target: string, env?: Record<string, string | undefined>) => sh(dir, ["make", target], env);

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = clone();
    const pure = sh(dir, ["cat", "pure-files.txt"])
      .out.split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    // Given the werk repository with its first pure helper and that helper's own test file
    const first = pure[0] as string;
    expect(existsSync(join(dir, first.replace(/\.tsx?$/, ".test.ts")))).toBe(true);

    // When the agent runs `make test` / Then the unit tests pass
    const t1 = make(dir, "test");
    console.log("make test (1):", t1.code, t1.out.slice(-600));
    expect(t1.code).toBe(0);
    // And the run reports its results without a coverage check
    expect(t1.out).not.toMatch(/coverage|% of lines|pure files/i);

    // When the agent runs `make test-coverage`
    const c1 = make(dir, "test-coverage");
    console.log("make test-coverage (1):", c1.code, c1.out.slice(-1500));
    // Then the output shows one line for each file on the pure-file list with its line percentage
    for (const file of pure) {
      const lines = c1.out.split("\n").filter((l) => l.trimEnd().split(/\s+/).includes(file));
      expect(lines.filter((l) => /\d+(\.\d+)?%/.test(l)).length, file).toBe(1);
    }
    // And the coverage command passes
    expect(c1.code).toBe(0);

    // When the agent deletes the own test file of a file on the pure-file list
    const target = "src/cli/card-id.ts";
    const ownTest = "src/cli/card-id.test.ts";
    expect(pure).toContain(target);
    unlinkSync(join(dir, ownTest));
    // And the agent runs `make test-coverage` again
    const c2 = make(dir, "test-coverage");
    console.log("make test-coverage (2):", c2.code, c2.out.slice(-1500));
    // Then the output shows 0% for that file
    const line = c2.out.split("\n").find((l) => l.includes(target)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    // And the coverage command fails and names the missing test file
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain(ownTest);
    // But `make test` still passes without a coverage failure
    const t2 = make(dir, "test");
    console.log("make test (2):", t2.code, t2.out.slice(-600));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage|% of lines/i);
  },
  LONG,
);

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    // Given a person clones the werk repository
    const dir = clone();
    // When the person lists the files of the first commit on the main branch
    const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
    expect(roots.length).toBe(1);
    const first = roots[0] as string;
    // Then the first commit holds no files
    expect(sh(dir, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
    // And every later commit on the main branch has the first commit as an ancestor
    const all = sh(dir, ["git", "rev-list", "main"]).out.trim().split("\n");
    for (const commit of all) expect(sh(dir, ["git", "merge-base", "--is-ancestor", first, commit]).code).toBe(0);

    // When the person installs the dependencies and runs the five checks one after the other
    const install = sh(dir, ["bun", "install", "--frozen-lockfile"]);
    expect(install.code).toBe(0);
    const codes: Record<string, number> = {};
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = make(dir, target);
      codes[target] = r.code;
      console.log(`make ${target}:`, r.code, r.out.slice(-1200));
    }
    // Then each of the five commands exits with success
    expect(codes).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });

    // And `make e2e` passes although the project has no browser spec yet: the clone with every
    // browser spec removed.
    for (const f of readdirSync(join(dir, "e2e"))) if (f.endsWith(".e2e.ts")) unlinkSync(join(dir, "e2e", f));
    const empty = make(dir, "e2e");
    console.log("make e2e with no spec:", empty.code, empty.out.slice(-800));
    expect(empty.code).toBe(0);
  },
  LONG,
);

test(
  "61.2 the help verb lists every registered verb, and a new verb module appears with no other edit",
  () => {
    // Given a person has a copy of the werk project with its dependencies installed
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const cli = ["bun", "src/cli.ts"];
    // When the person runs `werk help`
    const h1 = sh(dir, [...cli, "help"]);
    expect(h1.code).toBe(0);
    // Then the output names every verb that the command line registers, and `help` is one of them
    const registered = sh(dir, [
      "bun",
      "-e",
      'await import("./src/verbs/index.ts"); const { registry } = await import("./src/cli/registry.ts"); console.log(registry.list().map((v) => v.name).join(" "))',
    ])
      .out.trim()
      .split(" ");
    expect(registered).toContain("help");
    const named = (out: string) => [...out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    const before = named(h1.out);
    for (const verb of registered) expect(before).toContain(verb);

    // When the person adds one new module that defines and registers a verb named `ping`
    writeFileSync(
      join(dir, "src", "verbs", "ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Print pong.",
  run(_args, io) {
    io.out("pong\\n");
    return 0;
  },
});
`,
    );
    // And the person changes no other file in the project / And runs `werk help` again
    const h2 = sh(dir, [...cli, "help"]);
    console.log("help after ping:", h2.code, h2.out.slice(0, 400));
    // Then the output names `ping` together with every verb it named before
    const after = named(h2.out);
    for (const verb of before) expect(after).toContain(verb);
    // And `git status` shows the new module as the only changed file
    expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
    expect(after).toContain("ping");
  },
  LONG,
);

test(
  "61.3 the tests pass on a machine with no real agent installed",
  async () => {
    // Given a person has a copy of the werk project with its dependencies installed
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    // And no `claude` program is installed or reachable on the PATH of the person's shell
    const path = (process.env.PATH ?? "")
      .split(":")
      .filter((d) => d !== "" && !existsSync(join(d, "claude")))
      .join(":");
    const tmp = join(dir, "..", "tmp");
    sh(dir, ["mkdir", "-p", tmp]);
    const env = { ...process.env, PATH: path, TMPDIR: tmp };
    expect(sh(dir, ["sh", "-c", "command -v claude"], env).code).not.toBe(0);
    const statusBefore = sh(dir, ["git", "status", "--porcelain", "--ignored"]).out;

    // When the person runs `make test` — while it runs, watch the temporary folder for the
    // fake agent's script and the projects it plays in.
    const seen = new Set<string>();
    const proc = Bun.spawn(["make", "test"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    const outP = new Response(proc.stdout).text();
    const errP = new Response(proc.stderr).text();
    const watch = setInterval(() => {
      try {
        for (const d of readdirSync(tmp)) {
          if (!d.startsWith("werk-test-")) continue;
          for (const sub of readdirSync(join(tmp, d))) seen.add(`${sub}`);
          const fake = join(tmp, d, "fake-agent");
          if (existsSync(fake)) for (const f of readdirSync(fake)) seen.add(`fake-agent/${f}`);
        }
      } catch {}
    }, 100);
    const code = await proc.exited;
    clearInterval(watch);
    const out = (await outP) + (await errP);
    console.log("make test:", code, out.slice(-800), [...seen]);
    // Then `make test` exits with success
    expect(code).toBe(0);
    // And the tests that run the command line read the scripted events and the file edit of the
    // fake agent from a temporary project
    expect([...seen].some((s) => s.startsWith("fake-agent/"))).toBe(true);
    expect(seen.has("project")).toBe(true);
    // And the working tree of the person's project has no new or changed files after the run
    expect(sh(dir, ["git", "status", "--porcelain", "--ignored"]).out).toBe(statusBefore);
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above",
  () => {
    // Given a person has a copy of the werk project where `make test-coverage` passes
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const c0 = make(dir, "test-coverage");
    expect(c0.code).toBe(0);
    // When the person deletes enough unit tests that one file on the pure-file list drops below 90%
    const file = "src/map/search.ts";
    const ownTest = join(dir, "src/map/search.test.ts");
    writeFileSync(
      ownTest,
      `import { expect, test } from "bun:test";\nimport * as search from "./search.ts";\n\ntest("the module loads", () => {\n  expect(search).toBeDefined();\n});\n`,
    );
    // And the person runs `make test`
    const t = make(dir, "test");
    console.log("make test:", t.code, t.out.slice(-400));
    // Then `make test` exits with success, because plain unit tests do not check coverage
    expect(t.code).toBe(0);
    // When the person runs `make test-coverage`
    const c1 = make(dir, "test-coverage");
    console.log("make test-coverage:", c1.code, c1.out.slice(-1500));
    // Then `make test-coverage` exits with an error
    expect(c1.code).not.toBe(0);
    // And the output names that file and its coverage percentage
    const line = c1.out.split("\n").find((l) => l.includes(file)) ?? "";
    expect(line).toMatch(/FAIL\s+\d+(\.\d+)?%/);
    const percent = Number(/(\d+(\.\d+)?)%/.exec(line)?.[1]);
    expect(percent).toBeLessThan(90);
    // When the person restores the deleted tests and runs `make test-coverage` again
    expect(sh(dir, ["git", "checkout", "--", "src/map/search.test.ts"]).code).toBe(0);
    const c2 = make(dir, "test-coverage");
    // Then `make test-coverage` exits with success
    expect(c2.code).toBe(0);
  },
  LONG,
);
