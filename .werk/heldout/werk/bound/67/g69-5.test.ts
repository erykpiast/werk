// 69.5: make e2e on a clone of the checkout, so the held-out folder's own specs stay out.
import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { clone, make, sh } from "./repo.ts";

function pngs(dir: string): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found = found.concat(pngs(path));
    else if (entry.endsWith(".png")) found.push(path);
  }
  return found;
}

test("69.5 make e2e runs the browser specs and leaves one screenshot per test", () => {
  const dir = clone();
  const run = make(dir, "e2e");
  console.log(run.all.slice(-2500));
  // One result line per spec: ✓ or ✘ with the spec file.
  const results = run.all.split("\n").filter((l) => /^\s*(✓|✘|-)\s+\d+\s/.test(l));
  expect(results.length).toBeGreaterThan(0);
  const specs = readdirSync(join(dir, "e2e")).filter((f) => f.endsWith(".e2e.ts"));
  for (const spec of specs) expect(results.some((l) => l.includes(spec))).toBe(true);
  const ran = results.filter((l) => /^\s*(✓|✘)/.test(l)).length;
  // Each test folder under test-results holds one screenshot.
  const shots = pngs(join(dir, "test-results"));
  const folders = readdirSync(join(dir, "test-results")).filter((f) =>
    statSync(join(dir, "test-results", f)).isDirectory(),
  );
  for (const folder of folders) expect(pngs(join(dir, "test-results", folder)).length).toBeGreaterThanOrEqual(1);
  expect(shots.length).toBeGreaterThanOrEqual(ran);
  // The real server runs on a copy: the fixture project in the clone has no new events.
  expect(sh(dir, ["git", "status", "--porcelain"]).out.trim()).toBe("");
}, 1_800_000);
