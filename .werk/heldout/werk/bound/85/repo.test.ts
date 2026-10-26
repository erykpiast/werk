// Held-out repository tests: the checks, the coverage gate, the verb registry, the subagent links.
// They run on a fresh clone of the checkout in a temporary folder, never on the checkout itself.
import { setDefaultTimeout, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

setDefaultTimeout(3_000_000);
const CHECKOUT = join(import.meta.dir, "..");
// A PATH with no directory that holds a `claude` program.
const PATH = (process.env.PATH ?? "")
  .split(":")
  .filter((d) => d !== "" && d !== "." && !existsSync(join(d, "claude")))
  .join(":");
const ENV = { ...process.env, PATH } as Record<string, string>;
delete ENV.CI;

async function run(cwd: string, cmd: string[], env = ENV) {
  const proc = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err, all: out + err };
}
async function clone(): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), "werk-held-clone-"));
  const r = await run(tmpdir(), ["git", "clone", "--quiet", CHECKOUT, d]);
  if (r.code !== 0) throw new Error(r.all);
  const c = await run(d, ["git", "checkout", "--quiet", (await run(CHECKOUT, ["git", "rev-parse", "HEAD"])).out.trim()]);
  if (c.code !== 0) throw new Error(c.all);
  const i = await run(d, ["bun", "install", "--frozen-lockfile"]);
  if (i.code !== 0) throw new Error(i.all);
  return d;
}
const pure = () => readFileSync(join(CHECKOUT, "pure-files.txt"), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));

const flow: { dir?: string; log: Record<string, string> } = { log: {} };
const rec = (k: string, r: { code: number; all: string }) => {
  flow.log[k] = `exit ${r.code}\n${r.all.slice(-3000)}`;
  console.log(`[repo] ${k}: exit ${r.code}`);
};

test("61.1 first commit is empty and every later commit descends from it", async () => {
  const first = (await run(CHECKOUT, ["git", "rev-list", "--max-parents=0", "main"])).out.trim().split("\n");
  console.log("root commits:", first);
  expect(first.length).toBe(1);
  const files = (await run(CHECKOUT, ["git", "ls-tree", "-r", "--name-only", first[0]!])).out.trim();
  expect(files).toBe("");
  const head = (await run(CHECKOUT, ["git", "rev-parse", "main"])).out.trim();
  const bad = (await run(CHECKOUT, ["git", "rev-list", "main"])).out.trim().split("\n");
  for (const c of bad.slice(0, 400)) {
    const anc = await run(CHECKOUT, ["git", "merge-base", "--is-ancestor", first[0]!, c]);
    if (anc.code !== 0) throw new Error(`${c} lacks the first commit as ancestor`);
  }
  void head;
});

test("flow A: clone, install, make test / test-coverage / typecheck / lint / e2e on a fresh clone with no claude on PATH", async () => {
  flow.dir = await clone();
  const d = flow.dir;
  expect(Bun.which("claude", { PATH })).toBeNull();
  const t = await run(d, ["make", "test"]);
  rec("make test", t);
  const st = await run(d, ["git", "status", "--porcelain"]);
  rec("git status after make test", st);
  const cov = await run(d, ["make", "test-coverage"]);
  rec("make test-coverage", cov);
  const ty = await run(d, ["make", "typecheck"]);
  rec("make typecheck", ty);
  const li = await run(d, ["make", "lint"]);
  rec("make lint", li);
  const e2 = await run(d, ["make", "e2e"]);
  rec("make e2e", e2);
  writeFileSync("/tmp/werk-held-flowA.json", JSON.stringify({ log: flow.log }, null, 1));
  expect(t.code).toBe(0);
});

test("report flow A", () => {
  for (const [k, v] of Object.entries(flow.log)) console.log(`----- ${k}\n${v.split("\n").slice(0, 1)}`);
});
