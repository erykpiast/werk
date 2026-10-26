import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";
import { repoCopy } from "./repo-copy.ts";

/** Where the built executables stay, so the browser spec can use them. */
export const STATE = join(realpathSync(tmpdir()), "werk-heldout-release.json");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
let out = "";
let built = { code: -1, text: "" };

beforeAll(async () => {
  const copy = repoCopy();
  const p = Bun.spawn(["make", "release-build"], { cwd: copy, env: cleanEnv(process.env), stdout: "pipe", stderr: "pipe" });
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  built = { code, text: o + e };
  out = join(copy, "dist", "release");
  writeFileSync(STATE, JSON.stringify({ out, copy }));
}, 600000);

describe("49", () => {
  test("49.1 the release build makes four executables with checksums", () => {
    expect(built.code, built.text.slice(-1500)).toBe(0);
    for (const platform of PLATFORMS) {
      const file = join(out, `werk-${platform}`);
      expect(existsSync(file), file).toBe(true);
      expect(existsSync(`${file}.sha256`)).toBe(true);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
    }
  });

  test("49.3 the help of the executable lists every command", async () => {
    const here = `${process.platform}-${process.arch}`;
    const exe = join(out, `werk-${here}`);
    const empty = mkdtempSync(join(realpathSync(tmpdir()), "werk-heldout-empty-"));
    const home = mkdtempSync(join(realpathSync(tmpdir()), "werk-heldout-home-"));
    const env = { PATH: "/usr/bin:/bin", HOME: home };
    const run = (cmd: string[], cwd: string) => {
      const r = Bun.spawnSync(cmd, { cwd, env });
      return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
    };
    const help = run([exe, "help"], empty);
    expect(help.code).toBe(0);
    const checkout = run([process.execPath, join(import.meta.dirname, "..", "src", "cli.ts"), "help"], empty);
    const names = (t: string) => t.split("\n").map((l) => /^\s{2}(\S+)\s/.exec(l)?.[1]).filter(Boolean);
    expect(names(help.out).length).toBeGreaterThan(10);
    expect(names(help.out)).toEqual(names(checkout.out));
    // A listed command works in a project folder, with no missing file or folder.
    mkdirSync(join(empty, ".werk"));
    run(["git", "init", "-q", "-b", "main"], empty);
    const added = run([exe, "add", "root", "--title", "Root"], empty);
    expect(added.err).not.toMatch(/ENOENT|no such file|not found|missing/i);
    expect(added.code).toBe(0);
    const shown = run([exe, "show", "root"], empty);
    expect(shown.code).toBe(0);
    expect(shown.out).toContain("Root");
    expect(readdirSync(empty).sort()).toEqual([".git", ".werk"]);
  });
});
