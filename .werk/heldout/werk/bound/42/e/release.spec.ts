import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { FAKE_DIR } from "../../src/test-env/env.ts";

const REPO = join(import.meta.dirname, "..", "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;

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
let buildResult: { status: number | null; stderr: string } = { status: -1, stderr: "not run" };
const children: ChildProcess[] = [];

test.beforeAll(() => {
  test.setTimeout(600_000);
  // The build writes its client output next to itself, so it runs in a copy of the app.
  root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-49-")));
  const app = join(root, "app");
  copyApp(app);
  out = join(root, "out");
  const built = spawnSync("bun", ["src/release/build.ts", out], {
    cwd: app,
    encoding: "utf8",
    timeout: 540_000,
  });
  buildResult = { status: built.status, stderr: built.stderr + built.stdout };
});

test.afterAll(() => {
  for (const c of children) c.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
});

/** A fresh empty folder holding only a copy of this machine's executable, and no source. */
function emptyFolder(name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const exe = join(dir, "werk");
  cpSync(join(out, `werk-${here}`), exe);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return { dir, exe };
}

/** A search path with no Bun in it. */
function pathWithoutBun(): string {
  const parts = (process.env.PATH ?? "").split(delimiter).filter((p) => !existsSync(join(p, "bun")));
  return parts.join(delimiter);
}

async function serve(exe: string, dir: string, env: Record<string, string>) {
  const port = await freePort();
  let output = "";
  const child = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  children.push(child);
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
  return { port, child, output: () => output };
}

test("49.1 the release build makes four executables with matching checksums", () => {
  expect(buildResult.status, buildResult.stderr).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    const sum = `${file}.sha256`;
    expect(existsSync(sum), sum).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(sum, "utf8").trim().split(/\s+/)[0]).toBe(digest);
  }
});

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  expect(buildResult.status, buildResult.stderr).toBe(0);
  const { dir, exe } = emptyFolder("empty-49-2");
  const before = readdirSync(dir).sort();
  const home = join(root, "home-49-2");
  mkdirSync(home);
  const env = { PATH: pathWithoutBun(), HOME: home, WERK_HOME: join(root, "wh-49-2"), WERK_OPEN: "true" };
  // no bun on the path used
  expect(spawnSync("sh", ["-c", "command -v bun"], { env }).status).not.toBe(0);
  const s = await serve(exe, dir, env);
  expect(s.output()).toMatch(/serving on http:\/\/127\.0\.0\.1:\d+/);
  const errors: string[] = [];
  page.on("requestfailed", (r) => errors.push(`failed ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`http://127.0.0.1:${s.port}/`);
  await expect(page.locator("#screen")).toBeVisible();
  await expect(page.locator("#screen")).not.toBeEmpty();
  await page.waitForLoadState("networkidle");
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  // The project's own .werk folder (map and state) may appear; no folder of werk's own files may.
  const added = readdirSync(dir).filter((n) => !before.includes(n));
  expect(added.filter((n) => n !== ".werk")).toEqual([]);
  if (added.includes(".werk")) {
    const inside = readdirSync(join(dir, ".werk"), { recursive: true }).map(String);
    console.log("49.2 .werk holds:", JSON.stringify(inside));
    expect(inside.filter((n) => /\.(js|css|html|md)$|client|verbs/.test(n))).toEqual([]);
  }
  s.child.kill("SIGTERM");
});

test("49.3 the help of the executable lists every command, and a command works", () => {
  expect(buildResult.status, buildResult.stderr).toBe(0);
  const { dir, exe } = emptyFolder("empty-49-3");
  const env = { PATH: pathWithoutBun(), HOME: join(root, "home-49-3"), WERK_HOME: join(root, "wh-49-3") };
  mkdirSync(env.HOME, { recursive: true });
  const help = spawnSync(exe, ["help"], { cwd: dir, env, encoding: "utf8" });
  expect(help.status).toBe(0);
  const fromCheckout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: REPO, encoding: "utf8" });
  expect(fromCheckout.stdout.length).toBeGreaterThan(100);
  expect(help.stdout).not.toBe("");
  expect(help.stdout).toBe(fromCheckout.stdout);
  const verbs = help.stdout.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  expect(verbs.length).toBeGreaterThan(10);
  // run one listed command: add a card, then show it
  const add = spawnSync(exe, ["add", "root", "--title", "Root", "--why", "w"], { cwd: dir, env, encoding: "utf8" });
  expect(add.status, add.stderr).toBe(0);
  const show = spawnSync(exe, ["show", "root"], { cwd: dir, env, encoding: "utf8" });
  expect(show.status, show.stderr).toBe(0);
  expect(show.stdout).toContain("Root");
  expect(show.stderr).not.toMatch(/missing|no such file|not found/i);
});

test("49.4 the agent is told to run the executable that runs", async ({ page }) => {
  expect(buildResult.status, buildResult.stderr).toBe(0);
  const { dir, exe } = emptyFolder("empty-49-4");
  const scriptPath = join(root, "script-49-4.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      roles: {
        chat: {
          replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done." }] } } }]],
        },
      },
    }),
  );
  const env = {
    PATH: [FAKE_DIR, dirname(process.execPath === "" ? "" : Bun_path()), pathWithoutBun()].join(delimiter),
    HOME: join(root, "home-49-4"),
    WERK_HOME: join(root, "wh-49-4"),
    WERK_OPEN: "true",
    WERK_FAKE_SCRIPT: scriptPath,
  };
  mkdirSync(env.HOME, { recursive: true });
  const s = await serve(exe, dir, env);
  await page.goto(`http://127.0.0.1:${s.port}/p/${basename(dir)}`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("Add a card with werk");
  await composer.press("Enter");
  await expect(page.getByText("Done.")).toBeVisible({ timeout: 30_000 });
  const records = readRecords(logPathFor(scriptPath));
  const launch = records.find((r) => r.kind === "launch" && r.role === "chat");
  expect(launch).toBeTruthy();
  const args = (launch as { args: string[] }).args;
  const pick = (flag: string) => args[args.indexOf(flag) + 1] ?? "";
  // The text the agent reads: its instructions and its subagents. The tool allow list is not part of it.
  const text = `${pick("--append-system-prompt")}\n${pick("--agents")}`;
  expect(text.length).toBeGreaterThan(100);
  expect(text).toContain(`"${exe}" help`);
  expect(text.includes("bun ")).toBe(false);
  expect(text.includes("cli.ts")).toBe(false);
  // The command named in the instructions works when run as the agent would run it.
  const ran = spawnSync("sh", ["-c", `"${exe}" help`], { cwd: dir, env, encoding: "utf8" });
  expect(ran.status).toBe(0);
  expect(ran.stdout).toContain("werk <verb>");
  s.child.kill("SIGTERM");
});

function Bun_path(): string {
  const r = spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" });
  return r.stdout.trim();
}
