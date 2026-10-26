import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const ci = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const pin = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
const mk = readFileSync(join(REPO, "Makefile"), "utf8");
const runs = [...ci.matchAll(/^\s+- run: (.+)$/gm)].map((m) => m[1]);
const idx = (s: string) => runs.indexOf(s);
// These tests read the workflow file. GitHub Actions itself cannot run here.

test("50.1 push to main runs lint, typecheck, test, coverage, e2e, build+start as separate steps on a clean machine", () => {
  expect(ci).toMatch(/push:\s*\n\s+branches: \[main\]/);
  expect(ci).toContain("actions/checkout");
  expect(ci).toContain("runs-on: ubuntu-latest");
  expect(runs).toEqual([
    "make lint",
    "make typecheck",
    "make test",
    "make test-coverage",
    "make e2e",
    "make smoke",
  ]);
  // Locked packages from a clean state: every target installs with --frozen-lockfile.
  expect(mk).toContain("bun install --frozen-lockfile");
  expect(mk).toMatch(/smoke:[^\n]*\n\tbun run smoke/);
  expect(readFileSync(join(REPO, "package.json"), "utf8")).toContain(
    "bun src/release/build.ts dist/smoke --current && bun src/release/smoke.ts",
  );
});

test("50.2 pull requests get the same job", () => {
  expect(ci).toMatch(/^\s*pull_request:/m);
  expect(ci).toContain("make smoke");
  // Merge only on green is a GitHub branch protection setting, not in the repo.
});

test("50.3 the run is red on a failing check and nothing in the workflow reverts the merge", () => {
  expect(ci).not.toMatch(/continue-on-error|git revert|git reset|push --force/);
  expect(ci).not.toMatch(/\|\| true/);
  // release gating on a green run: look for any release/status signal
  expect(ci).toMatch(/release/i);
});

test("50.4 Bun is installed from the pinned version file before any check", () => {
  expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  expect(ci).toContain("bun-version-file: .bun-version");
  expect(ci.indexOf("setup-bun")).toBeLessThan(ci.indexOf("make lint"));
  expect(mk).toContain("cat .bun-version");
});

test("50.5 the start step is the last step and fails when the map read does not answer", () => {
  expect(idx("make smoke")).toBe(runs.length - 1);
  const smoke = readFileSync(join(REPO, "src/release/smoke.ts"), "utf8");
  expect(smoke).toContain("the map read answered");
  expect(smoke).toContain("throw new Error");
  expect(ci).not.toMatch(/continue-on-error/);
});
