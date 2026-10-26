import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as any;
const steps: { uses?: string; run?: string; with?: Record<string, string>; name?: string; "continue-on-error"?: boolean }[] = ci.jobs.check.steps;
const runs = steps.flatMap((s) => (s.run ? [s.run] : []));

function copyCheckout(dest: string) {
  const files = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString().split("\n").filter(Boolean);
  for (const f of files) {
    if (f.startsWith(".werk-heldout/")) continue;
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(join(ROOT, f), join(dest, f), { verbatimSymlinks: true });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"));
}
const make = (cwd: string, target: string) => {
  const r = Bun.spawnSync(["make", target], { cwd });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("50.1 a push to the main line runs every check and starts the executable", () => {
  expect(ci.on.push.branches).toContain("main");
  // locked packages from a clean state: a fresh checkout has no node_modules, and each make target installs frozen
  const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
  expect(makefile).toContain("bun install --frozen-lockfile");
  expect(steps[0]?.uses).toMatch(/actions\/checkout/);
  expect(runs).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  expect(steps.every((s) => s["continue-on-error"] !== true)).toBe(true);
  // the smoke step builds the executable for this platform, starts it once and reads the map
  expect(makefile).toMatch(/smoke:[^\n]*\n\tbun run smoke/);
  expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.smoke).toContain("src/release/smoke.ts");
  const dir = mkdtempSync(join(tmpdir(), "heldout-50-"));
  try {
    copyCheckout(dir);
    const r = make(dir, "smoke");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("the executable served its map");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 300000);

test("50.2 a pull request gets the same run", () => {
  expect(ci.on).toHaveProperty("pull_request");
  // one job holds every step, so a pull request and a push run the same checks, the build and the start
  expect(Object.keys(ci.jobs)).toEqual(["check"]);
  expect(runs).toContain("make smoke");
});

test("50.3 a red check on the main line makes the run red and does not undo the merge", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-50-"));
  try {
    copyCheckout(dir);
    appendFileSync(join(dir, "src/toolchain.ts"), '\nexport const broken: number = "not a number";\n');
    const r = make(dir, "typecheck");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/toolchain\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // no step reverts a commit or hides a failure
  const text = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  expect(text).not.toMatch(/git (revert|reset|push)/);
  expect(text).not.toMatch(/continue-on-error|\|\| true/);
});

test("50.4 the run uses the Bun version that the repository pins", () => {
  const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun"));
  expect(setup?.with?.["bun-version-file"]).toBe(".bun-version");
  expect(setup?.with?.["bun-version"]).toBeUndefined();
  // the install comes before every check
  expect(steps.indexOf(setup as object)).toBeLessThan(steps.findIndex((s) => s.run === "make lint"));
  const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(Bun.version).toBe(pinned);
  const dir = mkdtempSync(join(tmpdir(), "heldout-50-"));
  try {
    copyCheckout(dir);
    writeFileSync(join(dir, ".bun-version"), "0.0.1\n");
    const r = make(dir, "lint");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("0.0.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("50.5 an executable that does not serve the map fails the run", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-50-"));
  try {
    const fake = join(dir, "werk-fake");
    writeFileSync(
      fake,
      '#!/usr/bin/env bun\nconst s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log(`werk: serving on http://127.0.0.1:${s.port}`);\nawait new Promise(() => {});\n',
    );
    chmodSync(fake, 0o755);
    const r = Bun.spawnSync(["bun", join(ROOT, "src/release/smoke.ts"), fake], { cwd: ROOT });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toMatch(/map read answered 500/);
    // the workflow runs the smoke step as a normal step, so its failure fails the job
    expect(runs.at(-1)).toBe("make smoke");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
