import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./repo-copy.ts";

// These tests read what the workflow file declares. No GitHub run is possible here.
const ROOT = join(import.meta.dir, "..", "..");
const yml = await Bun.file(join(ROOT, ".github/workflows/ci.yml")).text();
const makefile = await Bun.file(join(ROOT, "Makefile")).text();
const pinned = (await Bun.file(join(ROOT, ".bun-version")).text()).trim();
const runs = [...yml.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1]);
const stepsInOrder = [...yml.matchAll(/^\s*- (?:uses|run): (.+)$/gm)].map((m) => m[1]);

test("50.1 a push to main runs lint, typecheck, test, coverage, e2e, then builds and starts the executable", () => {
  expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(runs).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  // Clean machine: a fresh runner, no cache step, and each target installs the frozen lockfile.
  expect(yml).toMatch(/runs-on: ubuntu-latest/);
  expect(yml).not.toMatch(/actions\/cache/);
  expect(makefile).toMatch(/bun install --frozen-lockfile/);
  expect(makefile).toMatch(/smoke:.*\n\tbun run smoke/);
  expect(yml).not.toMatch(/continue-on-error/);
});

test("50.2 a pull request gets the same run", () => {
  expect(yml).toMatch(/^\s*pull_request:/m);
  // One job, no condition that skips a step for a pull request.
  expect(yml).not.toMatch(/^\s*if:/m);
  expect(yml).not.toMatch(/continue-on-error/);
});

test("50.3 a red run does not undo the merge and no step publishes a release", () => {
  expect(yml).not.toMatch(/revert|git push|gh release|publish|deploy/i);
  expect(yml).toMatch(/permissions:\s*\n\s*contents: read/);
  expect(yml).not.toMatch(/continue-on-error/);
});

test("50.4 the run installs the Bun version the repository pins, before any check", () => {
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(yml).toMatch(/oven-sh\/setup-bun@v2\s*\n\s*with:\s*\n\s*bun-version-file: \.bun-version/);
  const setup = stepsInOrder.findIndex((s) => s.startsWith("oven-sh/setup-bun"));
  const firstRun = stepsInOrder.findIndex((s) => s.startsWith("make "));
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(setup).toBeLessThan(firstRun);
  expect(yml).not.toMatch(new RegExp(`bun-version: ['"]?\\d`));
});

test("50.5 an executable that does not answer a read of the map fails the start step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-fakeexe-"));
  try {
    const exe = join(dir, "werk-fake");
    writeFileSync(
      exe,
      `#!/usr/bin/env bun
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });
console.log("werk: serving on http://127.0.0.1:" + server.port);
await new Promise(() => {});
`,
    );
    chmodSync(exe, 0o755);
    const r = await sh(["bun", join(ROOT, "src/release/smoke.ts"), exe], dir);
    expect(r.code).not.toBe(0);
    expect(r.all).toContain("the map read answered 500");
    // The workflow runs this start step last, with no step that hides its failure.
    expect(runs.at(-1)).toBe("make smoke");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
