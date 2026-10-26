import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
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
import { afterAll } from "bun:test";

const REPO = join(import.meta.dir, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g49-")));
const out = join(root, "out");
let build: ReturnType<typeof Bun.spawnSync>;

beforeAll(() => {
  // Builds into a temp folder, never into the checkout's release folder.
  build = Bun.spawnSync(["bun", "src/release/build.ts", out], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
}, 300_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("49.1 the release build", () => {
  test("finishes with no error", () => {
    expect(build.exitCode, build.stderr.toString()).toBe(0);
  });
  test("one executable per platform, each with a matching checksum file", () => {
    for (const p of PLATFORMS) {
      const file = join(out, `werk-${p}`);
      expect(existsSync(file)).toBe(true);
      expect(existsSync(`${file}.sha256`)).toBe(true);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(readFileSync(`${file}.sha256`, "utf8")).toBe(`${digest}  werk-${p}\n`);
    }
    const exes = readdirSync(out).filter((f) => f.startsWith("werk-") && !f.endsWith(".sha256"));
    expect(exes.sort()).toEqual([...PLATFORMS].sort().map((p) => `werk-${p}`));
  });
  test("the checksum file verifies with shasum", () => {
    const here = `${process.platform}-${process.arch}`;
    const r = Bun.spawnSync(["shasum", "-a", "256", "-c", `werk-${here}.sha256`], {
      cwd: out,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
  });
});

describe("49.3 the executable's help", () => {
  const here = `${process.platform}-${process.arch}`;
  const home = join(root, "home");
  const empty = join(root, "empty");
  mkdirSync(home, { recursive: true });
  mkdirSync(empty, { recursive: true });
  // A PATH with no bun, no inherited werk state.
  const env = { PATH: "/usr/bin:/bin", HOME: home };
  const exe = () => join(out, `werk-${here}`);

  test("lists every command that the checkout's help lists, and is not empty", () => {
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: empty, env });
    const help = Bun.spawnSync([exe(), "help"], { cwd: empty, env, stdout: "pipe", stderr: "pipe" });
    expect(help.exitCode, help.stderr.toString()).toBe(0);
    const text = help.stdout.toString();
    const checkout = Bun.spawnSync(["bun", "src/cli.ts", "help"], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    }).stdout.toString();
    const verbsOf = (t: string) =>
      t.split("\n").flatMap((l) => (/^  ([a-z-]+)\s{2,}\S/.exec(l)?.[1] ? [/^  ([a-z-]+)/.exec(l)?.[1] as string] : []));
    const fromExe = verbsOf(text);
    const fromCheckout = verbsOf(checkout);
    expect(fromCheckout.length).toBeGreaterThan(10);
    expect(fromExe.length).toBeGreaterThan(0);
    expect(fromExe).toEqual(fromCheckout);
    // Every verb module file of the checkout is a verb in the help.
    const modules = readdirSync(join(REPO, "src/verbs"))
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
      .map((n) => n.replace(/\.ts$/, ""));
    for (const m of modules) expect(text).toContain(` ${m} `);
  });

  test("a listed command works with the executable and reports no missing file", () => {
    const run = (...args: string[]) =>
      Bun.spawnSync([exe(), ...args], { cwd: empty, env, stdout: "pipe", stderr: "pipe" });
    const added = run("add", "c1", "--title", "A card does x", "--why", "w", "--body", "b");
    expect(added.exitCode, added.stderr.toString()).toBe(0);
    const shown = run("show", "c1");
    expect(shown.exitCode, shown.stderr.toString()).toBe(0);
    expect(shown.stdout.toString()).toContain("A card does x");
    const all = shown.stdout.toString() + shown.stderr.toString() + added.stderr.toString();
    expect(all).not.toMatch(/ENOENT|no such file|not found|cannot find|missing/i);
  });
});
