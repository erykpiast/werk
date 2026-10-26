// Step 69.5: make e2e runs the browser specs and leaves one screenshot per test.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHECKOUT, freshClone, run } from "./repo-helpers.ts";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const logOf = (dir: string) => {
  const log = join(dir, ".werk", "log.jsonl");
  return existsSync(log) ? readFileSync(log, "utf8") : "<no log>";
};

test("69.5 make e2e reports each spec and leaves one screenshot per test, with no new events in the person's project", () => {
  const dir = freshClone("e2e");
  const checkoutBefore = logOf(CHECKOUT);
  const cloneBefore = logOf(dir);
  const r = run(["make", "e2e"], dir);
  console.log(r.out.slice(-5000));
  const results = r.out.split("\n").filter((l) => /^\s+(✓|✘|ok|x|-)\s+\d+\s/.test(l));
  const ran = results.filter((l) => !/^\s+-\s/.test(l));
  const specs = readdirSync(join(dir, "e2e")).filter((f) => f.endsWith(".e2e.ts"));
  const reported = new Set(ran.map((l) => /e2e\/([\w.-]+\.e2e\.ts)/.exec(l)?.[1]).filter(Boolean));
  const pngs = walk(join(dir, "test-results")).filter((f) => f.endsWith(".png"));
  const testDirs = new Set(pngs.map((p) => p.split("/").slice(0, -1).join("/")));
  console.log(
    `exit ${r.code}; ${ran.length} tests ran; ${specs.length} spec files, ${reported.size} reported; ${pngs.length} PNGs in ${testDirs.size} test folders`,
  );
  console.log("test-results folders:", readdirSync(join(dir, "test-results")).join("\n"));
  expect(ran.length).toBeGreaterThan(0);
  for (const s of specs) expect(reported.has(s)).toBe(true);
  expect(pngs.length).toBe(ran.length);
  expect(testDirs.size).toBe(ran.length);
  expect(logOf(CHECKOUT)).toBe(checkoutBefore);
  expect(logOf(dir)).toBe(cloneBefore);
}, 1_800_000);
