// Held-out tests for the repository checks (01.1, 61.x, 19.x). Every edit runs in a throwaway clone.
import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT } from "./cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

type R = { code: number; out: string };

function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

const HEAD = sh(CHECKOUT, ["git", "rev-parse", "HEAD"]).out.trim();

/** A person's clone of the werk repository at the checkout's commit. */
function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-ho-a-")));
  roots.push(root);
  const dir = join(root, "werk");
  expect(sh(root, ["git", "clone", "-q", CHECKOUT, "werk"]).code).toBe(0);
  expect(sh(dir, ["git", "checkout", "-q", HEAD]).code).toBe(0);
  return dir;
}

const make = (dir: string, target: string, env?: Record<string, string | undefined>) => sh(dir, ["make", target], env);
const LONG = 600_000;

test(
  "01.1 unit tests, then the coverage gate, then a deleted own test file",
  () => {
    const dir = clone();
    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    expect(t1.out).toMatch(/\d+ pass\s+0 fail/);
    expect(t1.out).not.toMatch(/\d+\.\d+%\s+\S+\.ts/);
    expect(t1.out).not.toMatch(/under 90%/);

    const c1 = make(dir, "test-coverage");
    const listed = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    for (const file of listed) {
      const line = c1.out.split("\n").filter((l) => l.split(/\s+/).includes(file));
      expect(line.length, file).toBe(1);
      expect(line[0]).toMatch(/\d+(\.\d+)?%/);
    }
    expect(c1.code).toBe(0);

    const target = "src/cli/card-id.ts";
    unlinkSync(join(dir, "src/cli/card-id.test.ts"));
    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").find((l) => l.split(/\s+/).includes(target)) ?? "";
    expect(line).toMatch(/\b0(\.00)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("src/cli/card-id.test.ts");

    const t2 = make(dir, "test");
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/under 90%|coverage/i);
  },
  LONG,
);

test(
  "61.1 fresh clone: empty first commit, every check passes",
  () => {
    const dir = clone();
    const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "origin/main"]).out.trim().split("\n");
    expect(roots.length).toBe(1);
    const first = roots[0] as string;
    expect(sh(dir, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
    const all = sh(dir, ["git", "rev-list", "origin/main"]).out.trim().split("\n");
    for (const c of all) expect(sh(dir, ["git", "merge-base", "--is-ancestor", first, c]).code, c).toBe(0);

    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = make(dir, target);
      if (r.code !== 0) console.log(`make ${target}:\n${r.out.slice(-3000)}`);
      expect(r.code, `make ${target}`).toBe(0);
    }
  },
  LONG * 2,
);

/** The verb names that the verb modules register. */
function registeredVerbs(dir: string): string[] {
  const names: string[] = [];
  for (const f of readdirSync(join(dir, "src/verbs"))) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "index.ts") continue;
    const text = readFileSync(join(dir, "src/verbs", f), "utf8");
    for (const m of text.matchAll(/registerVerb\(\{\s*name:\s*"([^"]+)"/g)) names.push(m[1] as string);
  }
  return names;
}

test(
  "61.2 help lists every registered verb, and a new ping module appears with no other edit",
  () => {
    const dir = clone();
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const verbs = registeredVerbs(dir);
    expect(verbs).toContain("help");
    const help = sh(dir, ["bun", "src/cli.ts", "help"]).out;
    const listed = [...help.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    for (const v of verbs) expect(listed, v).toContain(v);
    expect(listed).toContain("help");

    writeFileSync(
      join(dir, "src/verbs/ping.ts"),
      `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run: (_args, io) => {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
    );
    const help2 = sh(dir, ["bun", "src/cli.ts", "help"]).out;
    const listed2 = [...help2.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    expect(listed2).toContain("ping");
    for (const v of listed) expect(listed2).toContain(v);
    const status = sh(dir, ["git", "status", "--porcelain"]).out.trim();
    expect(status).toBe("?? src/verbs/ping.ts");
  },
  LONG,
);

test(
  "61.3 make test passes with no claude on PATH and leaves the tree clean",
  () => {
    const dir = clone();
    const path = (process.env.PATH ?? "")
      .split(":")
      .filter((d) => d !== "" && !existsSync(join(d, "claude")))
      .join(":");
    const env = { ...process.env, PATH: path };
    expect(sh(dir, ["sh", "-c", "command -v claude"], env).code).not.toBe(0);
    const before = sh(dir, ["git", "status", "--porcelain", "--ignored=no"]).out;
    expect(before.trim()).toBe("");
    const r = make(dir, "test", env);
    if (r.code !== 0) console.log(r.out.slice(-3000));
    expect(r.code).toBe(0);
    // The fake agent's own test file and the command-line tests ran and passed.
    expect(r.out).toMatch(/\d+ pass\s+0 fail/);
    expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
  },
  LONG,
);

test(
  "61.4 coverage gate fails below 90% and passes again",
  () => {
    const dir = clone();
    expect(make(dir, "test-coverage").code).toBe(0);
    const file = "src/map/rollup.ts";
    writeFileSync(
      join(dir, "src/map/rollup.test.ts"),
      `import { test } from "bun:test";\nimport "./rollup.ts";\n\ntest("kept", () => {});\n`,
    );
    expect(make(dir, "test").code).toBe(0);
    const c = make(dir, "test-coverage");
    expect(c.code).not.toBe(0);
    const line = c.out.split("\n").find((l) => l.split(/\s+/).includes(file)) ?? "";
    const pct = Number(/([\d.]+)%/.exec(line)?.[1] ?? "NaN");
    expect(pct).toBeLessThan(90);
    expect(sh(dir, ["git", "checkout", "--", "src/map/rollup.test.ts"]).code).toBe(0);
    expect(make(dir, "test-coverage").code).toBe(0);
  },
  LONG,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = clone();
    const link = join(dir, ".claude/agents/test-scope.md");
    const shipped = readdirSync(join(dir, "src/agent/subagents")).filter((n) => n.endsWith(".md"));
    for (const n of shipped) expect(sh(dir, ["test", "-L", `.claude/agents/${n}`]).code, n).toBe(0);
    expect(make(dir, "test").code).toBe(0);

    unlinkSync(link);
    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
    expect(statSync(link).isFile()).toBe(true);
    const bad = make(dir, "test");
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain("test-scope");

    unlinkSync(link);
    expect(sh(dir, ["git", "checkout", "--", ".claude/agents/test-scope.md"]).code).toBe(0);
    expect(sh(dir, ["test", "-L", ".claude/agents/test-scope.md"]).code).toBe(0);
    expect(make(dir, "test").code).toBe(0);
  },
  LONG,
);

/** How a person starts a build pass on a ticket: a werk verb or a server route that launches the builder role. */
function buildPassEntry(): string | undefined {
  const help = sh(CHECKOUT, ["bun", "src/cli.ts", "help"]).out;
  const verb = /^ {2}(build)\b/m.exec(help)?.[1];
  return verb;
}

test("19.1 a build pass in another project starts with the werk instructions", () => {
  // Given a project that is not werk's checkout with a build-rules card of three children,
  // the person starts a build pass on a ticket. No command or route starts one.
  expect(buildPassEntry()).toBe("build");
});

test("19.3 a project with no build rules gets no title list", () => {
  expect(buildPassEntry()).toBe("build");
});

test("19.4 in werk's own checkout the instructions appear one time", () => {
  expect(buildPassEntry()).toBe("build");
});
