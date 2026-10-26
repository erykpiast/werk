import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { copyApp } from "../../src/test-env/app-copy.ts";

const REPO = join(import.meta.dir, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;
let root: string;
let out: string;
let build: { code: number; stderr: string };

const cleanEnv = (home: string, extra: Record<string, string> = {}) => ({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  ...extra,
});

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-49-")));
  const app = join(root, "app");
  copyApp(app);
  out = join(root, "out");
  const r = Bun.spawnSync(["bun", "src/release/build.ts", out], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
  });
  build = { code: r.exitCode, stderr: r.stderr.toString() };
}, 280_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("49.1 release build", () => {
  test("four executables, each with a matching checksum", () => {
    expect(build.code, build.stderr).toBe(0);
    for (const p of PLATFORMS) {
      const file = join(out, `werk-${p}`);
      expect(existsSync(file)).toBe(true);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      const line = readFileSync(`${file}.sha256`, "utf8");
      expect(line.split(/\s+/)[0]).toBe(digest);
      expect(line).toContain(`werk-${p}`);
    }
    const exes = readdirSync(out).filter((f) => /^werk-[a-z]+-[a-z0-9]+$/.test(f));
    expect(exes.sort()).toEqual(PLATFORMS.map((p) => `werk-${p}`).sort());
  });
});

async function startExe(exe: string, empty: string, home: string) {
  const child = Bun.spawn([exe, "serve", "--port", "0"], {
    cwd: empty,
    env: cleanEnv(home, { WERK_HOME: join(home, "w"), WERK_OPEN: "true" }),
    stdout: "pipe",
    stderr: "pipe",
  });
  let seen = "";
  const decoder = new TextDecoder();
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) seen += decoder.decode(c);
  };
  pump(child.stdout);
  pump(child.stderr);
  const end = Date.now() + 30_000;
  let m: RegExpExecArray | null = null;
  while (!(m = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen))) {
    if (Date.now() > end) throw new Error(`no address:\n${seen}`);
    await Bun.sleep(100);
  }
  return { child, address: m[1] as string, output: () => seen };
}

describe("49.2/49.3 the executable from an empty folder", () => {
  test("serves the client, creates no folder beside itself, and help matches a checkout", async () => {
    expect(build.code, build.stderr).toBe(0);
    const box = join(root, "box");
    const exeDir = join(box, "exe");
    mkdirSync(exeDir, { recursive: true });
    await Bun.write(join(exeDir, "werk"), Bun.file(join(out, `werk-${here}`)));
    Bun.spawnSync(["chmod", "+x", join(exeDir, "werk")]);
    const exe = join(exeDir, "werk");
    const home = join(box, "home");
    mkdirSync(home);
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: exeDir });
    const before = readdirSync(exeDir);

    // 49.3 help
    const helpExe = Bun.spawnSync([exe, "help"], { cwd: exeDir, env: cleanEnv(home) });
    expect(helpExe.exitCode).toBe(0);
    const helpCheckout = Bun.spawnSync(["bun", join(REPO, "src/cli.ts"), "help"], {
      cwd: exeDir,
      env: { ...cleanEnv(home), PATH: process.env.PATH ?? "" },
    });
    const a = helpExe.stdout.toString();
    expect(a.trim()).not.toBe("");
    expect(a).toBe(helpCheckout.stdout.toString());
    expect(a.split("\n").filter((l) => /^ {2}\S/.test(l)).length).toBeGreaterThan(10);
    const shown = Bun.spawnSync([exe, "show"], { cwd: exeDir, env: cleanEnv(home) });
    expect(shown.stderr.toString() + shown.stdout.toString()).not.toMatch(
      /ENOENT|no such file|not found|Cannot find/i,
    );

    // 49.2 serve
    const { child, address, output } = await startExe(exe, exeDir, home);
    try {
      const page = await fetch(`${address}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('id="screen"');
      const src = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
      expect(src).toBeTruthy();
      expect((await fetch(`${address}${src}`)).status).toBe(200);
      const css = /<link[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
      if (css) expect((await fetch(`${address}${css}`)).status).toBe(200);
      expect(output()).not.toMatch(/ENOENT|no such file/i);
    } finally {
      child.kill();
    }
    const after = readdirSync(exeDir).filter((f) => f !== ".werk");
    expect(after.sort()).toEqual(before.filter((f) => f !== ".werk").sort());
  }, 120_000);
});
