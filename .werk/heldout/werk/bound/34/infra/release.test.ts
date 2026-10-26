import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoCopy, sh } from "./repo-copy.ts";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;
let copy: ReturnType<typeof repoCopy>;
let root: string;
let out: string;
let build: Awaited<ReturnType<typeof sh>>;

const cleanEnv = (home: string) => ({ PATH: process.env.PATH ?? "", HOME: home, WERK_HOME: join(home, "werk") });

beforeAll(async () => {
  copy = repoCopy();
  root = mkdtempSync(join(tmpdir(), "werk-heldout-release-"));
  out = join(root, "out");
  build = await sh(["bun", "src/release/build.ts", out], copy.dir);
}, 300000);
afterAll(() => {
  copy?.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(build.code, build.all.slice(-800)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8").trim()).toBe(`${digest}  werk-${platform}`);
  }
});

async function emptyProject() {
  const folder = join(root, `empty-${Math.random().toString(36).slice(2)}`);
  mkdirSync(folder);
  const exeDir = join(folder, "..", "exe-only-" + Math.random().toString(36).slice(2));
  mkdirSync(exeDir);
  await Bun.$`cp ${join(out, `werk-${here}`)} ${exeDir}/werk`;
  await sh(["git", "init", "-q", "-b", "main"], exeDir);
  return exeDir;
}

test("49.2 the executable serves the client from an empty folder", async () => {
  const dir = await emptyProject();
  const home = mkdtempSync(join(tmpdir(), "werk-heldout-home-"));
  const child = Bun.spawn([join(dir, "werk"), "serve", "--port", "0"], {
    cwd: dir,
    env: { ...cleanEnv(home), WERK_OPEN: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = child.stdout.getReader();
    const dec = new TextDecoder();
    let seen = "";
    const end = Date.now() + 30000;
    let address: string | undefined;
    while (Date.now() < end && !address) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
      address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen)?.[1];
    }
    expect(address, seen).toBeDefined();
    const page = await fetch(`${address}/p/${dir.split("/").pop()}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("id=\"screen\"");
    // Every script and style the page names loads.
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect((await fetch(`${address}${ref}`)).status, ref).toBe(200);
    // No folder of werk files appears next to the executable.
    expect(readdirSync(dir).filter((n) => n !== ".git" && n !== ".werk").sort()).toEqual(["werk"]);
  } finally {
    child.kill();
  }
}, 60000);

test("49.3 the help of the executable lists every command the checkout's help lists", async () => {
  const dir = await emptyProject();
  const home = mkdtempSync(join(tmpdir(), "werk-heldout-home-"));
  const exe = await sh([join(dir, "werk"), "--help"], dir, cleanEnv(home));
  const checkout = await sh(["bun", join(copy.dir, "src/cli.ts"), "--help"], copy.dir, cleanEnv(home));
  expect(exe.code).toBe(0);
  const names = (text: string) => text.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).sort();
  expect(names(exe.all).length).toBeGreaterThan(5);
  expect(names(exe.all)).toEqual(names(checkout.all));
  const shown = await sh([join(dir, "werk"), "show"], dir, cleanEnv(home));
  expect(shown.all).not.toMatch(/no such file|not found|ENOENT|missing/i);
}, 60000);

async function serveExe(script?: unknown) {
  const dir = await emptyProject();
  const home = mkdtempSync(join(tmpdir(), "werk-heldout-home-"));
  const env: Record<string, string> = { ...cleanEnv(home), WERK_OPEN: "true" };
  if (script) {
    const path = join(home, "script.json");
    await Bun.write(path, JSON.stringify(script));
    env.WERK_FAKE_SCRIPT = path;
    env.PATH = `${join(import.meta.dir, "../../fake")}:${env.PATH}`;
  }
  const child = Bun.spawn([join(dir, "werk"), "serve", "--port", "0"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const dec = new TextDecoder();
  let seen = "";
  let address: string | undefined;
  const end = Date.now() + 30000;
  while (Date.now() < end && !address) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += dec.decode(value);
    address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen)?.[1];
  }
  if (!address) throw new Error(`no address: ${seen}`);
  return { child, dir, address, url: `${address}/p/${dir.split("/").pop()}`, script: join(home, "script.json") };
}

test("49.2b the client page shows its screen in a browser with no missing file", async () => {
  const { chromium } = await import("@playwright/test");
  const s = await serveExe();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().includes("/api/")) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(s.url);
    await page.getByRole("region", { name: "Map pane" }).waitFor();
    await page.getByRole("complementary", { name: "Chat pane" }).waitFor();
    expect(failed).toEqual([]);
  } finally {
    await browser.close();
    s.child.kill();
  }
}, 60000);

test("49.4 the agent is told to run werk through the executable's own path", async () => {
  const { chromium } = await import("@playwright/test");
  const s = await serveExe({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(s.url);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Show the map with a werk command");
    await composer.press("Enter");
    await page.getByRole("complementary", { name: "Chat pane" }).getByText("ok").first().waitFor();
    const { readRecords, logPathFor } = await import("../../src/fake-agent/launch-log.ts");
    const launch = readRecords(logPathFor(s.script)).find((r) => r.kind === "launch");
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    const exe = join(realpathSync(s.dir), "werk");
    expect(prompt).toContain(`"${exe}" help`);
    expect(prompt).not.toMatch(/\bbun\b|src\/cli\.ts/);
  } finally {
    await browser.close();
    s.child.kill();
  }
}, 60000);
