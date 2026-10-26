import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;


let root = "";
let copy = "";
let out = "";
let buildResult: { status: number | null; text: string } = { status: null, text: "" };

test.beforeAll(() => {
  test.setTimeout(300_000);
  root = mkdtempSync(join(tmpdir(), "heldout-49-"));
  // The build runs on a copy, so the checkout gets no dist folder.
  copy = join(root, "app");
  const rs = spawnSync("rsync", ["-a", "--exclude", ".git", "--exclude", ".werk-heldout", `${REPO}/`, `${copy}/`]);
  expect(rs.status).toBe(0);
  out = join(root, "out");
  const built = spawnSync("make", ["release-build"], { cwd: copy, encoding: "utf8" });
  buildResult = { status: built.status, text: built.stderr + built.stdout };
  const release = join(copy, "dist", "release");
  if (existsSync(release)) {
    mkdirSync(out);
    for (const n of readdirSync(release)) {
      if (n.startsWith("werk-")) copyFileSync(join(release, n), join(out, n));
    }
  }
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** A new empty folder with only the executable in it, and the environment a person without Bun has. */
function emptyFolder(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const exe = join(dir, "werk");
  copyFileSync(join(out, `werk-${here}`), exe);
  const home = join(root, `${name}-home`);
  mkdirSync(home);
  return { dir, exe, home };
}

test("49.1 the release build makes four executables with checksums", () => {
  expect(buildResult.status, buildResult.text).toBe(0);
  const release = join(copy, "dist", "release");
  const names = readdirSync(release);
  for (const platform of PLATFORMS) {
    const file = join(release, `werk-${platform}`);
    expect(existsSync(file), `executable for ${platform}`).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum), `checksum for ${platform}`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8")).toContain(digest);
  }
  expect(names.filter((n) => /^werk-/.test(n) && !n.endsWith(".sha256"))).toHaveLength(4);
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const { dir, exe, home } = emptyFolder("empty-2");
  const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "w") };
  const port = await freePort();
  let output = "";
  const first = spawnSync(exe, ["serve", "--port", String(port)], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  let needGit = false;
  if (first.status !== 0 && /git/.test(first.stderr + first.stdout)) {
    needGit = true;
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  }
  let child: ChildProcess | undefined;
  try {
    child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().includes("/api/")) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    expect(failed).toEqual([]);
    expect(await page.content()).not.toMatch(/ENOENT|no such file|missing/i);
    const entries = readdirSync(dir).filter((n) => !["werk", ".git"].includes(n));
    // the project's own map folder is the only thing the executable makes
    expect(entries.filter((n) => n !== ".werk")).toEqual([]);
    expect(needGit, "the executable started in a new empty folder, with no git init").toBe(false);
    test.info().annotations.push({ type: "note", description: `git init needed after refusal: ${needGit}; entries: ${entries.join(",")}` });
  } finally {
    child?.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", () => {
  const { dir, exe, home } = emptyFolder("empty-3");
  const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "w") };
  const exeHelp = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
  expect(exeHelp.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8" });
  expect(checkout.stdout.trim().length).toBeGreaterThan(0);
  expect(exeHelp.stdout).toBe(checkout.stdout);
  const add = spawnSync(exe, ["add", "x", "--title", "X"], { cwd: dir, env, encoding: "utf8" });
  expect(add.status, add.stderr).toBe(0);
  const show = spawnSync(exe, ["show", "x"], { cwd: dir, env, encoding: "utf8" });
  expect(show.status, show.stderr).toBe(0);
  expect(show.stdout + show.stderr).not.toMatch(/no such file|missing|ENOENT/i);
});

test("49.4 the agent is told to run werk through the executable that runs", async ({ page }) => {
  const { dir, exe, home } = emptyFolder("empty-4");
  const base = cleanEnv(process.env);
  const env: Record<string, string> = { ...base, HOME: home, WERK_HOME: join(home, "w"), WERK_OPEN: "true" };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const scriptPath = join(root, "script-4.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "The help worked" }] } } }]] } },
    }),
  );
  env.WERK_FAKE_SCRIPT = scriptPath;
  const port = await freePort();
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on/);
    await page.goto(`http://127.0.0.1:${port}/`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Run the werk help command");
    await composer.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("The help worked")).toBeVisible();
    const launch = readRecords(logPathFor(scriptPath)).find((r) => r.kind === "launch");
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
    expect(prompt).toMatch(/`"[^"]*\/empty-4\/werk" help`/);
    expect(prompt).not.toMatch(/src\/cli\.ts/);
    expect(prompt).not.toMatch(/"[^"]*\/bun" /);
  } finally {
    child.kill("SIGTERM");
  }
});
