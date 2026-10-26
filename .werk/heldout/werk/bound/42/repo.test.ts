// 01.1, 61.1, 61.3, 61.4: the repository checks, run in a fresh clone (never in the checkout).
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "heldout-repo-"));
const clone = join(root, "clone");

const noClaude = (process.env.PATH ?? "")
  .split(":")
  .filter((d) => !existsSync(join(d, "claude")))
  .join(":");

function shSync(cmd: string[], cwd = clone) {
  const r = Bun.spawnSync(cmd, { cwd, env: process.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
async function shA(cmd: string[], cwd = clone, env: Record<string, string | undefined> = {}) {
  const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}
const T = 3_000_000;
const res: Record<string, { code: number; out: string }> = {};

describe("repo", async () => {
  test("clone and install", async () => {
    expect((await shA(["git", "clone", "-q", SRC, clone], SRC)).code).toBe(0);
    const i = await shA(["bun", "install", "--frozen-lockfile"]);
    expect(i.code).toBe(0);
  }, T);

  test("[61.1] first commit is empty and is an ancestor of all", async () => {
    const first = shSync(["git", "rev-list", "--max-parents=0", "HEAD"]).out.trim().split("\n");
    expect(first.length).toBe(1);
    const files = shSync(["git", "ls-tree", "-r", "--name-only", first[0]!]).out.trim();
    expect(files).toBe("");
    const count = shSync(["git", "rev-list", "--count", "HEAD"]).out.trim();
    const desc = shSync(["git", "rev-list", "--count", `${first[0]}..HEAD`]).out.trim();
    expect(Number(desc)).toBe(Number(count) - 1);
    // every commit has it as ancestor
    const bad = shSync(["sh", "-c", `for c in $(git rev-list HEAD); do git merge-base --is-ancestor ${first[0]} $c || echo BAD $c; done`]).out;
    expect(bad).toBe("");
  }, T);

  test("make test (no claude on PATH)", async () => {
    res.test = await shA(["make", "test"], clone, { PATH: noClaude });
    console.log("MAKE TEST (tail):", res.test.out.split("\n").slice(-12).join("\n"));
    expect(res.test.code).toBe(0);
    expect(res.test.out.toLowerCase()).not.toContain("coverage");
    const status = shSync(["git", "status", "--porcelain"]).out;
    console.log("GIT STATUS after make test:", JSON.stringify(status));
    expect(status).toBe("");
  }, T);

  test("make test-coverage", async () => {
    res.cov = await shA(["make", "test-coverage"]);
    console.log("COV tail:", res.cov.out.split("\n").slice(-6).join("\n"));
    expect(res.cov.code).toBe(0);
    const listed = readFileSync(join(clone, "pure-files.txt"), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    for (const f of listed) expect(res.cov!.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[.]/g, "\\.")}`));
  }, T);

  test("make typecheck / lint", async () => {
    expect((await shA(["make", "typecheck"])).code).toBe(0);
    expect((await shA(["make", "lint"])).code).toBe(0);
  }, T);

  test("make e2e", async () => {
    const r = await shA(["make", "e2e"]);
    console.log("E2E tail:", r.out.split("\n").slice(-15).join("\n"));
    expect(r.code).toBe(0);
  }, T);

  test("[01.1] delete own test file", async () => {
    const tf = join(clone, "src/map/commit.test.ts");
    const saved = readFileSync(tf, "utf8");
    rmSync(tf);
    const c = await shA(["make", "test-coverage"]);
    console.log("COV after delete:", c.out.split("\n").filter((l) => /commit\.ts|test file|fail|under/i.test(l)).join("\n"));
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/0(\.0+)?%\s+src\/map\/commit\.ts/);
    expect(c.out).toContain("commit.test.ts");
    const t = await shA(["make", "test"]);
    console.log("MAKE TEST after delete tail:", t.out.split("\n").slice(-6).join("\n"));
    expect(t.code).toBe(0);
    writeFileSync(tf, saved);
  }, T);

  test("[61.4] coverage below 90", async () => {
    const tf = join(clone, "src/map/commit.test.ts");
    const saved = readFileSync(tf, "utf8");
    writeFileSync(tf, `import { expect, test } from "bun:test";\nimport * as c from "./commit.ts";\ntest("x", async () => { expect(c).toBeDefined(); });\n`);
    const t = await shA(["make", "test"]);
    expect(t.code).toBe(0);
    const c = await shA(["make", "test-coverage"]);
    console.log("COV low:", c.out.split("\n").filter((l) => /commit\.ts/.test(l)).join("\n"));
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/\d+(\.\d+)?%\s+src\/map\/commit\.ts/);
    writeFileSync(tf, saved);
    const c2 = await shA(["make", "test-coverage"]);
    expect(c2.code).toBe(0);
  }, T);
});
