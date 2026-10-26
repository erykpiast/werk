import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, copyFileSync, writeFileSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../../src/test-env/env.ts";
import { chatScript, chat, composer, launched, say, serve, ROOT_EVENTS } from "./helpers.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

test.describe.configure({ mode: "serial" });

let root: string;
let copy: string;
let out: string;
const here = `${process.platform}-${process.arch}`;
const exeName = `werk-${here}`;

const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/** A checkout copy, so the build output never lands in the checkout itself. */
function copyCheckout(dest: string) {
  const files = spawnSync("git", ["ls-files"], { cwd: CHECKOUT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const f of files) {
    if (f.startsWith(".werk-heldout/")) continue;
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(join(CHECKOUT, f), join(dest, f), { verbatimSymlinks: true });
  }
  symlinkSync(join(CHECKOUT, "node_modules"), join(dest, "node_modules"));
}

test.beforeAll(() => {
  test.setTimeout(300_000);
  root = mkdtempSync(join(tmpdir(), "heldout-49-"));
  copy = join(root, "repo");
  out = join(root, "out");
  copyCheckout(copy);
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const BARE_PATH = "/usr/bin:/bin";
let built: { status: number | null; stderr: string } | undefined;
const build = () => {
  if (!built) {
    const r = spawnSync("bun", ["src/release/build.ts", out], { cwd: copy, encoding: "utf8", timeout: 280_000 });
    built = { status: r.status, stderr: r.stderr };
  }
  return built;
};

test("49.1 the release build makes four executables with checksums", async () => {
  test.setTimeout(300_000);
  const r = build();
  expect(r.status, r.stderr).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    expect(existsSync(`${file}.sha256`), `${file}.sha256`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
  }
});

function emptyProject(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(out, exeName), join(dir, exeName));
  spawnSync("chmod", ["+x", join(dir, exeName)]);
  const home = join(root, `${name}-home`);
  mkdirSync(home, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return { dir, home, exe: join(dir, exeName) };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(120_000);
  expect(build().status).toBe(0);
  const { dir, home, exe } = emptyProject("p2");
  expect(existsSync("/usr/bin/bun") || existsSync("/bin/bun")).toBe(false);
  const before = readdirSync(dir).sort();
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(exe, ["serve", "--port", String(port)], {
    cwd: dir,
    env: { PATH: BARE_PATH, HOME: home, WERK_HOME: join(home, "werk"), WERK_OPEN: "true" },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const failed: string[] = [];
    page.on("response", (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible({ timeout: 15000 });
    expect(failed).toEqual([]);
    const after = readdirSync(dir).sort();
    expect(after.filter((n) => !before.includes(n) && n !== ".werk")).toEqual([]);
    // .werk is the project's own state folder (lock and log), not an unpacked copy of the app
    expect(readdirSync(join(dir, ".werk")).every((n) => /^(serve\.lock|fold-ms\.jsonl)$/.test(n))).toBe(true);
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", async () => {
  test.setTimeout(120_000);
  expect(build().status).toBe(0);
  const { dir, home, exe } = emptyProject("p3");
  const env = { PATH: BARE_PATH, HOME: home, WERK_HOME: join(home, "werk") };
  const exeHelp = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
  expect(exeHelp.status).toBe(0);
  const checkoutHelp = spawnSync("bun", [join(CHECKOUT, "src/cli.ts"), "help"], { cwd: dir, env: { ...cleanEnv(process.env), WERK_HOME: join(home, "w2") }, encoding: "utf8" });
  const verbsOf = (t: string) => t.split("\n").map((l) => /^\s{2}(\S+)\s/.exec(l)?.[1]).filter(Boolean);
  expect(verbsOf(exeHelp.stdout).length).toBeGreaterThan(10);
  expect(verbsOf(exeHelp.stdout)).toEqual(verbsOf(checkoutHelp.stdout));
  const run = spawnSync(exe, ["find"], { cwd: dir, env, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr + run.stdout).not.toMatch(/no such file|ENOENT|cannot find|missing/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(120_000);
  expect(build().status).toBe(0);
  const { dir, home, exe } = emptyProject("p4");
  const scriptPath = join(root, "script.json");
  writeFileSync(scriptPath, JSON.stringify(chatScript([say("m1", "It worked")])));
  const port = await freePort();
  let output = "";
  const env = { ...cleanEnv(process.env), WERK_HOME: join(home, "werk"), WERK_OPEN: "true", WERK_FAKE_SCRIPT: scriptPath };
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
    await page.goto(`http://127.0.0.1:${port}/`);
    await composer(page).fill("Add a card with werk");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("It worked")).toBeVisible({ timeout: 30000 });
    const { readRecords, logPathFor } = await import("../../src/fake-agent/launch-log.ts");
    const args = (readRecords(logPathFor(scriptPath)).find((r) => r.kind === "launch") as { args: string[] }).args;
    const prompt = args.join("\n");
    expect(prompt).toContain(realpathSync(exe));
    expect(prompt).toMatch(/werk-[a-z]+-[a-z0-9]+\\?"? help/);
    expect(prompt).not.toMatch(/\bbun\b[^\n]*src\/cli\.ts/);
    expect(prompt).not.toMatch(/`bun /);
    expect(prompt).not.toMatch(/src\/cli\.ts/);
    const ran = spawnSync(exe, ["help"], { cwd: dir, env: { PATH: BARE_PATH }, encoding: "utf8" });
    expect(ran.status).toBe(0);
  } finally {
    child.kill("SIGTERM");
  }
});
