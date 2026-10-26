import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const text = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
const workflow = Bun.YAML.parse(text) as {
  on: { push?: { branches?: string[] }; pull_request?: unknown };
  jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string>; "continue-on-error"?: boolean }[] }>;
};
const steps = Object.values(workflow.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run).filter((r): r is string => r !== undefined);

test("50.1 a push to the main line runs every check and starts the executable", () => {
  expect(workflow.on.push?.branches).toContain("main");
  for (const target of ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e"]) {
    expect(runs, target).toContain(target);
  }
  expect(runs.filter((r) => /make (lint|typecheck|test|test-coverage|e2e)$/.test(r))).toHaveLength(5);
  // The build and the start of the executable are one step that reads the map.
  const makefile = readFileSync(join(REPO, "Makefile"), "utf8");
  expect(runs).toContain("make smoke");
  expect(makefile).toMatch(/^smoke:.*\n\tbun run smoke/m);
  expect(readFileSync(join(REPO, "package.json"), "utf8")).toMatch(/"smoke": "bun src\/release\/build\.ts dist\/smoke --current && bun src\/release\/smoke\.ts"/);
  // The locked packages install from a clean state: the install step refuses a lock change.
  expect(makefile).toContain("bun install --frozen-lockfile");
  expect(steps.some((s) => s["continue-on-error"] === true)).toBe(false);
  expect(runs.some((r) => /\|\|\s*true/.test(r))).toBe(false);
});

test("50.1 the executable build and start pass on this machine", () => {
  const run = Bun.spawnSync(["bun", "run", "smoke"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  expect(run.stdout.toString()).toContain("the executable served its map");
}, 300_000);

test("50.4 the run uses the Bun version that the repository pins", () => {
  const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun"));
  expect(setup?.with?.["bun-version-file"]).toBe(".bun-version");
  const order = steps.indexOf(setup as (typeof steps)[number]);
  const firstCheck = steps.findIndex((s) => s.run !== undefined);
  expect(order).toBeLessThan(firstCheck);
  expect(setup?.with?.["bun-version"]).toBeUndefined();
  const pinned = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const make = Bun.spawnSync(["make", "-n", "bun-version"], { cwd: REPO }).stdout.toString();
  expect(make).toContain(pinned);
});

test("50.5 an executable that does not serve the map fails the run", async () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-smoke-"));
  try {
    const fake = join(root, "werk-fake");
    writeFileSync(
      fake,
      `#!/usr/bin/env bun
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no map", { status: 500 }) });
console.log("werk: serving on http://127.0.0.1:" + server.port + " (pid " + process.pid + ")");
await new Promise(() => {});
`,
    );
    chmodSync(fake, 0o755);
    const run = Bun.spawnSync(["bun", join(REPO, "src", "release", "smoke.ts"), fake], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString()).toMatch(/map read answered 500/);
    // The smoke step is a step of the workflow with no way to be skipped.
    expect(runs).toContain("make smoke");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
