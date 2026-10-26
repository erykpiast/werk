import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./support.ts";

type Step = { uses?: string; run?: string; with?: Record<string, string>; "continue-on-error"?: boolean; if?: string };
const workflow = () =>
  Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    on: { push?: { branches?: string[] }; pull_request?: unknown };
    jobs: Record<string, { steps: Step[] }>;
  };
const steps = () => Object.values(workflow().jobs).flatMap((j) => j.steps);
const runs = () => steps().map((s) => s.run);

const sh = async (cwd: string, cmd: string, env: Record<string, string | undefined> = {}) => {
  const p = Bun.spawn(["sh", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "true", ...env } as Record<string, string>,
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out: out + err };
};

let tmp: string;
let clone: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "werk-heldout-50-"));
  clone = join(tmp, "clone");
  const r = await sh(tmp, `git clone -q "${ROOT}" clone`);
  expect(r.code).toBe(0);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("50.1 a push to the main line runs every check and starts the executable", async () => {
  const wf = workflow();
  expect(wf.on.push?.branches).toContain("main");
  const names = runs().filter(Boolean);
  expect(names).toEqual([
    "make lint",
    "make typecheck",
    "make test",
    "make test-coverage",
    "make e2e",
    "make smoke",
  ]);
  expect(steps().some((s) => s.uses?.startsWith("actions/checkout"))).toBe(true);
  // A clean machine: the clone has no installed packages, and the first make target installs the locked ones.
  const first = await sh(clone, "ls node_modules 2>&1 | head -1; make lint 2>&1");
  console.log(first.out.split("\n").slice(0, 12).join("\n"));
  expect(first.out).toContain("frozen");
  expect(first.out).toMatch(/packages installed|installed/);
  expect(first.code).toBe(0);
  const typecheck = await sh(clone, "make typecheck 2>&1");
  expect(typecheck.code).toBe(0);
  const smoke = await sh(clone, "make smoke 2>&1");
  console.log(smoke.out.split("\n").slice(-6).join("\n"));
  expect(smoke.code).toBe(0);
  expect(smoke.out).toMatch(/served its map/);
});

test("50.2 a pull request gets the same run", async () => {
  const wf = workflow();
  expect("pull_request" in wf.on).toBe(true);
  expect(Object.keys(wf.jobs)).toHaveLength(1);
  for (const s of steps()) {
    expect(s.if).toBeUndefined();
    expect(s["continue-on-error"]).toBeUndefined();
  }
  expect(runs()).toContain("make smoke");
  expect(runs()).toContain("make e2e");
});

test("50.3 a red run on the main line names the failed step and keeps the commit", async () => {
  const before = (await sh(clone, "git rev-parse HEAD")).out.trim();
  writeFileSync(join(clone, "src", "heldout-broken.ts"), 'export const n: number = "text";\n');
  const red = await sh(clone, "make typecheck 2>&1");
  expect(red.code).not.toBe(0);
  expect(red.out).toContain("heldout-broken.ts");
  // The merged commit stays on the main line.
  const log = await sh(clone, `git log --format=%H HEAD | grep -c ${before}`);
  expect(log.out.trim()).toBe("1");
  rmSync(join(clone, "src", "heldout-broken.ts"));
  for (const s of steps()) expect(s["continue-on-error"]).toBeUndefined();
});

test("50.4 the run uses the Bun version that the repository pins", async () => {
  const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const all = steps();
  const setup = all.findIndex((s) => s.uses?.startsWith("oven-sh/setup-bun"));
  const firstRun = all.findIndex((s) => s.run !== undefined);
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(setup).toBeLessThan(firstRun);
  expect(all[setup]?.with?.["bun-version-file"]).toBe(".bun-version");
  expect(all[setup]?.with?.["bun-version"]).toBeUndefined();
  // Each make task stops on another Bun version, and names both.
  const shimDir = join(tmp, "shim");
  mkdirSync(shimDir);
  writeFileSync(join(shimDir, "bun"), '#!/bin/sh\necho 9.9.9\n');
  chmodSync(join(shimDir, "bun"), 0o755);
  const wrong = await sh(clone, "make bun-version 2>&1", { PATH: `${shimDir}:${process.env.PATH}` });
  expect(wrong.code).not.toBe(0);
  expect(wrong.out).toContain("9.9.9");
  expect(wrong.out).toContain(pinned);
  const right = await sh(clone, "make bun-version 2>&1");
  expect(right.code).toBe(0);
});

test("50.5 an executable that does not serve the map fails the run", async () => {
  const server = (reply: string) => {
    const file = join(tmp, `fake-${reply.length}`);
    writeFileSync(
      file,
      `#!/bin/sh\nexec "${process.execPath}" -e 'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => ${reply} }); console.log("serving on http://127.0.0.1:" + s.port); setInterval(() => {}, 1000);'\n`,
    );
    chmodSync(file, 0o755);
    return file;
  };
  const bad = server('new Response("no", { status: 500 })');
  const red = await sh(ROOT, `bun src/release/smoke.ts "${bad}" 2>&1`);
  expect(red.code).not.toBe(0);
  expect(red.out).toContain("500");
  const good = server('Response.json({ nodes: [] })');
  const green = await sh(ROOT, `bun src/release/smoke.ts "${good}" 2>&1`);
  expect(green.code).toBe(0);
  // The start step is its own step of the run, after the other checks.
  expect(runs().at(-1)).toBe("make smoke");
});
