import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyRepo, ROOT } from "./lib.ts";

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true });
});

const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as any;
const job = Object.values(workflow.jobs)[0] as any;
const runs: string[] = job.steps.map((s: any) => s.run).filter(Boolean);

async function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code, all: `${stdout}\n${stderr}` };
}

test("50.1 a push to the main line runs every check and starts the executable", async () => {
  expect(workflow.on.push.branches).toContain("main");
  expect(job["runs-on"]).toBe("ubuntu-latest");
  const order = ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"];
  expect(runs).toEqual(order);
  for (const step of job.steps) expect(step["continue-on-error"]).toBeUndefined();
  // a clean machine: the targets install the locked packages first
  const dir = mkdtempSync(join(tmpdir(), "werk-ci-"));
  cleanups.push(dir);
  for (const f of ["Makefile", "package.json", "bun.lock", ".bun-version"]) copyFileSync(join(ROOT, f), join(dir, f));
  const dry = await sh(["make", "-n", "lint"], dir);
  expect(dry.stdout).toContain("bun install --frozen-lockfile");
  // the build of the executable and its one start (smoke), in a copy of the checkout
  const copy = copyRepo();
  cleanups.push(copy);
  const smoke = await sh(["make", "smoke"], copy);
  expect(smoke.code, smoke.all.slice(-2000)).toBe(0);
  expect(smoke.all).toContain("the executable served its map");
}, 600000);

test("50.2 a pull request gets the same run and merges only on green", () => {
  expect(workflow.on).toHaveProperty("pull_request");
  expect(Object.keys(workflow.jobs)).toHaveLength(1);
  for (const step of job.steps) expect(step.if).toBeUndefined();
  expect(runs).toContain("make smoke");
  // The merge button and the page's failed-step label belong to GitHub, and this checkout has no remote.
});

test("50.3 a red run on the main line blocks the release and keeps the merge", async () => {
  const copy = copyRepo();
  cleanups.push(copy);
  writeFileSync(join(copy, "src/heldout-type-error.ts"), 'export const n: number = "text";\n');
  const typecheck = await sh(["make", "typecheck"], copy);
  expect(typecheck.code).not.toBe(0);
  expect(typecheck.all).toContain("heldout-type-error.ts");
  // no step reverts or rewrites the commit
  expect(runs.join("\n")).not.toMatch(/git (revert|reset|push)/);
}, 300000);

test("50.4 the run uses the Bun version that the repository pins", async () => {
  const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const setup = job.steps.find((s: any) => String(s.uses ?? "").startsWith("oven-sh/setup-bun"));
  expect(setup.with["bun-version-file"]).toBe(".bun-version");
  expect(setup.with["bun-version"]).toBeUndefined();
  expect(job.steps.indexOf(setup)).toBeLessThan(job.steps.findIndex((s: any) => s.run));
  // every make target stops on another Bun version
  const bin = mkdtempSync(join(tmpdir(), "werk-fakebun-"));
  cleanups.push(bin);
  writeFileSync(join(bin, "bun"), '#!/bin/sh\necho 9.9.9\n');
  chmodSync(join(bin, "bun"), 0o755);
  const run = await sh(["make", "bun-version"], ROOT, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain(pinned);
});

test("50.5 an executable that does not serve the map fails the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-badexe-"));
  cleanups.push(dir);
  const exe = join(dir, "werk-bad");
  // it names an address and then answers nothing
  writeFileSync(exe, '#!/bin/sh\necho "werk: serving on http://127.0.0.1:1"\nsleep 30\n');
  chmodSync(exe, 0o755);
  const run = await sh(["bun", "src/release/smoke.ts", exe], ROOT);
  expect(run.code).not.toBe(0);
  const order = job.steps.map((s: any) => s.run).filter(Boolean);
  expect(order.at(-1)).toBe("make smoke");
  for (const step of job.steps) expect(step["continue-on-error"]).toBeUndefined();
}, 120000);
