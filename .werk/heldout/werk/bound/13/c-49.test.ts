import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS, releaseBuild } from "./c-release-build.ts";

let build: ReturnType<typeof releaseBuild>;
let emptyRoot: string;
beforeAll(() => {
  build = releaseBuild();
  emptyRoot = realpathSync(mkdtempSync(join(tmpdir(), "werk-c49-")));
}, 120000);
afterAll(() => {
  rmSync(build.root, { recursive: true, force: true });
  rmSync(emptyRoot, { recursive: true, force: true });
});

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(build.code, build.stderr).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(build.out, `werk-${platform}`);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.sha256`)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const line = readFileSync(`${file}.sha256`, "utf8");
    expect(line.split(/\s+/)[0]).toBe(digest);
    expect(line).toContain(`werk-${platform}`);
    // the same check a person runs with the system tool
    const check = Bun.spawnSync(["shasum", "-a", "256", "-c", `werk-${platform}.sha256`], {
      cwd: build.out,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(check.exitCode, check.stderr.toString()).toBe(0);
  }
  const exes = readdirSync(build.out).filter((n) => /^werk-(darwin|linux)-(arm64|x64)$/.test(n));
  expect(exes.sort()).toEqual([...PLATFORMS].map((p) => `werk-${p}`).sort());
});

test("49.3 the help of the executable lists every command the checkout lists, and a listed command works", () => {
  const dir = join(emptyRoot, "p3");
  mkdirSync(dir);
  const env = { PATH: "/usr/bin:/bin", HOME: join(emptyRoot, "home3") };
  mkdirSync(env.HOME);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir, env });
  const exe = join(dir, "werk");
  copyFileSync(build.exeFor(), exe);
  Bun.spawnSync(["chmod", "+x", exe]);

  const fromExe = Bun.spawnSync([exe, "help"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  expect(fromExe.exitCode).toBe(0);
  const fromCheckout = Bun.spawnSync(["bun", "src/cli.ts", "help"], {
    cwd: build.repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(fromCheckout.exitCode).toBe(0);
  const names = (text: string) =>
    text
      .split("\n")
      .map((l) => /^ {2}(\S+)\s/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
  const exeNames = names(fromExe.stdout.toString());
  const checkoutNames = names(fromCheckout.stdout.toString());
  expect(exeNames.length).toBeGreaterThan(10);
  expect(checkoutNames.length).toBeGreaterThan(10);
  expect(exeNames).toEqual(checkoutNames);

  const run = Bun.spawnSync([exe, "find"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  const text = run.stdout.toString() + run.stderr.toString();
  expect(run.exitCode, text).toBe(0);
  expect(text).not.toMatch(/ENOENT|no such file|not found|missing|cannot find/i);
  for (const verb of ["inbox", "search", "status"]) {
    const r = Bun.spawnSync([exe, verb], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    expect(r.stderr.toString() + r.stdout.toString()).not.toMatch(/ENOENT|no such file or directory|cannot find/i);
  }
}, 60000);

describe("sanity", () => {
  test("the checkout's own release spec exists", () => {
    expect(existsSync(join(build.repo, "e2e", "release.spec.ts"))).toBe(true);
  });
});
