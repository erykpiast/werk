// The repository's own typecheck, lint and browser tasks, run in a copy of the checkout.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const PATH = (process.env.PATH ?? "").split(delimiter).filter((d) => d && !d.endsWith("fake-bin")).join(delimiter);
let copy = "";
const sh = (cmd: string[], cwd = copy) => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, PATH }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, all: r.stdout.toString() + r.stderr.toString() };
};
const pngs = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pngs(join(dir, e.name)) : e.name.endsWith(".png") ? [e.name] : [])) : [];

beforeAll(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-suite-")));
  copy = join(root, "w");
  Bun.spawnSync(["mkdir", copy]);
  for (const name of readdirSync(CHECKOUT)) {
    if ([".git", ".werk-heldout", "node_modules", "test-results", "dist", "coverage", "playwright-report"].includes(name)) continue;
    Bun.spawnSync(["cp", "-cR", join(CHECKOUT, name), copy]);
  }
  Bun.spawnSync(["cp", "-cRp", join(CHECKOUT, "node_modules"), copy]);
  sh(["git", "init", "-q", "-b", "main"]);
  sh(["git", "add", "-A"]);
  sh(["git", "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-q", "-m", "copy"]);
}, 120000);

test("[61.1 part] make typecheck and make lint succeed", () => {
  const t = sh(["make", "typecheck"]);
  expect(t.code, t.all.slice(-2000)).toBe(0);
  const l = sh(["make", "lint"]);
  expect(l.code, l.all.slice(-2000)).toBe(0);
}, 600000);

test("[61.1 part] make e2e passes [69.5] and leaves one screenshot for each test that ran", () => {
  const r = sh(["make", "e2e"]);
  expect(r.code, r.all.slice(-3000)).toBe(0);
  const passed = [...r.all.matchAll(/^\s+✓\s+(\d+)\s+\[spec\]/gm)].length;
  expect(passed).toBeGreaterThan(10);
  expect(r.all).toMatch(/\d+ passed/);
  const shots = pngs(join(copy, "test-results"));
  expect(shots.length).toBe(passed);
  expect(existsSync(join(copy, ".werk"))).toBe(false);
  expect(sh(["git", "status", "--porcelain"]).all.trim()).toBe("");
}, 1500000);
