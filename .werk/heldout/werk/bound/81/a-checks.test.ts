import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cloneApp, sh } from "./a-lib.ts";

test("01.1 make test has no coverage check; make test-coverage lists pure files; missing own test gives 0% and fails; make test still passes", () => {
  const c = cloneApp();
  const t = sh(c, ["make", "test"]);
  expect(t.code).toBe(0);
  expect(t.out + t.err).not.toMatch(/coverage|% of lines|pure files/i);
  const cov = sh(c, ["make", "test-coverage"]);
  const list = readFileSync(join(c, "pure-files.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  for (const f of list) expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/\./g, "\\.")}`));
  expect(cov.code).toBe(0);
  const victim = "src/cli/args.ts";
  rmSync(join(c, "src/cli/args.test.ts"));
  const cov2 = sh(c, ["make", "test-coverage"]);
  const line = cov2.out.split("\n").find((l) => l.includes(victim)) ?? "";
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(cov2.code).not.toBe(0);
  expect(cov2.out + cov2.err).toContain("src/cli/args.test.ts");
  const t2 = sh(c, ["make", "test"]);
  // make test still passes (args.test.ts is gone, so the remaining tests run)
  if (t2.code !== 0) writeFileSync("/tmp/wa-01-t2.log", t2.out + t2.err);
  expect(t2.code).toBe(0);
  expect(t2.out + t2.err).not.toMatch(/under 90%/);
}, 600000);

test("61.4 coverage gate fails under 90% and passes again after restore", () => {
  const c = cloneApp();
  expect(sh(c, ["make", "test-coverage"]).code).toBe(0);
  const file = join(c, "src/cli/args.test.ts");
  const orig = readFileSync(file, "utf8");
  writeFileSync(file, `import { test } from "bun:test";\nimport "./args.ts";\ntest("noop", () => {});\n`);
  const t = sh(c, ["make", "test"]);
  expect(t.code).toBe(0);
  const cov = sh(c, ["make", "test-coverage"]);
  expect(cov.code).not.toBe(0);
  const line = cov.out.split("\n").find((l) => l.includes("src/cli/args.ts")) ?? "";
  expect(line).toMatch(/\d+(\.\d+)?%/);
  writeFileSync(file, orig);
  expect(sh(c, ["make", "test-coverage"]).code).toBe(0);
}, 600000);

test("61.2 help lists every verb; a new module adds a verb with no other edit", () => {
  const c = cloneApp();
  const h = sh(c, ["bun", "src/cli.ts", "help"]);
  expect(h.code).toBe(0);
  const verbs = readdirNames(c).map((n) => n);
  for (const v of verbs) expect(h.out).toMatch(new RegExp(`^  ${v}( |$)`, "m"));
  expect(h.out).toMatch(/^  help$/m);
  expect(h.out).not.toMatch(/^  ping/m);
  writeFileSync(
    join(c, "src/verbs/ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Answer pong.", run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
  );
  const h2 = sh(c, ["bun", "src/cli.ts", "help"]);
  expect(h2.out).toMatch(/^  ping$/m);
  for (const v of verbs) expect(h2.out).toMatch(new RegExp(`^  ${v}( |$)`, "m"));
  const st = sh(c, ["git", "status", "--porcelain"]).out.trim().split("\n");
  expect(st).toEqual(["?? src/verbs/ping.ts"]);
});

function readdirNames(c: string): string[] {
  const { readdirSync } = require("node:fs");
  return readdirSync(join(c, "src/verbs"))
    .filter((n: string) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts")
    .map((n: string) => n.replace(/\.ts$/, ""));
}

test("61.3 make test passes with no claude on PATH and leaves the tree clean", () => {
  const c = cloneApp();
  const shim = join(c, "..", "shim");
  mkdirSync(shim);
  for (const name of ["bun", "make", "git", "sh", "grep", "sed", "cat", "expand", "env", "touch", "node", "dirname", "uname", "mkdir", "rm", "ls", "tr", "head", "tail", "true", "false", "sleep", "ln", "cp", "mv", "kill", "chmod", "echo", "printf", "test", "wc", "sort", "cut", "find", "which", "awk", "tee", "readlink", "pwd", "date", "id", "sync", "xargs", "diff", "cmp", "basename", "mktemp", "stat", "ps", "bash", "zsh", "tar", "gzip"]) {
    const p = Bun.which(name);
    if (p) symlinkSync(p, join(shim, name));
  }
  const path = shim;
  expect(sh(c, ["sh", "-c", "command -v claude || echo none"], { PATH: path }).out.trim()).toBe("none");
  const before = sh(c, ["git", "status", "--porcelain"]).out;
  const t = sh(c, ["make", "test"], { PATH: path });
  if (t.code !== 0) writeFileSync("/tmp/wa-61-3.log", t.out + t.err);
  expect(t.code).toBe(0);
  expect(sh(c, ["git", "status", "--porcelain"]).out).toBe(before);
  expect(before).toBe("");
}, 600000);

test("61.1 fresh clone: empty first commit, ancestor of all, five make targets pass", () => {
  const c = cloneApp();
  const root = sh(c, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
  expect(root.length).toBe(1);
  expect(sh(c, ["git", "ls-tree", "-r", "--name-only", root[0]]).out.trim()).toBe("");
  const all = sh(c, ["git", "rev-list", "--parents", "main"]).out.trim().split("\n");
  expect(all.filter((l) => l.split(" ").length === 1)).toEqual([root[0]]);
  const codes: Record<string, number> = {};
  for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"]) codes[t] = sh(c, ["make", t]).code;
  expect(codes).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
}, 900000);
