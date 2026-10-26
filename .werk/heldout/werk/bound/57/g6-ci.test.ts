import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const ci = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const runs = [...ci.matchAll(/^\s*- run: (.+)$/gm)].map((m) => (m[1] as string).trim());
const makefile = readFileSync(join(REPO, "Makefile"), "utf8");

test("50.1 push runs every check as its own step, builds and starts the executable", () => {
  expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(runs).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  // clean install of the locked packages: every check target depends on the stamp, which runs a frozen install
  expect(makefile).toMatch(/bun install --frozen-lockfile/);
  expect(makefile).toMatch(/^lint: .*\$\(STAMP\)/m);
  expect(makefile).toMatch(/^smoke: .*\$\(STAMP\)/m);
  expect(ci).not.toMatch(/continue-on-error/);
  expect(ci).toMatch(/runs-on: ubuntu-latest/);
  expect(ci).not.toMatch(/cache:|actions\/cache/); // a clean state
  const smoke = readFileSync(join(REPO, "package.json"), "utf8");
  expect(smoke).toContain("bun src/release/build.ts dist/smoke --current && bun src/release/smoke.ts");
});

test("50.2 a pull request runs the same job", () => {
  expect(ci).toMatch(/^\s*pull_request:/m);
  expect(ci).not.toMatch(/if:\s/); // no step is skipped for a PR
  // That the merge button waits for green is a repository setting on GitHub; the workflow cannot show it.
});

test("50.3 a failing step makes the run red and nothing in the workflow undoes the merge", () => {
  expect(ci).not.toMatch(/git revert|git reset|push --force/);
  expect(ci).toMatch(/permissions:\s*\n\s*contents: read/);
  expect(ci).not.toMatch(/\b(gh release|publish)\b/);
});

test("50.4 the run installs the pinned Bun version", () => {
  const pinned = readFileSync(join(REPO, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(ci).toMatch(/oven-sh\/setup-bun@v\d+\s*\n\s*with:\s*\n\s*bun-version-file: \.bun-version/);
  expect(ci).not.toMatch(/bun-version:\s*(latest|\d)/);
  const setupAt = ci.indexOf("setup-bun");
  expect(setupAt).toBeGreaterThan(0);
  expect(ci.indexOf("make lint")).toBeGreaterThan(setupAt);
  expect(makefile).toMatch(/PINNED_BUN := \$\(shell cat \.bun-version\)/);
});

test("50.5 an executable that does not answer the map read fails the start step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-g6-smoke-"));
  try {
    const exe = join(dir, "bad-werk");
    writeFileSync(
      exe,
      `#!/usr/bin/env bun\nconst s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log("werk: serving on http://127.0.0.1:" + s.port);\nawait new Promise(() => {});\n`,
    );
    chmodSync(exe, 0o755);
    const r = Bun.spawnSync(["bun", "src/release/smoke.ts", exe], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/map read answered 500/);
    // and the step is the last, unconditional one
    expect(runs.at(-1)).toBe("make smoke");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
