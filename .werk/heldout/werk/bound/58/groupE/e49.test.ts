import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../../src/test-env/env.ts";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";

const REPO = join(import.meta.dir, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;
let root: string;
let out: string;
let built: ReturnType<typeof spawnSync>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "werk-ho-rel-"));
  out = join(root, "out");
  built = spawnSync("bun", ["src/release/build.ts", out], {
    cwd: REPO,
    encoding: "utf8",
  });
}, 300_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function emptyProject(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const env = { PATH: process.env.PATH ?? "", HOME: join(root, `${name}-home`) };
  mkdirSync(env.HOME);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  copyFileSync(join(out, `werk-${here}`), join(dir, "werk"));
  spawnSync("chmod", ["+x", join(dir, "werk")]);
  return { dir, env, exe: join(dir, "werk") };
}

async function waitLine(child: ChildProcess, re: RegExp) {
  let output = "";
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  const end = Date.now() + 30_000;
  while (!re.test(output)) {
    if (Date.now() > end) throw new Error(`no start line:\n${output}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return output;
}

test("49.1 four executables with matching checksums", () => {
  expect(built.status, String(built.stderr)).toBe(0);
  for (const p of PLATFORMS) {
    const file = join(out, `werk-${p}`);
    expect(existsSync(file)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0]).toBe(
      digest,
    );
  }
});

test("49.2 executable serves the client from an empty folder", async () => {
  const p = emptyProject("p2");
  const before = readdirSync(p.dir).sort();
  const child = spawn(p.exe, ["serve", "--port", "0"], {
    cwd: p.dir,
    env: { ...p.env, WERK_HOME: join(root, "h2") },
  });
  try {
    const output = await waitLine(child, /serving on http:\/\/127\.0\.0\.1:\d+/);
    const addr = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? "";
    let html = "";
    try {
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      await page.goto(`${addr}/`);
      await page.locator("#screen").waitFor({ state: "visible", timeout: 10_000 });
      expect(errors).toEqual([]);
      await browser.close();
    } catch (e) {
      throw new Error(`browser check failed: ${String(e)}`);
    }
    html = await (await fetch(`${addr}/`)).text();
    const src = /src="([^"]+\.js)"/.exec(html)?.[1];
    expect(src).toBeDefined();
    expect((await fetch(`${addr}${src}`)).status).toBe(200);
    expect(readdirSync(p.dir).sort().filter((n) => !n.startsWith(".werk"))).toEqual(
      before.filter((n) => !n.startsWith(".werk")),
    );
  } finally {
    child.kill("SIGTERM");
  }
}, 60_000);

test("49.3 help lists every verb, and a listed command works", () => {
  const p = emptyProject("p3");
  const h = spawnSync(p.exe, ["help"], { cwd: p.dir, env: p.env, encoding: "utf8" });
  expect(h.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], {
    cwd: REPO,
    encoding: "utf8",
  });
  expect(h.stdout.trim().length).toBeGreaterThan(0);
  expect(h.stdout).toBe(checkout.stdout);
  const r = spawnSync(p.exe, ["find"], { cwd: p.dir, env: { ...p.env, WERK_HOME: join(root, "h3") }, encoding: "utf8" });
  expect(r.stderr).not.toMatch(/not found|no such file|missing|ENOENT/i);
  expect(r.status).toBe(0);
});

test("49.4 the agent is told to run the executable path, and that command works", async () => {
  const p = emptyProject("p4");
  const script = join(root, "script4.json");
  writeFileSync(
    script,
    JSON.stringify({
      roles: {
        chat: {
          replies: [[{ event: { type: "assistant", message: { id: "m", content: [{ type: "text", text: "ok" }] } } }]],
        },
      },
    }),
  );
  const env = {
    ...cleanEnv(process.env),
    WERK_FAKE_SCRIPT: script,
    WERK_OPEN: "true",
    WERK_HOME: join(root, "h4"),
  };
  const child = spawn(p.exe, ["serve", "--port", "0"], { cwd: p.dir, env });
  try {
    const output = await waitLine(child, /serving on http:\/\/127\.0\.0\.1:\d+/);
    const addr = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? "";
    const name = p.dir.split("/").pop();
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${addr}/p/${name}`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("run a werk command");
    await composer.press("Enter");
    const end = Date.now() + 20_000;
    let launch: ReturnType<typeof readRecords>[number] | undefined;
    while (!launch && Date.now() < end) {
      launch = readRecords(logPathFor(script)).find((r) => r.kind === "launch");
      if (!launch) await new Promise((r) => setTimeout(r, 100));
    }
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${realpathSync(p.exe)}" help`);
    expect(prompt).not.toMatch(/bun|cli\.ts/);
    // The command the prompt names works from this folder.
    const r = spawnSync(p.exe, ["find"], { cwd: p.dir, env: { ...p.env, WERK_HOME: join(root, "h4b") }, encoding: "utf8" });
    expect(r.status).toBe(0);
    await browser.close();
  } finally {
    child.kill("SIGTERM");
  }
}, 60_000);
