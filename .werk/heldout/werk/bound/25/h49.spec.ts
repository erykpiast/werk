import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readRecords } from "../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const CHECKOUT = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

test.describe.configure({ mode: "serial" });

let root = "";
let out = "";
let build: { status: number | null; output: string } = { status: null, output: "" };

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.beforeAll(() => {
  // The build runs in a copy of the checkout, so it writes nothing into the checkout.
  root = mkdtempSync(join(tmpdir(), "werk-heldout-49-"));
  const copy = join(root, "werk");
  out = join(root, "out");
  const r = spawnSync("rsync", ["-a", "--exclude", "/.git", "--exclude", "/.werk-heldout", "--exclude", "/dist", `${CHECKOUT}/`, `${copy}/`]);
  if (r.status !== 0) throw new Error(`copy failed: ${r.stderr}`);
  const built = spawnSync("make", ["release-build"], { cwd: copy, encoding: "utf8", timeout: 400_000 });
  build = { status: built.status, output: `${built.stdout}${built.stderr}` };
  // `make release-build` writes to the copy's default folder; find it.
  for (const guess of ["dist/release", "dist", "release", "out"]) {
    if (existsSync(join(copy, guess, `werk-${here}`))) out = join(copy, guess);
  }
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const emptyFolder = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir);
  copyFileSync(join(out, `werk-${here}`), join(dir, "werk"));
  spawnSync("chmod", ["+x", join(dir, "werk")]);
  // werk takes a folder as a project only with a git repository; the folder holds nothing else of werk.
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return dir;
};
const bareEnv = (extra: Record<string, string> = {}) => {
  const home = join(root, `home-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  return { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "werk"), WERK_OPEN: "true", ...extra };
};

test("49.1 the release build makes four executables with checksums", async () => {
  expect(build.status, build.output).toBe(0);
  const files = readdirSync(out);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(files, `executable for ${platform}`).toContain(`werk-${platform}`);
    const sums = files.filter((f) => f.startsWith(`werk-${platform}.`));
    expect(sums.length, `checksum beside ${platform}`).toBe(1);
    const text = readFileSync(join(out, sums[0]!), "utf8");
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(text).toContain(digest);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  expect(build.status, build.output).toBe(0);
  const dir = emptyFolder("empty-2");
  const before = readdirSync(dir).sort();
  const port = await freePort();
  let output = "";
  const child = spawn(join(dir, "werk"), ["serve", "--port", String(port)], { cwd: dir, env: bareEnv() });
  try {
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/https?:\/\/\S+/);
    const address = /https?:\/\/[^\s]+/.exec(output)![0]!;
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failed.push(String(e)));
    await page.goto(address);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/not found|missing|cannot find/i);
    await page.waitForLoadState("networkidle");
    expect(failed.filter((f) => !f.includes("favicon"))).toEqual([]);
    const after = readdirSync(dir).sort();
    // `.werk` is the project's own map store; no extracted program files may appear.
    const added = after.filter((n) => !before.includes(n));
    expect(added.filter((n) => n !== ".werk")).toEqual([]);
    if (added.includes(".werk")) {
      expect(readdirSync(join(dir, ".werk")).filter((f) => !/^(log|board|fold-ms)\.jsonl$|^chats$|^attachments$|^serve\.lock$/.test(f))).toEqual([]);
    }
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", async () => {
  expect(build.status, build.output).toBe(0);
  const dir = emptyFolder("empty-3");
  const exe = spawnSync(join(dir, "werk"), ["help"], { cwd: dir, env: bareEnv(), encoding: "utf8" });
  expect(exe.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: CHECKOUT, encoding: "utf8", env: { ...process.env, WERK_HOME: join(root, "h") } });
  const verbs = (text: string) => text.split("\n").filter((l) => /^\s+[a-z-]+\s{2}/.test(l)).map((l) => l.trim().split(/\s+/)[0]!);
  const wanted = verbs(checkout.stdout);
  expect(wanted.length).toBeGreaterThan(10);
  const got = verbs(exe.stdout);
  expect(got).not.toHaveLength(0);
  for (const verb of wanted) expect(got).toContain(verb);
  const run = spawnSync(join(dir, "werk"), ["find"], { cwd: dir, env: bareEnv(), encoding: "utf8" });
  expect(`${run.stdout}${run.stderr}`).not.toMatch(/ENOENT|no such file|not found|missing/i);
  expect(run.status).toBe(0);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  expect(build.status, build.output).toBe(0);
  const dir = emptyFolder("project-4");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const exe = join(dir, "werk");
  const scriptPath = join(root, "script-4.json");
  const say = (id: string, text: string) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }] } } });
  const tool = (id: string, command: string) => ({ event: { type: "assistant", message: { id, content: [{ type: "tool_use", id: `u-${id}`, name: "Bash", input: { command } }] } } });
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[tool("t1", `"${exe}" help`), say("m1", "The werk command worked")]] } } }));
  const port = await freePort();
  let output = "";
  const env = { ...cleanEnv(process.env), HOME: bareEnv().HOME, WERK_HOME: join(root, "home-4"), WERK_OPEN: "true", WERK_FAKE_SCRIPT: scriptPath };
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  try {
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/https?:\/\/\S+/);
    const address = /https?:\/\/[^\s]+/.exec(output)![0]!;
    await page.goto(address);
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill("Run a werk command");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("The werk command worked")).toBeVisible({ timeout: 20_000 });
    const launch = readRecords(`${scriptPath}.launches.jsonl`).find((r) => r.kind === "launch");
    const args = (launch as { args: string[] }).args;
    // The instructions and the subagent definitions are what name the werk command; the tool allow list is not.
    const named_ = [args[args.indexOf("--append-system-prompt") + 1], args[args.indexOf("--agents") + 1]].join("\n");
    const prompt = JSON.stringify(named_);
    expect(named_).toContain(exe);
    expect(named_).not.toMatch(/cli\.ts|\bbun\b/i);
    const shown = (await chat.locator("[data-slot=tool-run]").first().textContent()) ?? "";
    expect(shown).toContain(exe);
    expect(shown).not.toMatch(/cli\.ts|\bbun\b/i);
    // The command the instructions name runs and works.
    const named = /`("[^`"]*werk[^`"]*") help`/.exec(prompt.replaceAll("\\\"", '"').replaceAll("\\n", "\n")) ?? /`([^`]*) help`/.exec(prompt.replaceAll("\\\"", '"'));
    expect(named).not.toBeNull();
    const ran = spawnSync("sh", ["-c", `${named![1]} help`], { cwd: dir, encoding: "utf8", env: bareEnv() });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("werk <verb>");
  } finally {
    child.kill("SIGTERM");
  }
});
