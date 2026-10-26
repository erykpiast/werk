// Held-out steps 01.1, 61.1, 61.2, 61.3, 61.4, 19.5. Every step that edits the repository runs on a
// fresh clone in a temporary folder, never on the checkout.
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const T = 900_000;

type R = { code: number; out: string };

function sh(cwd: string, cmd: string, env: Record<string, string | undefined> = process.env): R {
  const run = Bun.spawnSync(["bash", "-c", `${cmd} 2>&1`], { cwd, env, stdout: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() };
}

/** A clean environment for make: no test-run variables inherited from this bun test process. */
function makeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["HOME", "PATH", "USER", "SHELL", "TMPDIR", "LANG"])
    if (process.env[k]) env[k] = process.env[k] as string;
  // Drop the fake-bin the preload put first; a person's shell does not have it.
  env.PATH = (env.PATH ?? "")
    .split(":")
    .filter((d) => !d.endsWith("src/test/fake-bin"))
    .join(":");
  return { ...env, ...extra };
}

function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  const dir = join(root, "werk");
  const r = sh(root, `git clone -q "${CHECKOUT}" werk`);
  if (r.code !== 0) throw new Error(r.out);
  return dir;
}

function log(name: string, r: R): void {
  writeFileSync(join(import.meta.dir, `repo-${name}.log`), `exit ${r.code}\n${r.out}`);
}

test(
  "01.1 unit tests, then the coverage gate, then a deleted own test file",
  () => {
    const dir = clone();
    try {
      const env = makeEnv();
      const t1 = sh(dir, "make test", env);
      log("01.1-test", t1);
      expect(t1.code).toBe(0);
      expect(t1.out).toMatch(/\d+ pass/);
      expect(t1.out).not.toMatch(/coverage|% Lines/i);

      const c1 = sh(dir, "make test-coverage", env);
      log("01.1-cov", c1);
      const listed = readFileSync(join(dir, "pure-files.txt"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("#"));
      for (const file of listed) expect(c1.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replace(/\./g, "\\.")}`));
      expect(c1.code).toBe(0);

      unlinkSync(join(dir, "src/cli/card-id.test.ts"));
      const c2 = sh(dir, "make test-coverage", env);
      log("01.1-cov2", c2);
      const line = c2.out.split("\n").find((l) => / src\/cli\/card-id\.ts/.test(l)) ?? "";
      expect(line).toMatch(/0\.00%/);
      expect(c2.code).not.toBe(0);
      expect(line).toContain("card-id.test.ts");

      const t2 = sh(dir, "make test", env);
      log("01.1-test2", t2);
      expect(t2.code).toBe(0);
      expect(t2.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T,
);

test("61.1a the first commit on main holds no files, and every later commit descends from it", () => {
  const roots = sh(CHECKOUT, "git rev-list --max-parents=0 main").out.trim().split("\n");
  expect(roots.length).toBe(1);
  const first = sh(CHECKOUT, "git rev-list --reverse main").out.trim().split("\n")[0];
  expect(first).toBe(roots[0]);
  expect(sh(CHECKOUT, `git ls-tree -r ${first}`).out.trim()).toBe("");
  // Every commit of main reaches the one root.
  const all = sh(CHECKOUT, "git rev-list main").out.trim().split("\n");
  for (const c of all) expect(sh(CHECKOUT, `git merge-base --is-ancestor ${first} ${c}`).code).toBe(0);
});

test(
  "61.1b a fresh clone passes the five make checks",
  () => {
    const dir = clone();
    try {
      const env = makeEnv();
      for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
        const r = sh(dir, `make ${target}`, env);
        log(`61.1-${target}`, r);
        expect({ target, code: r.code }).toEqual({ target, code: 0 });
      }
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T * 2,
);

test(
  "61.2 help lists every verb, and a new ping module appears with no other edit",
  () => {
    const dir = clone();
    try {
      const env = makeEnv();
      expect(sh(dir, "bun install --frozen-lockfile", env).code).toBe(0);
      const h1 = sh(dir, "bun src/cli.ts help", env);
      log("61.2-help1", h1);
      expect(h1.code).toBe(0);
      const imports = [
        ...readFileSync(join(dir, "src/verbs/index.ts"), "utf8").matchAll(/import "\.\/(\w[\w-]*)\.ts"/g),
      ];
      const names = imports.map((m) => {
        const src = readFileSync(join(dir, "src/verbs", `${m[1]}.ts`), "utf8");
        return [...src.matchAll(/name: "([\w-]+)"/g)].map((n) => n[1]);
      });
      const verbs = [...new Set(names.flat())];
      expect(verbs).toContain("help");
      for (const v of verbs) expect(h1.out).toMatch(new RegExp(`^  ${v}\\b`, "m"));

      writeFileSync(
        join(dir, "src/verbs/ping.ts"),
        `import { registerVerb } from "../cli/registry.ts";\n\nregisterVerb({\n  name: "ping",\n  help: "Print pong.",\n  run(_args, io) {\n    io.out("pong\\n");\n    return 0;\n  },\n});\n`,
      );
      const h2 = sh(dir, "bun src/cli.ts help", env);
      log("61.2-help2", h2);
      expect(h2.out).toMatch(/^ {2}ping\b/m);
      for (const v of verbs) expect(h2.out).toMatch(new RegExp(`^  ${v}\\b`, "m"));
      expect(sh(dir, "git status --porcelain", env).out.trim()).toBe("?? src/verbs/ping.ts");
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T,
);

test(
  "61.3 make test passes with no claude on PATH and leaves the tree clean",
  () => {
    const dir = clone();
    try {
      const base = makeEnv();
      const path = base.PATH.split(":")
        .filter((d) => !existsSync(join(d, "claude")))
        .join(":");
      const env = { ...base, PATH: path };
      expect(sh(dir, "command -v claude", env).code).not.toBe(0);
      // Install first, so the "no new files" check covers the run of make test only.
      expect(sh(dir, "make bun-version node_modules/.werk-installed", env).code).toBe(0);
      const before = sh(dir, "git status --porcelain", env).out;
      const r = sh(dir, "make test", env);
      log("61.3-test", r);
      expect(r.code).toBe(0);
      const after = sh(dir, "git status --porcelain", env).out;
      expect(after).toBe(before);
      expect(after.trim()).toBe("");
      // The command-line tests use the fake agent's script from a temporary project.
      const harness = readFileSync(join(dir, "src/test/project.ts"), "utf8");
      expect(harness).toMatch(/mkdtempSync\(join\(tmpdir\(\)/);
      expect(harness).toContain("SCRIPT_FILE");
      expect(existsSync(join(dir, "src/test/fake-bin/claude"))).toBe(true);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T,
);

test(
  "61.4 the coverage gate fails under 90% and passes again after restore",
  () => {
    const dir = clone();
    try {
      const env = makeEnv();
      const file = "src/map/search.ts";
      writeFileSync(
        join(dir, "src/map/search.test.ts"),
        `import { expect, test } from "bun:test";\nimport * as m from "./search.ts";\n\ntest("loads", () => {\n  expect(m).toBeDefined();\n});\n`,
      );
      const t = sh(dir, "make test", env);
      log("61.4-test", t);
      expect(t.code).toBe(0);
      const c1 = sh(dir, "make test-coverage", env);
      log("61.4-cov1", c1);
      expect(c1.code).not.toBe(0);
      const line = c1.out.split("\n").find((l) => l.includes(` ${file}`)) ?? "";
      expect(line).toMatch(/FAIL\s+\d+\.\d+%/);
      const pct = Number(/(\d+\.\d+)%/.exec(line)?.[1]);
      expect(pct).toBeLessThan(90);
      expect(sh(dir, "git checkout -- src/map/search.test.ts", env).code).toBe(0);
      const c2 = sh(dir, "make test-coverage", env);
      log("61.4-cov2", c2);
      expect(c2.code).toBe(0);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = clone();
    try {
      const env = makeEnv();
      const c1 = sh(dir, "make test", env);
      log("19.5-test1", c1);
      expect(c1.code).toBe(0);
      const link = join(dir, ".claude/agents/test-scope.md");
      const content = readFileSync(link, "utf8");
      unlinkSync(link);
      writeFileSync(link, content);
      const c2 = sh(dir, "make test", env);
      log("19.5-test2", c2);
      expect(c2.code).not.toBe(0);
      expect(c2.out).toContain("test-scope.md");
      unlinkSync(link);
      symlinkSync("../../src/agent/subagents/test-scope.md", link);
      const c3 = sh(dir, "make test", env);
      log("19.5-test3", c3);
      expect(c3.code).toBe(0);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  T,
);
