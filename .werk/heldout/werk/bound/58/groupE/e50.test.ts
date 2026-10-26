import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const ci = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const runs = [...ci.matchAll(/^\s+- run: (.+)$/gm)].map((m) => m[1]);

test("50.1 push to main runs lint, typecheck, test, coverage, e2e and the smoke start as separate steps on a clean runner", () => {
  expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(ci).toContain("runs-on: ubuntu-latest");
  expect(runs).toEqual([
    "make lint",
    "make typecheck",
    "make test",
    "make test-coverage",
    "make e2e",
    "make smoke",
  ]);
  // Each make target installs the locked packages first.
  const mk = readFileSync(join(REPO, "Makefile"), "utf8");
  expect(mk).toContain("bun install --frozen-lockfile");
  expect(mk).toMatch(/^smoke: bun-version \$\(STAMP\)/m);
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  expect(pkg.scripts.smoke).toContain("--current");
  expect(pkg.scripts.smoke).toContain("smoke.ts");
});

test("50.2 pull requests run the same job", () => {
  expect(ci).toMatch(/^\s+pull_request:/m);
  // Only one job, so a PR gets exactly the checks of a push.
  expect([...ci.slice(ci.indexOf("jobs:")).matchAll(/^  [a-z-]+:\s*$/gm)].map((m) => m[0].trim())).toEqual(["check:"]);
  // The merge button gate is a GitHub branch-protection setting: not testable from the checkout.
});

test("50.4 the run installs the Bun version the repository pins before any check", () => {
  const setup = ci.indexOf("oven-sh/setup-bun");
  expect(setup).toBeGreaterThan(0);
  expect(ci).toContain("bun-version-file: .bun-version");
  expect(setup).toBeLessThan(ci.indexOf("make lint"));
  expect(readFileSync(join(REPO, ".bun-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

async function smokeAgainst(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "werk-ho-smoke-"));
  try {
    const exe = join(dir, "fake-werk");
    writeFileSync(exe, script);
    chmodSync(exe, 0o755);
    const run = Bun.spawn([process.execPath, "src/release/smoke.ts", exe], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ]);
    return { out, err, code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SERVER = (body: string) => `#!/usr/bin/env bun
const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => ${body} });
console.log("werk: serving on http://127.0.0.1:" + s.port);
await new Promise(() => {});
`;

test("50.5 an executable that does not answer the map read makes the smoke step fail", async () => {
  const bad = await smokeAgainst(SERVER(`new Response("nope", { status: 500 })`));
  expect(bad.code).not.toBe(0);
  expect(bad.err).toMatch(/map read answered 500/);
  const noNodes = await smokeAgainst(SERVER(`Response.json({})`));
  expect(noNodes.code).not.toBe(0);
  // And the workflow has no continue-on-error that would hide it.
  expect(ci).not.toContain("continue-on-error");
  // Smoke is the last step, after e2e.
  expect(runs.at(-1)).toBe("make smoke");
}, 60_000);
