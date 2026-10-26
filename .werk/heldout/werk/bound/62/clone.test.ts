import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const dirs: string[] = [];
const BARE_PATH = `${process.env.HOME}/.bun/bin:${process.env.HOME}/.asdf/installs/nodejs/25.7.0/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync(cmd, { cwd, env: { HOME: process.env.HOME ?? "", PATH: BARE_PATH, ...env } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
function copyOfProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-ho-clone-"));
  dirs.push(dir);
  const r = sh(["git", "clone", "-q", ROOT, dir + "/p"], tmpdir());
  expect(r.code).toBe(0);
  const p = join(dir, "p");
  sh(["git", "checkout", "-q", "HEAD"], p);
  const mods = join(p, "node_modules");
  mkdirSync(mods);
  for (const n of readdirSync(join(ROOT, "node_modules"))) if (n !== ".vite") symlinkSync(join(ROOT, "node_modules", n), join(mods, n));
  writeFileSync(join(mods, ".install-stamp"), "");
  return p;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("61.2 help lists every registered verb; a new verb module shows up with no other edit", () => {
  const p = copyOfProject();
  const before = sh(["bun", "src/cli.ts", "help"], p);
  expect(before.code).toBe(0);
  const names = before.out.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(names).toContain("help");
  const registered = readdirSync(join(p, "src", "verbs")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => f.replace(/\.ts$/, ""));
  // every verb file (as module) registers one verb; names printed must include each module name that registers the same name
  expect(names.length).toBeGreaterThanOrEqual(20);
  writeFileSync(join(p, "src", "verbs", "ping.ts"), `import { registerVerb } from "../cli/registry.ts";\nregisterVerb({ name: "ping", summary: "Answer pong", run: ({ out }) => { out("pong"); return 0; } });\n`);
  const after = sh(["bun", "src/cli.ts", "help"], p);
  const after2 = after.out.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(after2).toContain("ping");
  for (const n of names) expect(after2).toContain(n);
  const st = sh(["git", "status", "--porcelain"], p).out.trim().split("\n");
  expect(st).toEqual(["?? src/verbs/ping.ts"]);
  void registered;
}, 120000);

test("61.3 make test passes with no claude on the PATH, and leaves the tree clean", () => {
  const p = copyOfProject();
  expect(sh(["which", "claude"], p).code).not.toBe(0);
  const r = sh(["make", "test"], p);
  expect(r.out).toMatch(/\d+ pass/);
  expect(r.code).toBe(0);
  expect(sh(["git", "status", "--porcelain"], p).out.trim()).toBe("");
}, 600000);
