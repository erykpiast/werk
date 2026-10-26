import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { FAKE_DIR } from "../../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..", "..");
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
let exeDir = "";
let exe = "";
let project = "";
const here = `${process.platform}-${process.arch}`;

test.beforeAll(() => {
  test.setTimeout(600_000);
  root = mkdtempSync(join(tmpdir(), "werk-held-rel-"));
  out = join(root, "out");
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

test("49.1 the release build makes four executables with checksums", async () => {
  test.setTimeout(600_000);
  const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: REPO, encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), `${file} exists`).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8")).toContain(digest);
  }
});

function startExe(args: string[], extraEnv: Record<string, string> = {}): ChildProcess {
  return spawn(exe, args, {
    cwd: project,
    env: { PATH: `${FAKE_DIR}:/usr/bin:/bin`, HOME: join(root, "home"), WERK_HOME: join(root, "werk-home"), WERK_OPEN: "true", ...extraEnv },
  });
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  test.setTimeout(180_000);
  exeDir = join(root, "empty-exe");
  project = join(root, "empty-project");
  mkdirSync(exeDir);
  mkdirSync(project);
  mkdirSync(join(root, "home"), { recursive: true });
  spawnSync("cp", [join(out, `werk-${here}`), join(exeDir, "werk")]);
  exe = join(exeDir, "werk");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: project });
  const before = readdirSync(exeDir);
  const port = await freePort();
  let output = "";
  const child = startExe(["serve", "--port", String(port)]);
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
    expect(output).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
    const failures: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
    page.on("pageerror", (e) => failures.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    expect(failures.filter((f) => !/favicon/.test(f))).toEqual([]);
    expect(readdirSync(exeDir)).toEqual(before);
  } finally {
    child.kill("SIGTERM");
  }
});

test("49.3 the help of the executable lists every command", async () => {
  const help = spawnSync(exe, ["help"], { cwd: project, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: join(root, "home"), WERK_HOME: join(root, "werk-home") } });
  expect(help.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8" });
  expect(checkout.status).toBe(0);
  const names = (s: string) => s.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).sort();
  expect(names(help.stdout).length).toBeGreaterThan(10);
  expect(names(help.stdout)).toEqual(names(checkout.stdout));
  const added = spawnSync(exe, ["add", "x", "--title", "From the executable"], { cwd: project, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: join(root, "home") } });
  expect(added.status, added.stderr).toBe(0);
  expect(added.stderr).not.toMatch(/no such file|ENOENT|missing/i);
  const shown = spawnSync(exe, ["show", "x"], { cwd: project, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: join(root, "home") } });
  expect(shown.stdout).toContain("From the executable");
  expect(shown.stderr).not.toMatch(/no such file|ENOENT|missing/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  test.setTimeout(180_000);
  const script = join(root, "script.json");
  writeFileSync(script, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done" }] } } }]] } } }));
  const port = await freePort();
  let output = "";
  // The fake agent is a Bun script, so Bun's folder is on the path for the agent only.
  const bunDir = dirname(spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim());
  const child = startExe(["serve", "--port", String(port)], { WERK_FAKE_SCRIPT: script, PATH: `${FAKE_DIR}:${bunDir}:/usr/bin:/bin` });
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (c) => { output += String(c); });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Add a card with the werk command");
    await box.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Done")).toBeVisible({ timeout: 30_000 });
    const launches = readRecords(logPathFor(script)).flatMap((r) => (r.kind === "launch" ? [r.args] : []));
    expect(launches.length).toBeGreaterThan(0);
    const args = launches[0] as string[];
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt.length).toBeGreaterThan(100);
    
    // the agent is told to run werk through the path of the executable that runs
    expect(prompt).toContain(`"${realpathSync(exe)}"`);
    expect(prompt).not.toMatch(/\bbun\b/i);
    expect(prompt).not.toContain("cli.ts");
    expect(args.join(" ")).not.toContain("cli.ts");
    // the command that the instructions name works when it runs as the agent would run it
    const run = spawnSync("sh", ["-c", `"${exe}" show`], { cwd: project, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: join(root, "home") } });
    expect(run.stderr).not.toMatch(/no such file|ENOENT|not found/i);
  } finally {
    child.kill("SIGTERM");
  }
});
