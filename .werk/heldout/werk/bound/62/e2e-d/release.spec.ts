import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FAKE = join(CHECKOUT, "fake");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

let root: string;
let clone: string;
let out: string;

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "werk-ho-rel-"));
  clone = join(root, "clone");
  const c = spawnSync("git", ["clone", "-q", CHECKOUT, clone], { encoding: "utf8" });
  expect(c.status, c.stderr).toBe(0);
  const i = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: clone, encoding: "utf8" });
  expect(i.status, i.stderr).toBe(0);
  out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: clone, encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);
  mkdirSync(join(root, "home"), { recursive: true });
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const freePort = async () => {
  const { createServer } = await import("node:net");
  return new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
};

function emptyFolderWithExe(name: string, git: boolean) {
  const dir = join(root, name);
  mkdirSync(dir);
  cpSync(join(out, `werk-${here}`), join(dir, "werk"));
  if (git) spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return dir;
}
const exeEnv = (extra: Record<string, string> = {}) => ({ PATH: `/usr/bin:/bin`, HOME: join(root, "home"), WERK_HOME: join(root, "werk-home"), WERK_OPEN: "true", ...extra });

test("49.1 the release build makes four executables with matching checksums", () => {
  const names = readdirSync(out).filter((f) => f.startsWith("werk-") && !f.endsWith(".sha256")).sort();
  expect(names).toEqual(PLATFORMS.map((p) => `werk-${p}`).sort());
  for (const p of PLATFORMS) {
    const file = join(out, `werk-${p}`);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(`werk-${p}`);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const dir = emptyFolderWithExe("empty-a", false);
  const literal = spawnSync(join(dir, "werk"), ["serve", "--port", "0"], { cwd: dir, env: exeEnv(), encoding: "utf8", timeout: 10_000 });
  const literalOutput = `${literal.stdout}${literal.stderr}`;
  // Record what the literal step does: start in an empty folder.
  test.info().annotations.push({ type: "literal-start", description: `exit ${literal.status}: ${literalOutput.trim()}` });
  const gitDir = emptyFolderWithExe("empty-b", true);
  const before = readdirSync(gitDir).sort();
  const port = await freePort();
  let log = "";
  const child: ChildProcess = spawn(join(gitDir, "werk"), ["serve", "--port", String(port)], { cwd: gitDir, env: exeEnv() });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (d) => { log += String(d); });
  try {
    await expect.poll(() => log, { timeout: 30_000 }).toContain("serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    const missing: string[] = [];
    page.on("response", (r) => { if (r.status() >= 400) missing.push(r.url()); });
    await page.reload();
    await expect(page.locator("#screen")).toBeVisible();
    expect(missing).toEqual([]);
    const after = readdirSync(gitDir).sort();
    const added = after.filter((n) => !before.includes(n));
    test.info().annotations.push({ type: "added-next-to-exe", description: added.join(",") });
  } finally {
    child.kill("SIGTERM");
  }
  // The literal step: werk starts and prints the address in an empty folder.
  expect(literalOutput, "start in an empty folder (no git repository)").toContain("serving on");
});

const verbsOf = (text: string) => text.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);

test("49.3 the executable's help lists every command, and a command works", () => {
  const dir = emptyFolderWithExe("empty-c", false);
  const exe = spawnSync(join(dir, "werk"), ["help"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  expect(exe.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: clone, encoding: "utf8" });
  const a = verbsOf(exe.stdout);
  expect(a.length).toBeGreaterThan(10);
  expect(a).toEqual(verbsOf(checkout.stdout));
  const add = spawnSync(join(dir, "werk"), ["add", "first", "--title", "First card"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  expect(add.status, add.stderr).toBe(0);
  const show = spawnSync(join(dir, "werk"), ["show", "first"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  expect(show.status, show.stderr).toBe(0);
  expect(show.stdout + show.stderr).not.toMatch(/no such file|ENOENT|not found|missing/i);
  expect(show.stdout).toContain("First card");
});

test("49.4 the agent is told to run werk through the executable path", async ({ page }) => {
  const dir = emptyFolderWithExe("empty-d", true);
  const scriptPath = join(root, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done" }] } } }]] } } }));
  const port = await freePort();
  let log = "";
  const child = spawn(join(dir, "werk"), ["serve", "--port", String(port)], {
    cwd: dir,
    env: exeEnv({ PATH: `${FAKE}:/usr/bin:/bin`, WERK_FAKE_SCRIPT: scriptPath }),
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (d) => { log += String(d); });
  try {
    await expect.poll(() => log, { timeout: 30_000 }).toContain("serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Add a card with werk");
    await composer.press("Enter");
    await expect(page.getByText("Done")).toBeVisible({ timeout: 30_000 });
    const rec = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const launch = rec.find((r) => r.kind === "launch" && r.role === "chat");
    const args: string[] = launch.args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(join(dir, "werk").replace(/^\/private/, ""));
    expect(prompt).not.toMatch(/bun\b[^\n]*cli\.ts/);
    expect(prompt).not.toContain("src/cli.ts");
  } finally {
    child.kill("SIGTERM");
  }
});
