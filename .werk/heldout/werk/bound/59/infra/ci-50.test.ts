import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, makeGateProject, put } from "./gate-project.ts";
import { buildRelease, CHECKOUT, HERE } from "./release-helper.ts";

const text = readFileSync(join(CHECKOUT, ".github/workflows/ci.yml"), "utf8");
// biome-ignore lint/suspicious/noExplicitAny: a parsed workflow file has no fixed shape here.
const wf: any = Bun.YAML.parse(text);
const steps: { uses?: string; run?: string; with?: Record<string, string>; if?: string; "continue-on-error"?: boolean }[] =
  wf.jobs.check.steps;
const runs = steps.flatMap((s) => (s.run ? [s.run] : []));
const pinned = readFileSync(join(CHECKOUT, ".bun-version"), "utf8").trim();
const makefile = readFileSync(join(CHECKOUT, "Makefile"), "utf8");

let rel: ReturnType<typeof buildRelease>;
const dirs: string[] = [];
beforeAll(() => {
  rel = buildRelease();
}, 300000);
afterAll(() => {
  rmSync(rel.root, { recursive: true, force: true });
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function smoke(exe: string) {
  const proc = Bun.spawn(["bun", join(CHECKOUT, "src/release/smoke.ts"), exe], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("50.1 the push run installs locked packages, runs five separate steps in order, builds and starts the executable, and the smoke step is green", async () => {
  expect(wf.on.push.branches).toContain("main");
  expect(wf.jobs.check["runs-on"]).toBe("ubuntu-latest");
  expect(steps[0]?.uses).toMatch(/^actions\/checkout@/);
  expect(steps[1]?.uses).toMatch(/^oven-sh\/setup-bun@/);
  expect(runs).toEqual(["make lint", "make typecheck", "make test", "make test-coverage", "make e2e", "make smoke"]);
  for (const s of steps) {
    expect(s["continue-on-error"]).toBeUndefined();
    expect(s.if).toBeUndefined();
  }
  // Locked install from a clean state: every check target depends on the install stamp, which runs a frozen install, and node_modules is not committed.
  expect(makefile).toMatch(/bun install --frozen-lockfile/);
  for (const t of ["lint", "typecheck", "test", "test-coverage", "e2e", "smoke"]) {
    expect(makefile).toMatch(new RegExp(`^${t}: bun-version \\$\\(STAMP\\)`, "m"));
  }
  expect(readFileSync(join(CHECKOUT, ".gitignore"), "utf8")).toMatch(/^node_modules$/m);
  expect(Bun.spawnSync(["git", "ls-files", "node_modules"], { cwd: CHECKOUT }).stdout.toString()).toBe("");
  expect(makefile).toMatch(/^smoke:.*\n\tbun run smoke/m);
  expect(JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")).scripts.smoke).toBe(
    "bun src/release/build.ts dist/smoke --current && bun src/release/smoke.ts",
  );
  // The smoke step on the runner's platform, run for real on the executable of this machine: build with --current, start once, read the map.
  const b = Bun.spawnSync(["bun", "src/release/build.ts", join(rel.root, "smoke-out"), "--current"], { cwd: rel.app });
  expect(b.exitCode, b.stderr.toString()).toBe(0);
  const r = await smoke(join(rel.root, "smoke-out", `werk-${HERE}`));
  expect(r.err).toBe("");
  expect(r.out).toMatch(/the executable served its map at http:\/\/127\.0\.0\.1:\d+/);
  expect(r.code).toBe(0);
}, 200000);

test("50.2 a pull request gets the same single job with the same steps", () => {
  expect(Object.keys(wf.on)).toContain("pull_request");
  expect(wf.on.pull_request === null || wf.on.pull_request.branches === undefined).toBe(true);
  expect(Object.keys(wf.jobs)).toEqual(["check"]);
  for (const s of steps) expect(s.if).toBeUndefined();
  expect(runs).toContain("make smoke");
});

test("50.3 a type error makes the typecheck step red and nothing in the workflow undoes a merge or hides the step", async () => {
  expect(JSON.stringify(wf)).not.toMatch(/revert|reset|force|continue-on-error/);
  expect(wf.permissions).toEqual({ contents: "read" });
  const dir = makeGateProject([]);
  dirs.push(dir);
  cpSync(join(CHECKOUT, "tsconfig.json"), join(dir, "tsconfig.json"));
  put(dir, "src/broken.ts", 'export const n: number = "text";\n');
  const r = await make(dir, "typecheck");
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/broken\.ts.*(not assignable|TS2322)/);
  const lint = await make(dir, "bun-version");
  expect(lint.code).toBe(0);
}, 120000);

test("50.4 setup-bun reads the pinned version from the repository file, and the Makefile reads the same file", async () => {
  const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun"));
  expect(setup?.with).toEqual({ "bun-version-file": ".bun-version" });
  expect(setup?.with?.["bun-version"]).toBeUndefined();
  expect(steps.indexOf(setup as (typeof steps)[number])).toBeLessThan(steps.findIndex((s) => s.run));
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(text).not.toContain(pinned);
  expect((await Bun.$`bun --version`.text()).trim()).toBe(pinned);
  // A later change of the pin: the next check names the new pin, because every consumer reads the file.
  const dir = makeGateProject([]);
  dirs.push(dir);
  writeFileSync(join(dir, ".bun-version"), "1.9.9\n");
  const r = await make(dir, "bun-version");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("pinned:    1.9.9");
});

test("50.5 an executable that does not answer the map read fails the smoke step", async () => {
  const dir = makeGateProject([]);
  dirs.push(dir);
  // A fake executable that prints an address, with no server behind it.
  const silent = join(dir, "silent-address");
  writeFileSync(silent, '#!/bin/sh\necho "werk: serving on http://127.0.0.1:9"\nsleep 30\n');
  chmodSync(silent, 0o755);
  const a = await smoke(silent);
  expect(a.code).not.toBe(0);
  // A fake executable that never says where it serves.
  const mute = join(dir, "mute");
  writeFileSync(mute, "#!/bin/sh\nsleep 3\n");
  chmodSync(mute, 0o755);
  const b = await smoke(mute);
  expect(b.code).not.toBe(0);
  mkdirSync(join(dir, "x"), { recursive: true });
  console.log("50.5 exit codes:", a.code, b.code, (a.err + b.err).slice(0, 300));
}, 90000);
