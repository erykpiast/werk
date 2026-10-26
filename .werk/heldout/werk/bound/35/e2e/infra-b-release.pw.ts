import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const REPO = resolve(import.meta.dirname, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

test.describe.configure({ mode: "serial" });

let root: string;
let out: string;

const freePort = () =>
  new Promise<number>((r) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => r(port));
    });
  });

test.beforeAll(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), "heldout-rel-"));
  out = join(root, "out");
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

function emptyProject(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const exe = join(dir, `werk-${here}`);
  copyFileSync(join(out, `werk-${here}`), exe);
  spawnSync("chmod", ["+x", exe]);
  return { dir, exe };
}

async function serve(exe: string, dir: string, env: Record<string, string>) {
  const port = await freePort();
  let output = "";
  const child: ChildProcess = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
  return { child, port, output: () => output };
}

test("49.1 release build makes four executables with matching checksums", () => {
  const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: REPO, encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);
  for (const p of PLATFORMS) {
    const file = join(out, `werk-${p}`);
    expect(existsSync(file)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const sum = readFileSync(`${file}.sha256`, "utf8");
    expect(sum.split(/\s+/)[0]).toBe(digest);
    expect(sum).toContain(`werk-${p}`);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const { dir, exe } = emptyProject("empty2");
  // no bun, no checkout on the path
  const env = { PATH: "/usr/bin:/bin", HOME: join(root, "home2"), WERK_HOME: join(root, "wh2"), WERK_OPEN: "true" };
  mkdirSync(env.HOME);
  const before = readdirSync(dir).sort();
  const s = await serve(exe, dir, env);
  try {
    expect(s.output()).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`http://127.0.0.1:${s.port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(failed).toEqual([]);
    const after = readdirSync(dir).sort();
    // .werk is the project's own map folder that serving a project creates; it holds no werk program files.
    const added = after.filter((n) => !before.includes(n));
    expect(added.filter((n) => n !== ".werk")).toEqual([]);
    if (added.includes(".werk")) expect(readdirSync(join(dir, ".werk")).filter((n) => !/^(log\.jsonl|board\.jsonl|pipeline\.jsonl|fold-ms\.jsonl|serve\.lock)$/.test(n))).toEqual([]);
  } finally {
    s.child.kill("SIGTERM");
  }
});

test("49.3 help lists every command, and a command works", () => {
  const { dir, exe } = emptyProject("empty3");
  const env = { PATH: "/usr/bin:/bin", HOME: join(root, "home3"), WERK_HOME: join(root, "wh3") };
  mkdirSync(env.HOME);
  const help = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
  expect(help.status).toBe(0);
  const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8", env: { ...process.env, WERK_HOME: join(root, "wh3b") } });
  expect(checkout.stdout.trim().length).toBeGreaterThan(0);
  expect(help.stdout).toBe(checkout.stdout);
  const verbs = checkout.stdout.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(verbs.length).toBeGreaterThan(10);
  const added = spawnSync(exe, ["add", "one", "--title", "One"], { cwd: dir, env, encoding: "utf8" });
  expect(added.status, added.stderr).toBe(0);
  const shown = spawnSync(exe, ["show", "one"], { cwd: dir, env, encoding: "utf8" });
  expect(shown.status, shown.stderr).toBe(0);
  expect(shown.stdout).toContain("One");
  expect(shown.stderr).not.toMatch(/ENOENT|no such file|not found|missing/i);
});

test("49.4 the agent's instructions name the executable path, not Bun or a source file", async ({ page }) => {
  const { dir, exe } = emptyProject("empty4");
  const scriptPath = join(root, "script4.json");
  writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } } }));
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_HOME: join(root, "wh4"), WERK_FAKE_SCRIPT: scriptPath };
  const s = await serve(exe, dir, env);
  try {
    await page.goto(`http://127.0.0.1:${s.port}/p/${basename(dir)}`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Add a card with werk");
    await composer.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("ok")).toBeVisible();
    const launch = readRecords(logPathFor(scriptPath)).find((r) => r.kind === "launch");
    expect(launch).toBeTruthy();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
    expect(prompt).toContain(`"${exe}" add`);
    expect(prompt).not.toContain("cli.ts");
    expect(prompt).not.toMatch(/\bbun\b/);
    // the command the prompt names works
    const r = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
    expect(r.status).toBe(0);
  } finally {
    s.child.kill("SIGTERM");
  }
});
