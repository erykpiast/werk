// Held-out steps 61.1 and 69.5: a fresh clone's history and checks, and the browser run's evidence.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make, type Run, sh } from "./a-clone.ts";

let c: ReturnType<typeof cloneCheckout>;
const runs: Record<string, Run> = {};
let install: Run;
let logBefore: string | undefined;

function pngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) found.push(...pngs(p));
    else if (e.endsWith(".png")) found.push(p);
  }
  return found;
}

beforeAll(() => {
  c = cloneCheckout();
  logBefore = existsSync(join(c.dir, ".werk/log.jsonl")) ? "present" : undefined;
  install = sh(c.dir, ["bun", "install", "--frozen-lockfile"]);
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    runs[target] = make(c.dir, target);
    console.log(`make ${target} exit ${runs[target].code}`);
  }
}, 3_600_000);

afterAll(() => c?.done());

test("61.1 a fresh clone builds on an empty first commit and passes every check", () => {
  const roots = sh(c.dir, ["git", "rev-list", "--max-parents=0", "origin/main"]).out.trim().split("\n");
  console.log("root commits of main:", roots);
  expect(roots.length).toBe(1);
  const files = sh(c.dir, ["git", "ls-tree", "-r", "--name-only", roots[0]]).out.trim();
  expect(files).toBe("");
  const all = sh(c.dir, ["git", "rev-list", "origin/main"]).out.trim().split("\n");
  for (const commit of all) {
    expect(sh(c.dir, ["git", "merge-base", "--is-ancestor", roots[0], commit]).code).toBe(0);
  }
  expect(install.code).toBe(0);
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    if (runs[target].code !== 0) console.log(`make ${target} output tail:\n${runs[target].out.slice(-2500)}`);
    expect({ target, code: runs[target].code }).toEqual({ target, code: 0 });
  }
});

test("69.5 the browser tests leave one screenshot per test, and the person's project log is unchanged", () => {
  const e2e = runs.e2e;
  const results = e2e.out.split("\n").filter((l) => /^\s*(✓|✘|ok|x|-)\s+\d+\s/.test(l));
  console.log("per-test result lines:", results.length);
  const passed = Number(/(\d+) passed/.exec(e2e.out)?.[1] ?? 0);
  const failed = Number(/(\d+) failed/.exec(e2e.out)?.[1] ?? 0);
  const flaky = Number(/(\d+) flaky/.exec(e2e.out)?.[1] ?? 0);
  const ran = passed + failed + flaky;
  console.log({ passed, failed, flaky });
  expect(ran).toBeGreaterThan(0);
  expect(results.length).toBeGreaterThanOrEqual(ran);
  const shots = pngs(join(c.dir, "test-results"));
  console.log("screenshots:", shots.length);
  expect(shots.length).toBe(ran);
  // The person's project: the clone's own map, and the fixture project the specs copy.
  expect(existsSync(join(c.dir, ".werk/log.jsonl")) ? "present" : undefined).toBe(logBefore);
  expect(sh(c.dir, ["git", "status", "--porcelain", "e2e"]).out.trim()).toBe("");
});
