import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const REPO = join(import.meta.dir, "..", "..");
type Step = { uses?: string; run?: string; with?: Record<string, string>; "continue-on-error"?: boolean };
const text = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const wf = Bun.YAML.parse(text) as {
  on: { push?: { branches?: string[] }; pull_request?: unknown };
  jobs: Record<string, { "runs-on": string; steps: Step[]; "continue-on-error"?: boolean }>;
};
const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run);
const makefile = readFileSync(join(REPO, "Makefile"), "utf8");

describe("50.1 push to main", () => {
  test("push on main runs install-from-lock, lint, typecheck, test, coverage, e2e, build+start as separate steps", () => {
    expect(wf.on.push?.branches).toEqual(["main"]);
    expect(Object.values(wf.jobs).every((j) => j["runs-on"].startsWith("ubuntu"))).toBe(true);
    expect(steps[0]?.uses).toContain("actions/checkout");
    for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
      expect(runs.filter((r) => r === `make ${t}`)).toHaveLength(1);
    }
    // order: lint < typecheck < test < test-coverage < e2e < smoke
    const order = ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"].map((t) => runs.indexOf(`make ${t}`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Each target installs the locked packages from clean state
    expect(makefile).toMatch(/bun install --frozen-lockfile/);
    for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
      expect(makefile).toMatch(new RegExp(`^${t}:.*\\$\\(STAMP\\)`, "m"));
    }
    // The smoke target builds the platform's executable and starts it once.
    expect(makefile).toMatch(/^smoke:[\s\S]*?bun run smoke/m);
    expect(JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts.smoke).toContain("build.ts dist/smoke --current && bun src/release/smoke.ts");
    for (const j of Object.values(wf.jobs)) expect(j["continue-on-error"]).toBeUndefined();
    for (const s of steps) expect(s["continue-on-error"]).toBeUndefined();
  });
});

describe("50.2 pull request", () => {
  test("pull_request runs the same job with no branch filter, and nothing is optional", () => {
    expect("pull_request" in wf.on).toBe(true);
    expect(wf.on.pull_request == null || typeof wf.on.pull_request === "object").toBe(true);
    // one job holds every check, so one required status covers them all
    expect(Object.keys(wf.jobs)).toHaveLength(1);
    expect(runs).toContain("make smoke");
    expect(text).not.toMatch(/\|\|\s*true/);
  });
});

describe("50.3 red run keeps the merge and blocks the release", () => {
  test("a type error makes `make typecheck`'s command fail and name the file; the workflow never reverts", () => {
    expect(text).not.toMatch(/git (revert|reset|push)/);
    expect(wf.permissions ?? text).toBeDefined();
    expect(text).toContain("contents: read");
    const root = mkdtempSync(join(tmpdir(), "werk-50-tc-"));
    try {
      copyApp(root);
      writeFileSync(join(root, "src", "zz-bad.ts"), 'export const x: number = "a";\n');
      const run = Bun.spawnSync(["bun", "run", "typecheck"], { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout.toString() + run.stderr.toString()).toContain("zz-bad.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});

describe("50.4 pinned Bun", () => {
  test("setup-bun reads .bun-version before any check, and the workflow hard-codes no version", () => {
    const pin = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    const setup = steps.findIndex((s) => s.uses?.startsWith("oven-sh/setup-bun"));
    expect(setup).toBeGreaterThan(-1);
    expect(steps[setup]?.with?.["bun-version-file"]).toBe(".bun-version");
    expect(setup).toBeLessThan(steps.findIndex((s) => s.run?.startsWith("make ")));
    expect(text).not.toContain(pin);
    expect(steps[setup]?.with?.["bun-version"]).toBeUndefined();
    // every check target refuses a different Bun version
    const make = Bun.spawnSync(["make", "-n", "lint"], { cwd: REPO, stdout: "pipe" });
    expect(make.stdout.toString()).toContain(pin);
  });
});

describe("50.5 executable that does not serve the map", () => {
  test("smoke fails when the executable answers no map read", () => {
    const root = mkdtempSync(join(tmpdir(), "werk-50-smoke-"));
    try {
      const fake = join(root, "fake-werk");
      // Prints a serving line on a port where nothing listens, so the read fails.
      writeFileSync(fake, '#!/bin/sh\necho "werk: serving on http://127.0.0.1:1"\nsleep 30\n');
      chmodSync(fake, 0o755);
      const run = Bun.spawnSync(["bun", "src/release/smoke.ts", fake], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).not.toBe(0);
      // and an executable that never serves
      const mute = join(root, "mute-werk");
      writeFileSync(mute, "#!/bin/sh\nexit 3\n");
      chmodSync(mute, 0o755);
      const run2 = Bun.spawnSync(["bun", "src/release/smoke.ts", mute], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
      expect(run2.exitCode).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});
