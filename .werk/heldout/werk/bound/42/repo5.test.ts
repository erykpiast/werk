// 61.1: the first commit, and the five checks one after the other, with a printed result for each.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const clone = "/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/heldout-repo-AU3QVg/clone";
const git = (...a: string[]) => execFileSync("git", a, { cwd: clone, encoding: "utf8" }).trim();
async function make(target: string) {
  const noClaude = (process.env.PATH ?? "").split(":").filter((d) => !existsSync(join(d, "claude"))).join(":");
  const p = Bun.spawn(["make", target], { cwd: clone, env: { ...process.env, PATH: noClaude } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  console.log(`RESULT make ${target}: exit ${code}`);
  return { code, out: out + err };
}
test("[61.1] first commit holds no files and is the ancestor of every commit", () => {
  const roots = git("rev-list", "--max-parents=0", "HEAD").split("\n");
  console.log("ROOTS", roots);
  expect(roots).toHaveLength(1);
  expect(git("ls-tree", "-r", "--name-only", roots[0] as string)).toBe("");
  const bad = git("rev-list", "HEAD").split("\n").filter((c) => {
    try {
      git("merge-base", "--is-ancestor", roots[0] as string, c);
      return false;
    } catch {
      return true;
    }
  });
  expect(bad).toEqual([]);
});
for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
  test(`[61.1] make ${t}`, async () => {
    const r = await make(t);
    expect(r.code).toBe(0);
  }, 3_000_000);
}
