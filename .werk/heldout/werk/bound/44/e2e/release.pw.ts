import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { copyRepo, ROOT } from "../lib.ts";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

test.describe.configure({ mode: "serial" });

let copy: string;
let out: string;
let scratch: string;
let buildResult: { status: number | null; stderr: string };
const children: ChildProcess[] = [];

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.beforeAll(() => {
  test.setTimeout(600_000);
  copy = copyRepo();
  out = join(copy, "out");
  scratch = mkdtempSync(join(tmpdir(), "werk-heldout-rel-"));
  // the release build, run in a copy of the checkout so the checkout keeps no build output
  buildResult = spawnSync("bun", ["src/release/build.ts", out], { cwd: copy, encoding: "utf8" });
});

test.afterAll(() => {
  for (const c of children) c.kill("SIGTERM");
  rmSync(copy, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

/** Copies only the executable into a new empty git folder. */
function emptyFolderWithExe() {
  const folder = mkdtempSync(join(scratch, "empty-"));
  const home = mkdtempSync(join(scratch, "home-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
  const exe = join(folder, "werk");
  copyFileSync(join(out, `werk-${here}`), exe);
  spawnSync("chmod", ["+x", exe]);
  // no Bun on the path, no source folder
  const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "werk") };
  return { folder, exe, env };
}

test("49.1 the release build makes four executables with checksums", async () => {
  expect(buildResult.status, buildResult.stderr).toBe(0);
  for (const p of PLATFORMS) {
    const file = join(out, `werk-${p}`);
    expect(existsSync(file), `${file} missing`).toBe(true);
    expect(existsSync(`${file}.sha256`), `${file}.sha256 missing`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0]).toBe(digest);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  const { folder, exe, env } = emptyFolderWithExe();
  const before = readdirSync(folder).sort();
  const port = await freePort();
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: folder, env });
  children.push(child);
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator("#screen")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  child.kill("SIGTERM");
  expect(readdirSync(folder).sort().filter((n) => n !== ".werk")).toEqual(before.filter((n) => n !== ".werk"));
});

test("49.3 the help of the executable lists every command", async () => {
  const { folder, exe, env } = emptyFolderWithExe();
  const helpExe = spawnSync(exe, ["help"], { cwd: folder, env, encoding: "utf8" });
  expect(helpExe.status).toBe(0);
  const helpCheckout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: ROOT, encoding: "utf8" });
  expect(helpCheckout.status).toBe(0);
  const names = (text: string) =>
    text
      .split("\n")
      .map((l) => /^\s{2}([a-z-]+)\s{2,}/.exec(l)?.[1])
      .filter(Boolean);
  expect(names(helpExe.stdout).length).toBeGreaterThan(10);
  expect(names(helpExe.stdout)).toEqual(names(helpCheckout.stdout));
  const run = spawnSync(exe, ["search"], { cwd: folder, env, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(`${run.stdout}${run.stderr}`).not.toMatch(/no such file|not found|ENOENT|missing/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(120_000);
  const { folder, exe, env } = emptyFolderWithExe();
  // The fake agent plays the agent. It is first on the path, as in every test.
  const fakeDir = join(ROOT, "fake");
  const script = join(scratch, "script-494.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    script,
    JSON.stringify({
      roles: {
        chat: {
          replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]],
        },
      },
    }),
  );
  const port = await freePort();
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], {
    cwd: folder,
    env: { ...env, PATH: `${fakeDir}:${process.env.PATH}`, WERK_FAKE_SCRIPT: script, WERK_OPEN: "true" },
  });
  children.push(child);
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
  await page.goto(`http://127.0.0.1:${port}/`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("add a card with werk");
  await composer.press("Enter");
  await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("ok")).toBeVisible();
  const { readRecords, logPathFor } = await import("../../src/fake-agent/launch-log.ts");
  const records = readRecords(logPathFor(script));
  const launch = records.find((r) => r.kind === "launch");
  expect(launch).toBeDefined();
  const args = ((launch as { args: string[] }).args ?? []).join("\n");
  const exePath = (await import("node:fs")).realpathSync(join(folder, "werk"));
  expect(args).toContain(`"${exePath}" help`);
  expect(args).not.toMatch(/\bbun\b[^\n]*cli\.ts|src\/cli\.ts|\.bun\//);
  expect(args).not.toMatch(/"[^"\n]*\bbun"\s+"[^"\n]*cli\.ts"/);
});
