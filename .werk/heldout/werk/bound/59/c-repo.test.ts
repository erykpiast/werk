// Held-out steps 01.1, 61.1-61.4, 19.5: repository checks, each run on a fresh clone in a temp folder.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const LONG = 1_200_000;
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

type R = { code: number; out: string };
function sh(cmd: string[], cwd: string, env: Record<string, string> = process.env as Record<string, string>): R {
  const run = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

/** A person's clone of the werk repository on the main branch. */
function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-c-")));
  roots.push(root);
  const dir = join(root, "werk");
  const r = sh(["git", "clone", "--quiet", CHECKOUT, dir], root);
  if (r.code !== 0) throw new Error(r.out);
  const head = sh(["git", "rev-parse", "main"], CHECKOUT).out.trim();
  sh(["git", "checkout", "--quiet", "-B", "main", head], dir);
  return dir;
}
const make = (dir: string, target: string, env?: Record<string, string>) => sh(["make", target], dir, env);

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = clone();
    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/pure files,|under 90%/);
    const c1 = make(dir, "test-coverage");
    const list = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    for (const f of list) expect(c1.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${f.replaceAll(".", "\\.")}`));
    expect(c1.code).toBe(0);
    unlinkSync(join(dir, "web/escape.test.ts"));
    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").find((l) => / web\/escape\.ts\b/.test(l)) ?? "";
    expect(line).toMatch(/\b0(\.00)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("web/escape.test.ts");
    const t2 = make(dir, "test");
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage/i);
  },
  LONG,
);

test(
  "61.1 a fresh clone builds on an empty first commit and passes every check",
  () => {
    const dir = clone();
    const firsts = sh(["git", "rev-list", "--max-parents=0", "main"], dir).out.trim().split("\n");
    expect(firsts.length).toBe(1);
    const first = firsts[0] as string;
    expect(sh(["git", "ls-tree", "-r", "--name-only", first], dir).out.trim()).toBe("");
    for (const c of sh(["git", "rev-list", "main"], dir).out.trim().split("\n"))
      expect(sh(["git", "merge-base", "--is-ancestor", first, c], dir).code).toBe(0);
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = make(dir, target);
      if (r.code !== 0) console.log(`make ${target}:\n${r.out.slice(-3000)}`);
      expect({ target, code: r.code }).toEqual({ target, code: 0 });
    }
  },
  LONG * 2,
);

test(
  "61.2 help lists every registered verb, and a new verb module appears with no other edit",
  () => {
    const dir = clone();
    expect(make(dir, "help").code).toBe(0); // installs the locked packages
    const verbs = () => {
      const r = sh([process.execPath, "src/cli.ts", "help"], dir);
      expect(r.code).toBe(0);
      return [...r.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    };
    const before = verbs();
    const registered = [...readFileSync(join(dir, "src/verbs/index.ts"), "utf8").matchAll(/import "\.\/([a-z-]+)\.ts"/g)].map(
      (m) => m[1],
    );
    expect(before).toContain("help");
    expect(before.length).toBeGreaterThanOrEqual(registered.length);
    writeFileSync(
      join(dir, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const after = verbs();
    for (const v of before) expect(after).toContain(v);
    expect(after).toContain("ping");
    expect(sh(["git", "status", "--porcelain"], dir).out.trim()).toBe("?? src/verbs/ping.ts");
  },
  LONG,
);

test(
  "61.3 the tests pass on a machine with no real agent installed",
  () => {
    const dir = clone();
    const path = (process.env.PATH ?? "")
      .split(":")
      .filter((d) => d !== "" && !d.includes("fake-bin") && !existsSync(join(d, "claude")))
      .join(":");
    const env = { ...(process.env as Record<string, string>), PATH: path };
    expect(sh(["sh", "-c", "command -v claude"], dir, env).code).not.toBe(0);
    const r = make(dir, "test", env);
    if (r.code !== 0) console.log(r.out.slice(-3000));
    expect(r.code).toBe(0);
    // The command-line tests read the fake agent's script and file edit from a temporary project.
    const fake = readFileSync(join(dir, "src/test/fake-agent.test.ts"), "utf8");
    expect(fake).toMatch(/freshProject|tmpdir|mkdtemp/);
    expect(sh(["git", "status", "--porcelain"], dir).out.trim()).toBe("");
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above",
  () => {
    const dir = clone();
    expect(make(dir, "test-coverage").code).toBe(0);
    const file = "src/map/rollup.ts";
    const testFile = join(dir, "src/map/rollup.test.ts");
    const original = readFileSync(testFile, "utf8");
    // Keep the imports and the first test; delete every later test.
    const parts = original.split(/\n(?=test\()/);
    writeFileSync(testFile, `${parts.slice(0, 2).join("\n")}\n`);
    const t = make(dir, "test");
    expect(t.code).toBe(0);
    const c = make(dir, "test-coverage");
    const line = c.out.split("\n").find((l) => l.includes(` ${file}`)) ?? "";
    console.log(line);
    const pct = Number(/(\d+\.\d+)%/.exec(line)?.[1] ?? "100");
    expect(pct).toBeLessThan(90);
    expect(c.code).not.toBe(0);
    expect(line).toContain(file);
    writeFileSync(testFile, original);
    expect(make(dir, "test-coverage").code).toBe(0);
  },
  LONG,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = clone();
    const first = make(dir, "test");
    expect(first.code).toBe(0);
    const link = join(dir, ".claude/agents/test-scope.md");
    const text = readFileSync(link, "utf8");
    unlinkSync(link);
    writeFileSync(link, text);
    const broken = make(dir, "test");
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    expect(make(dir, "test").code).toBe(0);
  },
  LONG,
);
