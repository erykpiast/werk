import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./repo.ts";
import { readFileSync } from "node:fs";

const ci = () => readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const runs = (text: string) => [...text.matchAll(/^\s*-\s+run:\s*(.+)$/gm)].map((m) => (m[1] as string).trim());

test("50.1 a push to the main line runs every check as its own step, builds the executable and starts it once", () => {
  const text = ci();
  expect(text).toMatch(/on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/);
  expect(text).toMatch(/runs-on:\s*ubuntu-latest/);
  expect(text).toContain("actions/checkout");
  const steps = runs(text);
  expect(steps).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  // Each make target installs the locked packages when they are not there: a clean machine has none.
  const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
  expect(makefile).toContain("bun install --frozen-lockfile");
  for (const target of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
    expect(makefile).toMatch(new RegExp(`^${target}: bun-version \\$\\(STAMP\\)`, "m"));
  }
  const smoke = makefile.match(/^smoke:.*\n((?:\t.*\n?)+)/m)?.[1] ?? "";
  expect(smoke).toContain("bun run smoke");
  expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.smoke).toMatch(/build\.ts dist\/smoke --current && bun src\/release\/smoke\.ts/);
  expect(text).not.toMatch(/continue-on-error/);
});

test("50.2 a pull request gets the same run", () => {
  const text = ci();
  expect(text).toMatch(/pull_request:/);
  // One job, one list of steps: a pull request and a push run the same steps.
  expect([...text.matchAll(/^  [a-z-]+:\s*$/gm)].filter((m) => !/^  (push|pull_request)/.test(m[0])).length).toBe(1);
  // The merge button needs a branch rule on GitHub, and no file of the repository sets it.
  expect(text).not.toMatch(/auto-?merge|branch.protection/i);
});

test("50.3 a red run blocks the release and keeps the merge", () => {
  const text = ci();
  expect(text).toMatch(/blocks a release/);
  // The workflow never reverts, resets or force-pushes the commit.
  expect(text).not.toMatch(/git (revert|reset|push)/);
  expect(text).not.toMatch(/follow-?up/i);
});

test("50.4 the run uses the Bun version that the repository pins", () => {
  const text = ci();
  expect(text).toMatch(/oven-sh\/setup-bun@v\d+\s*\n\s+with:\s*\n\s+bun-version-file:\s*\.bun-version/);
  const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
  expect(makefile).toContain("PINNED_BUN := $(shell cat .bun-version)");
  // setup-bun runs before every make step.
  expect(text.indexOf("setup-bun")).toBeLessThan(text.indexOf("make lint"));
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("50.5 an executable that does not serve the map fails the smoke step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-smoke-"));
  dirs.push(dir);
  // A stand-in executable that starts and says it serves, but answers no read of the map.
  const exe = join(dir, "werk-fake");
  mkdirSync(dir, { recursive: true });
  writeFileSync(exe, `#!/usr/bin/env bun\nBun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log("werk: serving on http://127.0.0.1:" + 0);\nsetInterval(() => {}, 1000);\n`);
  chmodSync(exe, 0o755);
  // The address that it prints must point at its server, so print the real port.
  writeFileSync(exe, `#!/usr/bin/env bun\nconst s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 500 }) });\nconsole.log("werk: serving on http://127.0.0.1:" + s.port);\nsetInterval(() => {}, 1000);\n`);
  const p = Bun.spawn(["bun", join(ROOT, "src/release/smoke.ts"), exe], { stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  const err = await new Response(p.stderr).text();
  expect(code).not.toBe(0);
  expect(err).toContain("map read answered 500");
  // The run is red even though the earlier steps are green: the smoke step is its own step of the run.
  expect(runs(ci()).at(-1)).toBe("make smoke");
});
