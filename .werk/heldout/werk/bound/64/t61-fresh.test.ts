import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "./h.ts";

let dir: string;
let clone: string;
let env: Record<string, string>;
const results: Record<string, { code: number; text: string }> = {};

const sh = async (argv: string[], cwd: string, e = env) => {
  const proc = Bun.spawn(argv, { cwd, env: e, stdout: "pipe", stderr: "pipe" });
  const [o, er, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: `${o}\n${er}` };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "werk-held-fresh-"));
  clone = join(dir, "clone");
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("WERK_")) base[k] = v;
  // A shell where no claude program is reachable.
  const keep = (base.PATH ?? "")
    .split(delimiter)
    .filter((d) => d && !existsSync(join(d, "claude")));
  env = { ...base, PATH: keep.join(delimiter) };
  const c = await sh(["git", "clone", "-q", "--no-hardlinks", "--branch", "main", ROOT, clone], dir);
  if (c.code !== 0) throw new Error(c.text);
  // the clone holds the checked-out main line; use the checkout's own HEAD content
  const head = await sh(["git", "rev-parse", "HEAD"], ROOT);
  const mine = head.text.trim().split("\n")[0] as string;
  await sh(["git", "fetch", "-q", ROOT, mine], clone);
  const r = await sh(["git", "checkout", "-q", "--detach", mine], clone);
  if (r.code !== 0) throw new Error(r.text);
  const i = await sh(["bun", "install", "--frozen-lockfile"], clone);
  if (i.code !== 0) throw new Error(i.text);
}, 600000);
afterAll(() => {
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true });
});

test("61.3 make test passes with no claude on the path, and leaves the tree alone", async () => {
  expect(Bun.which("claude", { PATH: env.PATH })).toBeNull();
  results.test = await sh(["make", "test"], clone);
  console.log("MAKE TEST TAIL", results.test.text.slice(-1500));
  expect(results.test.code).toBe(0);
  const st = await sh(["git", "status", "--porcelain"], clone);
  expect(st.text.trim()).toBe("");
}, 1500000);

test("61.1 a fresh clone builds on an empty first commit and passes every check", async () => {
  const roots = (await sh(["git", "rev-list", "--max-parents=0", "main"], clone)).text.trim().split("\n").filter(Boolean);
  expect(roots.length).toBe(1);
  const files = (await sh(["git", "ls-tree", "-r", "--name-only", roots[0] as string], clone)).text.trim();
  expect(files).toBe("");
  const heads = (await sh(["git", "rev-list", "--count", "HEAD"], clone)).text.trim();
  expect(Number(heads.split("\n")[0])).toBeGreaterThan(1);
  for (const t of ["test-coverage", "typecheck", "lint", "e2e"]) {
    results[t] = await sh(["make", t], clone);
    console.log(`MAKE ${t} code`, results[t]?.code, results[t]?.text.slice(-1200));
  }
  for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"])
    expect({ t, code: results[t]?.code }).toEqual({ t, code: 0 });
}, 3000000);
