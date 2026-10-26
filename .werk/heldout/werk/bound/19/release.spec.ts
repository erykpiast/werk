import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { served } from "./server.ts";

const REPO = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

test.describe.configure({ mode: "serial" });

let root = "";
let out = "";
let exe = "";
let buildResult: { status: number | null; stderr: string; stdout: string } = { status: null, stderr: "", stdout: "" };

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test.beforeAll(async () => {
  test.setTimeout(600_000);
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-rel-")));
  // The build runs on a copy of the checkout, so its output never lands in the checkout.
  const copy = join(root, "checkout");
  const tracked = spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const f of tracked) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(copy, f), { recursive: true, verbatimSymlinks: true });
  symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
  out = join(root, "out");
  const r = spawnSync("bun", ["src/release/build.ts", out], { cwd: copy, encoding: "utf8" });
  buildResult = { status: r.status, stderr: r.stderr, stdout: r.stdout };
  exe = join(out, `werk-${here}`);
});

test.afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test("49.1 the release build makes four executables with checksums", async () => {
  expect(buildResult.status, buildResult.stderr.slice(-2000)).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum), sum).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8")).toContain(digest);
  }
});

function emptyFolder(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const exeCopy = join(dir, "werk");
  copyFileSync(exe, exeCopy);
  spawnSync("chmod", ["+x", exeCopy]);
  return { dir, exeCopy };
}

const bareEnv = (home: string) => ({ PATH: "/usr/bin:/bin", HOME: home });

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const { dir, exeCopy } = emptyFolder("empty-serve");
  const project = join(root, "project-serve");
  mkdirSync(project);
  const home = join(root, "home-serve");
  mkdirSync(home);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: project, env: bareEnv(home) });
  const before = readdirSync(dir);
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(exeCopy, ["serve", "--port", String(port)], {
    cwd: project,
    env: { ...bareEnv(home), WERK_HOME: join(root, "werk-home-serve"), WERK_OPEN: "true" },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toMatch(/serving on http/);
    const address = /(http:\/\/\S+)/.exec(output)?.[1] as string;
    expect(address).toContain(String(port));
    const errors: string[] = [];
    page.on("response", (res) => { if (res.status() >= 400 && res.url().startsWith(`http://127.0.0.1:${port}`)) errors.push(`${res.status()} ${res.url()}`); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/not found|ENOENT|no such file/i);
    await page.waitForLoadState("networkidle");
    expect(errors.filter((e) => !/\/api\//.test(e))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before.sort());
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", async () => {
  const { dir, exeCopy } = emptyFolder("empty-help");
  const home = join(root, "home-help");
  mkdirSync(home);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: bareEnv(home) });
  const helpExe = spawnSync(exeCopy, ["help"], { cwd: dir, env: bareEnv(home), encoding: "utf8" });
  expect(helpExe.status).toBe(0);
  const helpSrc = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8" });
  expect(helpSrc.status).toBe(0);
  const lines = helpExe.stdout.split("\n").filter((l) => /^\s{2}\S/.test(l));
  expect(lines.length).toBeGreaterThan(10);
  expect(helpExe.stdout).toBe(helpSrc.stdout);
  const run = spawnSync(exeCopy, ["find"], { cwd: dir, env: bareEnv(home), encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout + run.stderr).not.toMatch(/missing|no such file|ENOENT|not found/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  const { exeCopy } = emptyFolder("empty-agent");
  const s = await served({
    exe: exeCopy,
    empty: true,
    env: { PATH: `${FAKE_DIR}:${dirname(spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim())}:/usr/bin:/bin` },
    script: {
      roles: {
        chat: {
          replies: [
            [
              { event: { type: "assistant", message: { id: "t1", content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command: `${exeCopy} help` } }] } } },
              { event: { type: "assistant", message: { id: "t2", content: [{ type: "text", text: "The werk command worked." }] } } },
            ],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Run a werk command");
    await box.press("Enter");
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("The werk command worked.");
    const launch = s.launches().find((r) => r.kind === "launch");
    const args = (launch && launch.kind === "launch" ? launch.args : []).join("\n");
    expect(args).toContain(`"${exeCopy}" help`);
    expect(args).not.toMatch(/bun\s+(run\s+)?\S*cli\.ts|src\/cli\.ts/);
    const shown = (await page.getByRole("log", { name: "Conversation" }).locator("details").first().textContent()) ?? "";
    expect(shown).toContain(exeCopy);
    expect(shown).not.toMatch(/\bbun\b|\.ts\b/);
  } finally {
    await s.dispose();
  }
});
