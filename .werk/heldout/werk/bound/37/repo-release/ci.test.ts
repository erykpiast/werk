import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const REPO = join(import.meta.dir, "..", "..");
const text = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
// biome-ignore lint/suspicious/noExplicitAny: the shape of a workflow file
const wf = (Bun as any).YAML.parse(text) as any;
const jobs = Object.values(wf.jobs) as any[];
const steps: any[] = jobs.flatMap((j) => j.steps);
const runs = steps.filter((s) => s.run).map((s) => s.run as string);

describe("50.1 push runs every check", () => {
  test("runs on push to main, with each check as its own step, then the smoke start", () => {
    expect(wf.on.push.branches).toContain("main");
    for (const target of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
      expect(runs).toContain(`make ${target}`);
    }
    expect(runs.indexOf("make smoke")).toBeGreaterThan(runs.indexOf("make e2e"));
    expect(jobs.every((j) => String(j["runs-on"]).includes("ubuntu"))).toBe(true);
    expect(JSON.stringify(steps)).not.toMatch(/continue-on-error/);
  });
  test("a clean machine installs the locked packages: the stamp rule runs bun install --frozen-lockfile", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50-")));
    try {
      for (const f of ["Makefile", "package.json", "bun.lock", ".bun-version"])
        cpSync(join(REPO, f), join(dir, f));
      const r = Bun.spawnSync(["make", "-n", "lint"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      expect(r.stdout.toString()).toContain("bun install --frozen-lockfile");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("make smoke builds the executable for this platform, starts it once and reads the map", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50s-")));
    try {
      copyApp(dir);
      for (const f of ["Makefile", ".bun-version", "bun.lock"]) cpSync(join(REPO, f), join(dir, f));
      mkdirSync(join(dir, ".make"), { recursive: true });
      // The install stamp is current in this copy, because node_modules is linked in.
      writeFileSync(join(dir, "node_modules/.install-stamp"), "");
      const r = Bun.spawnSync(["make", "smoke"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode, r.stderr.toString()).toBe(0);
      expect(r.stdout.toString()).toContain("the executable served its map");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("50.2 a pull request gets the same run", () => {
  test("pull_request triggers the same job and steps", () => {
    expect("pull_request" in wf.on).toBe(true);
    expect(wf.on.pull_request?.branches).toBeUndefined();
    expect(Object.keys(wf.jobs)).toHaveLength(1);
  });
});

describe("50.3 a red run on main keeps the merge", () => {
  test("the workflow never reverts, resets or pushes, and has read-only permissions; a failing step stops the job", () => {
    expect(JSON.stringify(wf)).not.toMatch(/git (revert|reset|push)/);
    expect(wf.permissions).toEqual({ contents: "read" });
    // A typecheck error fails `make typecheck`, so the job is red and the later steps do not run.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50t-")));
    try {
      copyApp(dir);
      for (const f of ["Makefile", ".bun-version", "bun.lock"]) cpSync(join(REPO, f), join(dir, f));
      writeFileSync(join(dir, "node_modules/.install-stamp"), "");
      writeFileSync(join(dir, "src/broken.ts"), 'export const x: number = "no";\n');
      const r = Bun.spawnSync(["make", "typecheck"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout.toString() + r.stderr.toString()).toContain("broken.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("50.4 the pinned Bun version", () => {
  test("setup-bun reads the pinned file before any check, and no version is hard-coded", () => {
    const i = steps.findIndex((s) => String(s.uses).startsWith("oven-sh/setup-bun"));
    const firstRun = steps.findIndex((s) => s.run);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(firstRun);
    expect(steps[i].with["bun-version-file"]).toBe(".bun-version");
    expect(steps[i].with["bun-version"]).toBeUndefined();
    expect(readFileSync(join(REPO, ".bun-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("every make check stops on a Bun that differs from the pinned file", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50b-")));
    try {
      cpSync(join(REPO, "Makefile"), join(dir, "Makefile"));
      writeFileSync(join(dir, ".bun-version"), "9.9.9\n");
      const r = Bun.spawnSync(["make", "bun-version"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toString()).toContain("9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("50.5 an executable that does not serve the map fails the start step", () => {
  const fakeExe = (dir: string, body: string) => {
    const file = join(dir, "werk-fake");
    writeFileSync(
      file,
      `#!/usr/bin/env bun\nconst s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: ${body} });\nconsole.log(\`werk: serving on http://127.0.0.1:\${s.port}\`);\n`,
    );
    chmodSync(file, 0o755);
    return file;
  };
  test("an executable whose map read answers 500 makes smoke exit non-zero", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50f-")));
    try {
      const exe = fakeExe(dir, '() => new Response("boom", { status: 500 })');
      const r = Bun.spawnSync(["bun", join(REPO, "src/release/smoke.ts"), exe], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.toString()).toContain("500");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("an executable that never answers the map read makes smoke exit non-zero", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-50h-")));
    try {
      const exe = fakeExe(dir, "() => new Promise(() => {})");
      const r = Bun.spawnSync(["bun", join(REPO, "src/release/smoke.ts"), exe], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 45_000,
      });
      // exitCode is null/signal when the timeout killed a smoke that hung.
      expect(r.exitCode, "smoke hung and was killed by the test's limit").not.toBeNull();
      expect(r.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
