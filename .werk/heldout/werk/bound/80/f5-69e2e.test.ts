import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("69.5 make e2e runs the specs and leaves one screenshot per test", () => {
  const t = mkdtempSync(join(tmpdir(), "werk-f5-69-5-"));
  const copy = join(t, "repo");
  const sh = (cmd: string, cwd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const cp = sh(`rsync -a --exclude node_modules --exclude .werk-heldout --exclude test-results --exclude .git ${root}/ ${copy}/`, t);
  expect(cp.exitCode).toBe(0);
  expect(sh("bun install --frozen-lockfile", copy).exitCode).toBe(0);
  const run = sh("make e2e", copy);
  const out = run.stdout.toString() + run.stderr.toString();
  const passed = Number(/(\d+) passed/.exec(out)?.[1] ?? 0);
  const failed = Number(/(\d+) failed/.exec(out)?.[1] ?? 0);
  expect(run.exitCode).toBe(0);
  expect(failed).toBe(0);
  expect(passed).toBeGreaterThan(0);
  // each spec result line is a pass or fail
  expect(out.match(/^\s+[✓✘]/gm)?.length).toBe(passed + failed);
  const dirs = readdirSync(join(copy, "test-results"), { withFileTypes: true }).filter((d) => d.isDirectory());
  const pngs = dirs.map((d) => readdirSync(join(copy, "test-results", d.name)).filter((f) => f.endsWith(".png")).length);
  console.log(`passed=${passed} test-result-dirs=${dirs.length} pngs=${pngs.reduce((a, b) => a + b, 0)}`);
  expect(pngs.reduce((a, b) => a + b, 0)).toBe(passed + failed);
  // the project the person works in has no log of its own written by the run
  expect(existsSync(join(copy, ".werk"))).toBe(false);
  expect(existsSync(join(root, ".werk"))).toBe(false);
}, 400000);
