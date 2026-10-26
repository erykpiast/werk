import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const workflow = Bun.YAML.parse(
  readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"),
) as any;
const makefile = readFileSync(join(REPO, "Makefile"), "utf8");
const steps: any[] = Object.values(workflow.jobs).flatMap((j: any) => j.steps);
const runs = steps.map((s) => s.run).filter(Boolean) as string[];
const on = workflow.on ?? workflow[true as any];

test("50.1 a push to main runs lint, typecheck, test, coverage, e2e, builds and starts the executable", () => {
  expect(on.push.branches).toContain("main");
  // The locked packages install from a clean state: the make target installs with --frozen-lockfile.
  expect(makefile).toMatch(/bun install --frozen-lockfile/);
  expect(JSON.stringify(steps)).not.toMatch(/cache/i);
  expect(runs).toEqual(
    expect.arrayContaining([
      "make lint",
      "make typecheck",
      "make test",
      "make test-coverage",
      "make e2e",
    ]),
  );
  // The build and the start of the executable are a step, and the smoke target does both.
  const smoke = runs.find((r) => /smoke/.test(r));
  expect(smoke).toBeTruthy();
  expect(makefile).toMatch(/smoke:.*\n\tbun run smoke/);
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  expect(pkg.scripts.smoke).toContain("build.ts");
  expect(pkg.scripts.smoke).toContain("smoke.ts");
  for (const s of steps) expect(s["continue-on-error"]).toBeUndefined();
  // The real run on GitHub and the "can be released" mark on the commit need GitHub itself: not run here.
});

test("50.1b the smoke target builds the executable for this platform, starts it, reads the map and ends green", () => {
  const run = Bun.spawnSync(["bun", "run", "smoke"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(run.exitCode, run.stdout.toString() + run.stderr.toString()).toBe(0);
  expect(run.stdout.toString()).toContain("the executable served its map");
}, 200_000);

test("50.2 a pull request gets the same run with the build and the start", () => {
  expect(on.pull_request).toBeDefined();
  // One job runs for both triggers, so the pull request has every step of a push.
  expect(Object.keys(workflow.jobs)).toHaveLength(1);
  expect(runs.some((r) => /smoke/.test(r))).toBe(true);
  // "the merge button is available only when every step is green" is a branch-protection setting
  // of the GitHub repository. No file in the repository sets it, and it needs GitHub to observe.
});

test("50.3 the workflow neither reverts a merged commit nor hides a failed step", () => {
  const text = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
  expect(text).not.toMatch(/git revert|git reset|continue-on-error|\|\| true/);
  // Each failed check is its own step, so the run names the failed step.
  expect(runs.length).toBeGreaterThanOrEqual(6);
  // The red commit mark and the follow-up ticket from a failure need a real GitHub run.
});

test("50.4 the run installs the Bun version the repository pins, before any check", () => {
  const i = steps.findIndex((s) => /setup-bun/.test(s.uses ?? ""));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(steps[i].with["bun-version-file"]).toBe(".bun-version");
  const firstRun = steps.findIndex((s) => s.run);
  expect(i).toBeLessThan(firstRun);
  expect(readFileSync(join(REPO, ".bun-version"), "utf8").trim()).toMatch(
    /^\d+\.\d+\.\d+$/,
  );
  // The make targets stop on a different version, so the log would show the pinned one.
  expect(makefile).toMatch(/PINNED_BUN := \$\(shell cat \.bun-version\)/);
});

test("50.5 an executable that does not answer a map read fails the smoke step", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-50-"));
  try {
    const exe = join(dir, "werk-bad");
    writeFileSync(
      exe,
      `#!/usr/bin/env bun
const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });
console.log("werk: serving on http://127.0.0.1:" + s.port);
await new Promise(() => {});
`,
    );
    chmodSync(exe, 0o755);
    const run = Bun.spawnSync(["bun", join(REPO, "src/release/smoke.ts"), exe], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString()).toContain("map read answered 500");
    // smoke is a plain step of the job, after the other checks, so a failure ends the run red.
    const smokeAt = runs.findIndex((r) => /smoke/.test(r));
    expect(smokeAt).toBe(runs.length - 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
