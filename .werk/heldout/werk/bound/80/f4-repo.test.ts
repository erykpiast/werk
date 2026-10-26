import { expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneMain, sh } from "./f4-repo-lib.ts";

test("61.1 fresh clone, empty first commit, five checks pass", () => {
  const dir = cloneMain();
  const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
  expect(roots.length).toBe(1);
  expect(sh(dir, ["git", "ls-tree", "-r", roots[0] as string]).out.trim()).toBe("");
  const all = sh(dir, ["git", "rev-list", "main"]).out.trim().split("\n");
  for (const c of all) expect(sh(dir, ["git", "merge-base", "--is-ancestor", roots[0] as string, c]).code).toBe(0);
  const results: Record<string, number> = {};
  for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const r = sh(dir, ["make", t]);
    results[t] = r.code;
    if (r.code !== 0) console.log(t, r.out.slice(-1500), r.err.slice(-1500));
  }
  expect(results).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
  console.log(sh(dir, ["ls", "e2e"]).out);
}, 900000);

test("61.2 help lists every registered verb; a new verb module joins with no other edit", () => {
  const dir = cloneMain();
  const cli = join(dir, "src", "cli.ts");
  const verbs = readdirSync(join(dir, "src", "verbs"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts")
    .flatMap((f) => [...readFileSync(join(dir, "src", "verbs", f), "utf8").matchAll(/registerVerb\(\{\s*name: "([a-z-]+)"/g)].map((m) => m[1] as string));
  expect(verbs).toContain("help");
  const names = (out: string) => out.split("\n").filter((l) => /^  [a-z-]+/.test(l)).map((l) => (l.trim().split(" ")[0] as string));
  const before = sh(dir, ["bun", cli, "help"]);
  expect(before.code).toBe(0);
  const listed = names(before.out);
  for (const v of verbs) expect(listed).toContain(v);
  expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
  writeFileSync(
    join(dir, "src", "verbs", "ping.ts"),
    `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", help: "Print pong.", positionals: [], flags: [], run: (_a, io) => { io.out("pong\\n"); return 0; } });\n`,
  );
  const after = sh(dir, ["bun", cli, "help"]);
  expect(after.code).toBe(0);
  const listed2 = names(after.out);
  expect(listed2).toContain("ping");
  for (const v of listed) expect(listed2).toContain(v);
  expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("?? src/verbs/ping.ts");
  expect(sh(dir, ["bun", cli, "ping"]).out).toBe("pong\n");
}, 120000);

test("61.3 tests pass with no claude on PATH and leave the tree clean", () => {
  const dir = cloneMain();
  const dirs = (process.env.PATH ?? "").split(":").filter((d) => d && !existsSync(join(d, "claude")));
  // keep dirs needed: make, git, bun
  const PATH = dirs.join(":");
  expect(Bun.spawnSync(["sh", "-c", "command -v claude"], { env: { ...process.env, PATH } }).exitCode).not.toBe(0);
  const r = sh(dir, ["make", "test"], { PATH });
  if (r.code !== 0) console.log(r.out.slice(-2000), r.err.slice(-2000));
  expect(r.code).toBe(0);
  expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
}, 600000);

test("61.4 coverage gate fails below 90 and passes again after restore", () => {
  const dir = cloneMain();
  const base = sh(dir, ["make", "test-coverage"]);
  expect(base.code).toBe(0);
  const file = "src/board/rules.test.ts";
  const orig = readFileSync(join(dir, file), "utf8");
  writeFileSync(join(dir, file), `import { test } from "bun:test";\ntest("only", () => {});\n`);
  const t = sh(dir, ["make", "test"]);
  expect(t.code).toBe(0);
  const c = sh(dir, ["make", "test-coverage"]);
  console.log(c.out, c.err);
  expect(c.code).not.toBe(0);
  expect(c.out + c.err).toContain("src/board/rules.ts");
  expect(c.out + c.err).toMatch(/src\/board\/rules\.ts\D+\d+(\.\d+)?%/);
  writeFileSync(join(dir, file), orig);
  expect(sh(dir, ["make", "test-coverage"]).code).toBe(0);
}, 600000);
