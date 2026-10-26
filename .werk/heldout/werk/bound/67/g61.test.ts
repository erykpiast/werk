// 61.1-61.4: a fresh clone, the help verb and a new verb module, the run without a real agent,
// and the coverage gate below and above 90%.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clone, make, sh } from "./repo.ts";

const LONG = 1_800_000;

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    const dir = clone();
    const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "origin/main"]).out.trim().split("\n");
    expect(roots).toHaveLength(1);
    const first = roots[0] as string;
    expect(sh(dir, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
    const commits = sh(dir, ["git", "rev-list", "origin/main"]).out.trim().split("\n");
    for (const c of commits) expect(sh(dir, ["git", "merge-base", "--is-ancestor", first, c]).code).toBe(0);

    const results: Record<string, number> = {};
    const tails: Record<string, string> = {};
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const run = make(dir, target);
      results[target] = run.code;
      tails[target] = run.all.slice(-1500);
    }
    if (Object.values(results).some((c) => c !== 0)) console.log(JSON.stringify(tails, null, 1));
    expect(results).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
  },
  LONG,
);

const verbsOf = (help: string) => [...help.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] as string).sort();

test(
  "61.2 help lists every registered verb, and a new verb module appears with no other edit",
  () => {
    const dir = clone();
    expect(make(dir, "help").code).toBe(0); // installs the locked dependencies
    const help1 = sh(dir, ["bun", "src/cli.ts", "help"]);
    expect(help1.code).toBe(0);
    const listed = verbsOf(help1.out);
    const registered = readdirSync(join(dir, "src", "verbs"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .flatMap((f) => [...readFileSync(join(dir, "src", "verbs", f), "utf8").matchAll(/name: "([a-z-]+)",\n\s+help:/g)])
      .map((m) => m[1] as string)
      .sort();
    expect(listed).toContain("help");
    expect(listed).toEqual(registered);

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
    const help2 = sh(dir, ["bun", "src/cli.ts", "help"]);
    expect(help2.code).toBe(0);
    expect(verbsOf(help2.out)).toEqual([...listed, "ping"].sort());
    expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
  },
  LONG,
);

test(
  "61.3 the tests pass with no real agent on PATH and leave the tree clean",
  () => {
    const dir = clone();
    const path = (process.env.PATH ?? "").split(":").filter((d) => d !== "" && !existsSync(join(d, "claude")));
    const env = { ...process.env, PATH: path.join(":") };
    expect(sh(dir, ["sh", "-c", "command -v claude"], env).code).not.toBe(0);
    const run = make(dir, "test", env);
    if (run.code !== 0) console.log(run.all.slice(-3000));
    expect(run.code).toBe(0);
    // The tests that run the fake agent read its scripted events and its file edit from a temporary project.
    const fake = sh(dir, ["bun", "test", "./src/test/fake-agent.test.ts"], env);
    expect(fake.code).toBe(0);
    expect(fake.all).toContain("a build pass plays its events and edits in order");
    expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above",
  () => {
    const dir = clone();
    expect(make(dir, "test-coverage").code).toBe(0);
    const testFile = join(dir, "src", "tickets", "own-checks.test.ts");
    const text = readFileSync(testFile, "utf8");
    // Delete every unit test but the first one.
    writeFileSync(
      testFile,
      text
        .split(/\n(?=test\()/)
        .slice(0, 2)
        .join("\n"),
    );

    expect(make(dir, "test").code).toBe(0);
    const low = make(dir, "test-coverage");
    expect(low.code).not.toBe(0);
    const line = low.all.split("\n").find((l) => l.includes("src/tickets/own-checks.ts")) ?? "";
    const percent = Number(/(\d+\.\d+)%/.exec(line)?.[1]);
    expect(percent).toBeLessThan(90);

    writeFileSync(testFile, text);
    expect(make(dir, "test-coverage").code).toBe(0);
  },
  LONG,
);
