/**
 * GitHub Actions cannot run here. These tests read and parse .github/workflows/ci.yml, the
 * Makefile and .bun-version, and check what the workflow says it does. Only 50.4's guard and
 * 50.5's start step are run for real (the Makefile guard and src/release/smoke.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const read = (f: string) => readFileSync(join(REPO, f), "utf8");
const raw = read(".github/workflows/ci.yml");
const wf = Bun.YAML.parse(raw) as any;
const makefile = read("Makefile");
const pkg = JSON.parse(read("package.json"));
const jobs = Object.values(wf.jobs) as any[];
const steps: any[] = jobs.flatMap((j) => j.steps);
const runs: string[] = steps.flatMap((s) => (s.run ? [s.run as string] : []));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "werk-g50-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The body of a Makefile target's recipe, with its prerequisites. */
function target(name: string): { deps: string; recipe: string } {
  const m = new RegExp(`^${name}:([^\\n]*)\\n((?:\\t[^\\n]*\\n)*)`, "m").exec(makefile);
  expect(m, `target ${name}`).not.toBeNull();
  return { deps: (m?.[1] ?? "").split("##")[0] as string, recipe: m?.[2] ?? "" };
}

describe("50.1 a push to main runs every check and starts the executable", () => {
  test("the workflow runs on a push to main", () => {
    expect(wf.on.push.branches).toContain("main");
  });
  test("it runs on a clean machine with one fresh checkout and no cache of packages", () => {
    expect(jobs.every((j) => /^ubuntu-/.test(j["runs-on"]))).toBe(true);
    expect(steps[0].uses).toMatch(/^actions\/checkout@/);
    expect(raw).not.toMatch(/actions\/cache|cache:\s/);
  });
  test("every check target installs the locked packages with a frozen lock file", () => {
    expect(target("\\$\\(STAMP\\)").recipe).toContain("bun install --frozen-lockfile");
    for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
      expect(target(t).deps).toContain("$(STAMP)");
    }
  });
  test("lint, typecheck, test, test-coverage, e2e and smoke are separate steps in order", () => {
    const order = ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"];
    expect(runs).toEqual(order);
    expect(steps.filter((s) => s.run).length).toBe(order.length);
  });
  test("test-coverage runs with coverage, e2e runs Playwright", () => {
    expect(pkg.scripts["test:coverage"]).toContain("--coverage");
    expect(target("test-coverage").recipe).toContain("bun run test:coverage");
    expect(target("e2e").recipe).toContain("bun run e2e");
    expect(pkg.scripts.e2e).toContain("playwright test");
  });
  test("the smoke step builds the executable for the runner's platform and starts it once", () => {
    expect(target("smoke").recipe).toContain("bun run smoke");
    expect(pkg.scripts.smoke).toContain("src/release/build.ts");
    expect(pkg.scripts.smoke).toContain("--current");
    expect(pkg.scripts.smoke).toContain("src/release/smoke.ts");
    const smoke = read("src/release/smoke.ts");
    expect(smoke).toMatch(/graph\?shape=1/);
  });
  test("no step is allowed to fail, so a green run means every step passed", () => {
    expect(raw).not.toMatch(/continue-on-error/);
    expect(raw).not.toMatch(/\|\|\s*true/);
    expect(steps.some((s) => s.if)).toBe(false);
  });
  test("the workflow has a name that a branch rule can require", () => {
    expect(wf.name).toBe("ci");
    expect(Object.keys(wf.jobs)).toEqual(["check"]);
  });
  // NOT checkable from the repository: that GitHub shows the commit as releasable. The workflow
  // has no release, tag, or status-setting step; "able to be released" rests on the job's result.
  test("the workflow itself has no release step", () => {
    expect(raw).not.toMatch(/gh release|softprops|upload-artifact|publish/i);
    expect(wf.permissions).toEqual({ contents: "read" });
  });
});

describe("50.2 a pull request gets the same run", () => {
  test("pull_request triggers the same workflow with no branch or path filter", () => {
    expect("pull_request" in wf.on).toBe(true);
    const pr = wf.on.pull_request;
    expect(pr === null || (!pr.branches && !pr["branches-ignore"] && !pr.paths && !pr["paths-ignore"])).toBe(true);
  });
  test("there is no job or step that runs only on push", () => {
    expect(raw).not.toMatch(/github\.event_name|github\.ref/);
    expect(steps.some((s) => s.if)).toBe(false);
    expect(jobs.some((j) => j.if)).toBe(false);
  });
  test("the build and start of the executable are in that same single job", () => {
    expect(jobs.length).toBe(1);
    expect(runs).toContain("make smoke");
  });
  test("NOT CHECKABLE: the merge button and the failed-step name need GitHub", () => {
    // Steps have no name field, so GitHub names each by its command, for example "Run make typecheck".
    expect(steps.filter((s) => s.run).every((s) => s.name === undefined)).toBe(true);
  });
});

describe("50.3 a red run blocks the release and keeps the merge", () => {
  test("the workflow can only report; it never reverts or force-pushes", () => {
    expect(raw).not.toMatch(/git revert|git reset|git push|--force|gh pr|gh api/);
    expect(wf.permissions.contents).toBe("read");
  });
  test("steps run in sequence and none is tolerant, so one failing check ends the job red", () => {
    expect(raw).not.toMatch(/continue-on-error|always\(\)|failure\(\)/);
  });
  test("the header says a red run blocks a release and does not undo the merge", () => {
    expect(raw).toMatch(/red run blocks a release/i);
    expect(raw).toMatch(/does not undo the merge/i);
  });
});

describe("50.4 the run uses the pinned Bun version", () => {
  const pin = read(".bun-version").trim();
  test(".bun-version holds one exact version", () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("setup-bun reads the pin from the file, before any run step, and the workflow hard-codes no version", () => {
    const setup = steps.findIndex((s) => /^oven-sh\/setup-bun@/.test(s.uses ?? ""));
    expect(setup).toBeGreaterThan(-1);
    expect(steps[setup].with["bun-version-file"]).toBe(".bun-version");
    expect(steps[setup].with["bun-version"]).toBeUndefined();
    expect(steps.findIndex((s) => s.run)).toBeGreaterThan(setup);
    expect(raw).not.toMatch(/\d+\.\d+\.\d+/);
  });
  test("every check target first verifies the installed Bun equals the pin", () => {
    for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
      expect(target(t).deps).toContain("bun-version");
    }
    expect(makefile).toMatch(/PINNED_BUN := \$\(shell cat \.bun-version\)/);
  });
  test("this machine runs the pinned version, and the guard passes", () => {
    const r = Bun.spawnSync(["make", "bun-version"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    expect(Bun.version).toBe(pin);
    expect(r.exitCode, r.stderr.toString()).toBe(0);
  });
  test("a new pin in .bun-version is what the guard compares to (a changed pin fails on the old Bun)", () => {
    const dir = join(tmp, "pin");
    mkdirSync(dir);
    copyFileSync(join(REPO, "Makefile"), join(dir, "Makefile"));
    writeFileSync(join(dir, ".bun-version"), "9.9.9\n");
    const r = Bun.spawnSync(["make", "bun-version"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("pinned:    9.9.9");
  });
});

describe("50.5 an executable that does not serve the map fails the run", () => {
  const smoke = (exe: string) =>
    Bun.spawnSync(["bun", join(REPO, "src/release/smoke.ts"), exe], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
  const script = (name: string, body: string) => {
    const f = join(tmp, name);
    writeFileSync(f, `#!/bin/sh\n${body}\n`);
    chmodSync(f, 0o755);
    return f;
  };

  test("the start step is the last step, and its failure ends the job red whatever ran before", () => {
    expect(runs.at(-1)).toBe("make smoke");
    expect(runs.slice(0, -1)).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e"]);
  });
  test("an executable that exits without serving fails the smoke check", () => {
    const r = smoke(script("exits", "exit 0"));
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toMatch(/did not serve/);
  });
  test("an executable that prints an address but answers nothing fails the smoke check", () => {
    const r = smoke(script("silent", 'echo "werk: serving on http://127.0.0.1:9 (pid 1)"; exec sleep 20'));
    expect(r.exitCode).not.toBe(0);
  });
  test("an executable that answers the map read with an error fails the smoke check", () => {
    const server = join(tmp, "bad-server.js");
    writeFileSync(
      server,
      `const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });
console.log("werk: serving on http://127.0.0.1:" + s.port + " (pid " + process.pid + ")");`,
    );
    const r = smoke(script("broken", `exec bun ${server}`));
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toMatch(/answered 500/);
  });
  test("an executable that answers the map read with no node list fails the smoke check", () => {
    const server = join(tmp, "empty-server.js");
    writeFileSync(
      server,
      `const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({}) });
console.log("werk: serving on http://127.0.0.1:" + s.port + " (pid " + process.pid + ")");`,
    );
    const r = smoke(script("nonodes", `exec bun ${server}`));
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toMatch(/no list of nodes/);
  });
  test("control: the real executable passes the same smoke check", () => {
    const out = join(tmp, "real");
    const b = Bun.spawnSync(["bun", "src/release/build.ts", out, "--current"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    expect(b.exitCode, b.stderr.toString()).toBe(0);
    const r = smoke(join(out, `werk-${process.platform}-${process.arch}`));
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(r.stdout.toString()).toContain("served its map");
  });
});
