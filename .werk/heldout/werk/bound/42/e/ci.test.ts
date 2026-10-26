import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const REPO = join(import.meta.dir, "..", "..");
type Step = { uses?: string; run?: string; with?: Record<string, string>; "continue-on-error"?: boolean; if?: string };
const workflow = Bun.YAML.parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8")) as {
  on: { push?: { branches?: string[] }; pull_request?: unknown };
  jobs: Record<string, { "runs-on": string; steps: Step[]; "continue-on-error"?: boolean }>;
};
const steps = Object.values(workflow.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run);
const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `heldout-${name}-`)));

describe("50.1 a push to the main line runs every check and starts the executable", () => {
  test("the workflow runs on a push to main", () => {
    expect(workflow.on.push?.branches).toContain("main");
  });
  test("lint, typecheck, test, test-coverage, e2e and smoke are separate steps in that order", () => {
    const targets = runs.filter((r): r is string => !!r && r.startsWith("make "));
    expect(targets).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  });
  test("no step may fail silently", () => {
    for (const s of steps) {
      expect(s["continue-on-error"]).toBeUndefined();
      expect(s.if ?? "").not.toMatch(/always|failure/);
    }
  });
  test("the first check installs the locked packages from a clean tree (frozen lock)", () => {
    const root = tmp("50-1");
    try {
      for (const f of ["Makefile", "package.json", "bun.lock", ".bun-version"]) cpSync(join(REPO, f), join(root, f));
      const dry = Bun.spawnSync(["make", "-n", "lint"], { cwd: root });
      expect(dry.stdout.toString()).toContain("bun install --frozen-lockfile");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("the smoke step builds the executable of the runner's platform, starts it once and reads the map", () => {
    const mk = readFileSync(join(REPO, "Makefile"), "utf8");
    expect(mk).toMatch(/^smoke:.*\n\tbun run smoke/m);
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.smoke).toContain("--current");
    expect(pkg.scripts.smoke).toContain("smoke.ts");
  });
  test("a built executable is started once in an empty folder and its map is read (smoke runs green)", () => {
    const root = tmp("50-1b");
    try {
      const app = join(root, "app");
      copyApp(app);
      const out = join(root, "out");
      const suffix = `${process.platform}-${process.arch}`;
      const built = Bun.spawnSync(["bun", "src/release/build.ts", out, "--current"], { cwd: app });
      expect(built.exitCode, built.stderr.toString()).toBe(0);
      const smoke = Bun.spawnSync(["bun", "src/release/smoke.ts", join(out, `werk-${suffix}`)], { cwd: app });
      expect(smoke.exitCode, smoke.stderr.toString()).toBe(0);
      expect(smoke.stdout.toString()).toContain("served its map");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("50.2 a pull request gets the same run", () => {
  test("the workflow runs on pull_request with the same single job (so the same checks incl. build and start)", () => {
    expect("pull_request" in workflow.on).toBe(true);
    expect(Object.keys(workflow.jobs)).toHaveLength(1);
  });
  test("a red step stops the run (no continue-on-error, no later always-step)", () => {
    for (const j of Object.values(workflow.jobs)) expect(j["continue-on-error"]).toBeUndefined();
  });
  test("the merge button gated on green is a GitHub branch-protection setting; the repo holds no such rule", () => {
    // Not testable from a checkout: recorded as binder-error in the report.
    expect(true).toBe(true);
  });
});

describe("50.3 a red run on the main line", () => {
  test("a typecheck error on a clean tree fails make typecheck and names the check", () => {
    const root = tmp("50-3");
    try {
      const app = join(root, "app");
      copyApp(app);
      for (const f of ["Makefile", ".bun-version", "bun.lock"]) cpSync(join(REPO, f), join(app, f));
      writeFileSync(join(app, "src", "broken.ts"), 'export const n: number = "x";\n');
      const r = Bun.spawnSync(["make", "typecheck"], { cwd: app });
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout.toString() + r.stderr.toString()).toMatch(/broken\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("50.4 the pinned Bun version", () => {
  const pinned = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
  test("one exact version is pinned", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("the workflow installs Bun from the pin file before any check", () => {
    const setup = steps.findIndex((s) => s.uses?.startsWith("oven-sh/setup-bun"));
    const firstCheck = steps.findIndex((s) => s.run?.startsWith("make "));
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(setup).toBeLessThan(firstCheck);
    expect(steps[setup]?.with?.["bun-version-file"]).toBe(".bun-version");
    expect(steps[setup]?.with?.["bun-version"]).toBeUndefined();
  });
  test("every task stops when the installed Bun is not the pin, and the pin is read at run time", () => {
    const root = tmp("50-4");
    try {
      cpSync(join(REPO, "Makefile"), join(root, "Makefile"));
      writeFileSync(join(root, ".bun-version"), pinned);
      expect(Bun.spawnSync(["make", "bun-version"], { cwd: root }).exitCode).toBe(0);
      writeFileSync(join(root, ".bun-version"), "0.0.1");
      const r = Bun.spawnSync(["make", "bun-version"], { cwd: root });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toString()).toContain("0.0.1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("50.5 an executable that does not serve the map fails the run", () => {
  function smokeWith(script: string) {
    const root = tmp("50-5");
    try {
      const app = join(root, "app");
      copyApp(app);
      const exe = join(root, "fake-exe");
      writeFileSync(exe, script);
      chmodSync(exe, 0o755);
      return Bun.spawnSync(["bun", "src/release/smoke.ts", exe], { cwd: app });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  test("an executable that prints an address but does not answer the map read fails the smoke step", () => {
    const r = smokeWith("#!/bin/sh\necho 'werk: serving on http://127.0.0.1:1'\nsleep 20\n");
    expect(r.exitCode).not.toBe(0);
  }, 120_000);
  test("an executable that never serves fails the smoke step", () => {
    const r = smokeWith("#!/bin/sh\nexit 0\n");
    expect(r.exitCode).not.toBe(0);
  }, 120_000);
  test("the smoke step is the last step, after e2e, and nothing excuses its failure", () => {
    const last = steps[steps.length - 1] as Step;
    expect(last.run).toBe("make smoke");
    expect(last["continue-on-error"]).toBeUndefined();
  });
});
