import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.describe.configure({ mode: "serial" });

let root = "";
let out = "";
let copy = "";
let buildResult: { status: number | null; output: string } = { status: null, output: "" };
const here = `${process.platform}-${process.arch}`;

test.beforeAll(async () => {
  test.setTimeout(900_000);
  root = mkdtempSync(join(tmpdir(), "heldout-49-"));
  copy = join(root, "copy"); // a copy of the checkout, so the build writes no dist folder into the checkout
  out = join(root, "out");
  mkdirSync(copy);
  const arch = spawnSync("sh", ["-c", `git archive HEAD | tar -x -C ${copy}`], { cwd: REPO });
  if (arch.status !== 0) throw new Error("archive failed");
  const inst = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: copy, encoding: "utf8" });
  if (inst.status !== 0) throw new Error(`install failed: ${inst.stderr}`);
  const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: copy, encoding: "utf8", timeout: 600_000 });
  buildResult = { status: built.status, output: `${built.stdout}\n${built.stderr}` };
});
test.afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const exe = () => join(out, `werk-${here}`);
function emptyProject(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: join(root, `home-${name}`) };
  mkdirSync(env.HOME, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  return { dir, env };
}

test("49.1 the release build makes four executables with checksums", () => {
  expect(buildResult.status, buildResult.output.slice(-2000)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(`werk-${platform}`);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  expect(buildResult.status).toBe(0);
  const { dir, env } = emptyProject("p2");
  const only = join(root, "only-exe");
  mkdirSync(only);
  spawnSync("cp", [exe(), join(only, "werk")]);
  // A project is a folder with a git repository, so the empty folder is a fresh `git init`.
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: only, env });
  const before = readdirSync(only);
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(join(only, "werk"), ["serve", "--port", String(port)], { cwd: only, env: { ...env, WERK_HOME: join(root, "wh2"), WERK_OPEN: "true" } });
  void dir;
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
    expect(output).toMatch(/http:\/\/127\.0\.0\.1:\d+|localhost/);
    const errors: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    expect(errors.filter((e) => !e.includes("/api/"))).toEqual([]);
    // `.werk` is the project's own map folder that serve opens, not an unpacked copy of werk's files.
    expect(readdirSync(only).filter((n) => n !== ".werk").sort()).toEqual(before.sort());
    if (existsSync(join(only, ".werk"))) expect(readdirSync(join(only, ".werk")).filter((n) => /html|assets|client|src/.test(n))).toEqual([]);
  } finally { child.kill("SIGTERM"); }
});

test("49.3 the help of the executable lists every command", () => {
  expect(buildResult.status).toBe(0);
  const { dir, env } = emptyProject("p3");
  const exeHelp = spawnSync(exe(), ["help"], { cwd: dir, env, encoding: "utf8" });
  expect(exeHelp.status).toBe(0);
  const checkoutHelp = spawnSync("bun", [join(REPO, "src", "cli.ts"), "help"], { cwd: dir, env: cleanEnv(process.env), encoding: "utf8" });
  expect(exeHelp.stdout.trim().length).toBeGreaterThan(0);
  expect(exeHelp.stdout).toBe(checkoutHelp.stdout);
  const run = spawnSync(exe(), ["search"], { cwd: dir, env, encoding: "utf8" });
  expect(run.status).toBe(0);
  expect(run.stderr).not.toMatch(/missing|no such file|not found|ENOENT/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  expect(buildResult.status).toBe(0);
  const { dir, env } = emptyProject("p4");
  const scriptPath = join(root, "script4.json");
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "worked" }] } } }]] } } }));
  const port = await freePort();
  let output = "";
  const child = spawn(exe(), ["serve", "--port", String(port)], { cwd: dir, env: { ...cleanEnv({ PATH: process.env.PATH, HOME: env.HOME }), WERK_FAKE_SCRIPT: scriptPath, WERK_HOME: join(root, "wh4"), WERK_OPEN: "true" } });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
    await page.goto(`http://127.0.0.1:${port}/`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("add a card");
    await composer.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("worked")).toBeVisible();
    const launches = readRecords(logPathFor(scriptPath)).filter((r) => r.kind === "launch");
    const all = JSON.stringify(launches);
    expect(all).toContain(exe().replace(/\\/g, "\\\\"));
    expect(all).not.toMatch(/\/bun[" ]|cli\.ts/);
  } finally { child.kill("SIGTERM"); }
});
