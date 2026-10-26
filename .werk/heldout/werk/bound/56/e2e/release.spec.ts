import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_DIR } from "../../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..", "..");
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

test.describe.configure({ mode: "serial" });

let root: string;
let out: string;
let buildStatus: { status: number | null; stderr: string };
test.beforeAll(() => {
  test.setTimeout(400_000);
  root = mkdtempSync(join(tmpdir(), "werk-heldout-release-"));
  out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: REPO, encoding: "utf8", timeout: 380_000 });
  buildStatus = { status: built.status, stderr: built.stderr };
});
test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(REPO, "dist"), { recursive: true, force: true });
});

test("49.1 the release build makes four executables with checksums", async () => {
  expect(buildStatus.status, buildStatus.stderr).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
  }
});

/** An empty project folder that holds only a copy of the executable for this machine. */
function emptyFolder() {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-empty-"));
  const exeDir = mkdtempSync(join(tmpdir(), "werk-heldout-exe-"));
  const exe = join(exeDir, "werk");
  copyFileSync(join(out, `werk-${HERE}`), exe);
  spawnSync("chmod", ["+x", exe]);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return { dir, exe, exeDir };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  const { dir, exe, exeDir } = emptyFolder();
  const home = mkdtempSync(join(tmpdir(), "werk-heldout-home-"));
  let child: ChildProcess | undefined;
  try {
    const before = readdirSync(dir).sort();
    const port = await freePort();
    let output = "";
    // A path with no Bun on it: the executable carries its own runtime.
    child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env: { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "w"), WERK_OPEN: "true" } });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
    expect(output).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
    const failures: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(failures.filter((f) => !f.includes("favicon"))).toEqual([]);
    const after = readdirSync(dir).sort();
    expect(after.filter((n) => !before.includes(n) && n !== ".werk")).toEqual([]);
    expect(readdirSync(exeDir)).toEqual(["werk"]);
  } finally {
    child?.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
    rmSync(exeDir, { recursive: true, force: true });
  }
});

test("49.3 the help of the executable lists every command", async () => {
  const { dir, exe, exeDir } = emptyFolder();
  try {
    const env = { PATH: "/usr/bin:/bin", HOME: dir };
    const help = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
    expect(help.status).toBe(0);
    const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8", env: { ...process.env, WERK_HOME: dir } });
    const names = (text: string) => text.split("\n").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]).sort();
    expect(names(help.stdout).length).toBeGreaterThan(10);
    expect(names(help.stdout)).toEqual(names(checkout.stdout));
    const show = spawnSync(exe, ["search"], { cwd: dir, env, encoding: "utf8" });
    expect(show.status).toBe(0);
    expect(`${show.stdout}${show.stderr}`).not.toMatch(/ENOENT|no such file|not found|cannot find/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(exeDir, { recursive: true, force: true });
  }
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(120_000);
  const { dir, exe, exeDir } = emptyFolder();
  const home = mkdtempSync(join(tmpdir(), "werk-heldout-home-"));
  const scriptPath = join(home, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Worked" }] } } }]] } } }));
  let child: ChildProcess | undefined;
  try {
    const port = await freePort();
    let output = "";
    child = spawn(exe, ["serve", "--port", String(port)], {
      cwd: dir,
      env: { PATH: `${FAKE_DIR}:${dirname(spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim())}:/usr/bin:/bin`, HOME: home, WERK_HOME: join(home, "w"), WERK_OPEN: "true", WERK_FAKE_SCRIPT: scriptPath },
    });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("show the map with werk");
    await composer.press("Enter");
    try {
      await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Worked")).toBeVisible({ timeout: 20_000 });
    } catch (error) {
      const launches = existsSync(`${scriptPath}.launches.jsonl`) ? readFileSync(`${scriptPath}.launches.jsonl`, "utf8") : "(none)";
      throw new Error(`${(error as Error).message}\nSERVER OUTPUT:\n${output}\nLAUNCHES:\n${launches}\nPAGE:\n${(await page.locator("body").innerText()).slice(0, 800)}`);
    }
    const records = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const launch = records.find((r) => r.kind === "launch");
    const joined = (launch.args as string[]).join("\n");
    expect(joined).toContain(exe);
    expect(joined).not.toMatch(/src\/cli\.ts/);
    expect(joined).not.toMatch(/"?\bbun\b"? .*cli/);
  } finally {
    child?.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
    rmSync(exeDir, { recursive: true, force: true });
  }
});
