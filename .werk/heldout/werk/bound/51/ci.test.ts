import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const workflow = () =>
  Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as any;
const steps = () => Object.values(workflow().jobs as Record<string, any>).flatMap((j) => j.steps as any[]);
const runs = () => steps().map((s) => s.run as string | undefined);

function copy(exclude: string[] = [".git", ".werk-heldout"]) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heldout-50-")));
  const args = ["-a", ...exclude.flatMap((e) => ["--exclude", e]), `${ROOT}/`, `${dir}/`];
  expect(Bun.spawnSync(["rsync", ...args]).exitCode).toBe(0);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const sh = (cwd: string, cmd: string[], env: Record<string, string> = {}) => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("50.1 a push to main runs every check as its own step, builds and starts the executable", () => {
  const w = workflow();
  expect(w.on.push.branches).toContain("main");
  const r = runs().filter(Boolean);
  const order = ["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"];
  const at = order.map((o) => r.indexOf(o));
  for (const i of at) expect(i).toBeGreaterThanOrEqual(0);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  // A clean machine has no node_modules: the first target installs the locked packages.
  const clean = copy([".git", ".werk-heldout", "node_modules"]);
  try {
    const dry = sh(clean.dir, ["make", "-n", "lint"]);
    expect(dry.out).toContain("bun install --frozen-lockfile");
  } finally {
    clean.done();
  }
  const full = copy();
  try {
    const smoke = sh(full.dir, ["make", "smoke"]);
    expect(smoke.code, smoke.out.slice(-2000)).toBe(0);
    expect(smoke.out).toContain("the executable served its map");
  } finally {
    full.done();
  }
}, 300_000);

test("50.2 a pull request gets the same run", () => {
  const w = workflow();
  expect(w.on).toHaveProperty("pull_request");
  expect(w.on).toHaveProperty("push");
  // One job holds every check, and no step is skipped by the kind of event.
  expect(Object.keys(w.jobs)).toHaveLength(1);
  for (const s of steps()) expect(s.if).toBeUndefined();
  expect(runs()).toContain("make smoke");
  expect(runs()).toContain("make e2e");
});

test("50.3 a red check fails the run, and nothing in the run undoes the merge", () => {
  const w = workflow();
  for (const job of Object.values(w.jobs as Record<string, any>)) {
    expect(job["continue-on-error"]).toBeUndefined();
    for (const s of job.steps) {
      expect(s["continue-on-error"]).toBeUndefined();
      expect(String(s.run ?? "")).not.toMatch(/\|\| true|git revert|git push|git reset/);
    }
  }
  expect(w.permissions.contents).toBe("read");
});

test("50.4 the run installs the Bun version that the repository pins", () => {
  const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const all = steps();
  const setup = all.findIndex((s) => String(s.uses ?? "").startsWith("oven-sh/setup-bun"));
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(all[setup].with["bun-version-file"]).toBe(".bun-version");
  expect(all[setup].with["bun-version"]).toBeUndefined();
  const firstCheck = all.findIndex((s) => /^make /.test(String(s.run ?? "")));
  expect(setup).toBeLessThan(firstCheck);
  // A different Bun version stops a make target.
  const bin = mkdtempSync(join(tmpdir(), "heldout-bun-"));
  try {
    writeFileSync(join(bin, "bun"), '#!/bin/sh\necho 9.9.9\n');
    chmodSync(join(bin, "bun"), 0o755);
    const r = sh(ROOT, ["make", "bun-version"], { PATH: `${bin}:${process.env.PATH}` });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(pinned);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("50.5 an executable that does not serve the map fails the smoke step", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heldout-stub-")));
  try {
    const stub = (status: number, body: string) => {
      const file = join(dir, `stub-${status}`);
      writeFileSync(
        file,
        `#!/usr/bin/env bun\nconst s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(${JSON.stringify(body)}, { status: ${status} }) });\nconsole.log(\`werk: serving on http://127.0.0.1:\${s.port} (pid \${process.pid})\`);\nawait new Promise(() => {});\n`,
      );
      chmodSync(file, 0o755);
      return file;
    };
    const bad = sh(ROOT, ["bun", "src/release/smoke.ts", stub(500, "boom")]);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/500/);
    const empty = sh(ROOT, ["bun", "src/release/smoke.ts", stub(200, "{}")]);
    expect(empty.code).not.toBe(0);
    const good = sh(ROOT, ["bun", "src/release/smoke.ts", stub(200, '{"nodes":[]}')]);
    expect(good.code).toBe(0);
    // The smoke step ends the run red: it is a plain step of the job.
    const step = steps().find((s) => s.run === "make smoke");
    expect(step["continue-on-error"]).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
