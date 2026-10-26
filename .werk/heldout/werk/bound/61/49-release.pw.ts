import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { cloneHead, ROOT, sh } from "./repo.ts";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const HERE = `${process.platform}-${process.arch}`;
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

let built: { out: string; clone: ReturnType<typeof cloneHead>; buildStatus: number; buildOut: string };
test.beforeAll(async () => {
  test.setTimeout(600_000);
  const clone = cloneHead(true);
  const out = join(clone.dir, "out");
  const r = spawnSync("bun", ["src/release/build.ts", out], { cwd: clone.repo, encoding: "utf8" });
  built = { out, clone, buildStatus: r.status ?? 1, buildOut: `${r.stdout}${r.stderr}` };
});
test.afterAll(() => built?.clone.dispose());

test("49.1 the release build makes four executables with checksums", async () => {
  expect(built.buildStatus, built.buildOut.slice(-2000)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(built.out, `werk-${platform}`);
    expect(existsSync(file), `missing ${file}`).toBe(true);
    const sum = join(`${file}.sha256`);
    expect(existsSync(sum)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8").split(/\s+/)[0]).toBe(digest);
    expect(readFileSync(sum, "utf8")).toContain(`werk-${platform}`);
  }
});

function emptyFolder(withExe = true) {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-exe-"));
  const folder = join(root, "empty");
  mkdirSync(folder);
  const exe = join(folder, "werk");
  if (withExe) {
    copyFileSync(join(built.out, `werk-${HERE}`), exe);
    chmodSync(exe, 0o755);
  }
  const env = { PATH: process.env.PATH ?? "", HOME: join(root, "home"), WERK_HOME: join(root, "werk-home") };
  mkdirSync(env.HOME);
  return { root, folder, exe, env };
}

async function serveExe(env: Record<string, string>, folder: string, exe: string) {
  const port = await freePort();
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: folder, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
  return { child, port, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  const e = emptyFolder();
  let child: ChildProcess | undefined;
  try {
    const before = readdirSync(e.folder);
    expect(before).toEqual(["werk"]);
    const served = await serveExe(e.env, e.folder, e.exe);
    child = served.child;
    expect(served.output()).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const failed: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`http://127.0.0.1:${served.port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const script = await page.locator("script[type=module]").getAttribute("src");
    expect((await fetch(`http://127.0.0.1:${served.port}${script}`)).status).toBe(200);
    expect(failed.filter((f) => !f.includes("favicon"))).toEqual([]);
    const after = readdirSync(e.folder).filter((n) => n !== ".git" && n !== ".werk");
    expect(after).toEqual(["werk"]);
    expect(readdirSync(e.folder).filter((n) => !["werk", ".git", ".werk"].includes(n))).toEqual([]);
  } finally {
    child?.kill("SIGTERM");
    rmSync(e.root, { recursive: true, force: true });
  }
});

test("49.3 the help of the executable lists every command", async () => {
  const e = emptyFolder();
  try {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: e.folder, env: e.env });
    const help = spawnSync(e.exe, ["help"], { cwd: e.folder, env: e.env, encoding: "utf8" });
    expect(help.status).toBe(0);
    const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: ROOT, encoding: "utf8" });
    const names = (text: string) => text.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    expect(names(help.stdout).length).toBeGreaterThan(10);
    expect(names(help.stdout)).toEqual(names(checkout.stdout));
    const shown = spawnSync(e.exe, ["find"], { cwd: e.folder, env: e.env, encoding: "utf8" });
    expect(shown.status).toBe(0);
    expect(shown.stdout + shown.stderr).not.toMatch(/ENOENT|no such file|missing/i);
  } finally {
    rmSync(e.root, { recursive: true, force: true });
  }
});

const say = (text: string) => ({ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text }] } } });

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(120_000);
  const e = emptyFolder();
  let child: ChildProcess | undefined;
  try {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: e.folder, env: e.env });
    mkdirSync(join(e.folder, ".werk"));
    const scriptPath = join(e.root, "script.json");
    writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[say("The command worked.")]] } } }));
    const env = { ...e.env, PATH: [FAKE_DIR, e.env.PATH].join(delimiter), WERK_FAKE_SCRIPT: scriptPath, WERK_OPEN: "true" };
    const served = await serveExe(env, e.folder, e.exe);
    child = served.child;
    await page.goto(`http://127.0.0.1:${served.port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Show the map");
    await composer.press("Enter");
    await expect(page.getByText("The command worked.")).toBeVisible();
    const records = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const launch = records.find((r) => r.kind === "launch");
    const args: string[] = launch.args;
    const text = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(text).toContain(`"${e.exe}"`);
    expect(text).not.toMatch(/src\/cli\.ts/);
    expect(text).not.toMatch(/"[^"]*\/bun"/);
    // The command that the instructions name works.
    const run = spawnSync("sh", ["-c", `"${e.exe}" find`], { cwd: e.folder, env: e.env, encoding: "utf8" });
    expect(run.status).toBe(0);
  } finally {
    child?.kill("SIGTERM");
    rmSync(e.root, { recursive: true, force: true });
  }
});
