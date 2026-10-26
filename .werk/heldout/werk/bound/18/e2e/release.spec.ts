import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { card } from "../events.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { FAKE_DIR } from "../../src/test-env/env.ts";

const REPO = resolve(import.meta.dirname, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const HERE = `${process.platform}-${process.arch}`;

test.describe.configure({ mode: "serial" });

let root: string;
let copy: string;
let release: string;
let built: { status: number | null; output: string };

const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

test.beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-release-")));
  copy = join(root, "copy");
  // The build runs on a copy, so the checkout gets no output folder.
  const sync = spawnSync("rsync", ["-a", "--exclude", ".git", "--exclude", "coverage", "--exclude", ".werk-heldout", `${REPO}/`, `${copy}/`]);
  if (sync.status !== 0) throw new Error(`rsync failed: ${sync.stderr}`);
  const run = spawnSync("make", ["release-build"], { cwd: copy, encoding: "utf8" });
  built = { status: run.status, output: `${run.stdout}${run.stderr}` };
  release = join(copy, "dist", "release");
});
test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A new empty project folder with the one executable and a git repository. */
function emptyProject(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  copyFileSync(join(release, `werk-${HERE}`), join(dir, "werk"));
  spawnSync("chmod", ["+x", join(dir, "werk")]);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const home = join(root, `${name}-home`);
  mkdirSync(home);
  // No Bun on this search list.
  const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "werk"), WERK_OPEN: "true" };
  return { dir, exe: join(dir, "werk"), env };
}

test("49.1 the release build makes four executables with checksums", () => {
  expect(built.status, built.output).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(release, `werk-${platform}`);
    expect(existsSync(file), `missing ${file}`).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum), `missing ${sum}`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8").split(/\s+/)[0]).toBe(digest);
  }
});

async function startExe(p: ReturnType<typeof emptyProject>, port: number) {
  let output = "";
  const child: ChildProcess = spawn(p.exe, ["serve", "--port", String(port)], { cwd: p.dir, env: p.env });
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (c) => { output += String(c); });
  return { child, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const which = spawnSync("which", ["bun"], { env: { PATH: "/usr/bin:/bin" } });
  expect(which.status).not.toBe(0);
  const p = emptyProject("empty-serve");
  const before = readdirSync(p.dir).sort();
  const port = await freePort();
  const run = await startExe(p, port);
  try {
    await expect.poll(run.output, { timeout: 30_000 }).toContain("werk: serving on");
    expect(run.output()).toContain(`http://127.0.0.1:${port}`);
    const errors: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible();
    expect(errors).toEqual([]);
    const after = readdirSync(p.dir).sort();
    const added = after.filter((n) => !before.includes(n) && n !== ".werk");
    expect(added).toEqual([]);
  } finally {
    run.child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", () => {
  const p = emptyProject("empty-help");
  const help = spawnSync(p.exe, ["help"], { cwd: p.dir, env: p.env, encoding: "utf8" });
  expect(help.status).toBe(0);
  const checkout = spawnSync("bun", [join(REPO, "src", "cli.ts"), "help"], { cwd: p.dir, encoding: "utf8" });
  expect(checkout.status).toBe(0);
  const verbs = (text: string) => text.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(verbs(help.stdout).length).toBeGreaterThan(10);
  expect(verbs(help.stdout)).toEqual(verbs(checkout.stdout));
  const search = spawnSync(p.exe, ["search"], { cwd: p.dir, env: p.env, encoding: "utf8" });
  expect(search.status).toBe(0);
  expect(`${search.stdout}${search.stderr}`).not.toMatch(/no such file|missing|not found|ENOENT/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  const p = emptyProject("empty-agent");
  mkdirSync(join(p.dir, ".werk"));
  const log = join(p.dir, ".werk", "log.jsonl");
  const events = card("root", { title: "Root" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(log, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  const script: Script = {
    roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } },
  };
  const scriptPath = join(root, "agent-script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const env = { ...p.env, PATH: `${FAKE_DIR}:${process.env.PATH}`, WERK_FAKE_SCRIPT: scriptPath };
  const port = await freePort();
  let output = "";
  const child = spawn(p.exe, ["serve", "--port", String(port)], { cwd: p.dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toContain("werk: serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Add a card for me");
    await box.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("ok")).toBeVisible();
    const records = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const launch = records.find((r) => r.kind === "launch");
    const prompt = JSON.stringify(launch.args);
    const exe = realpathSync(p.exe);
    expect(prompt).toContain(exe);
    expect(prompt).not.toMatch(/bun src|src\/cli\.ts|\\"bun\\"/);
    expect(prompt).not.toContain("`werk add");
  } finally {
    child.kill("SIGTERM");
  }
});
