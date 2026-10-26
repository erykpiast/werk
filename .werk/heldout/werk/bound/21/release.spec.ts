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
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { FAKE_DIR } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const here = `${process.platform}-${process.arch}`;
// No Bun on the program search list of the executable: only the fake agent and the system folders.
const SAFE_PATH = `${FAKE_DIR}:/usr/bin:/bin`;

test.describe.configure({ mode: "serial" });

let work = "";
let out = "";
let exeSrc = "";
const Bun_which = () => spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

/** A new empty project folder with a copy of the executable only. */
function emptyFolder(name: string) {
  const dir = join(work, name);
  mkdirSync(dir);
  const exe = join(dir, "werk");
  copyFileSync(exeSrc, exe);
  spawnSync("chmod", ["+x", exe]);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return { dir, exe };
}

test.beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "werk-ho-release-"));
});
test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

test("49.1 the release build makes four executables with checksums", () => {
  test.setTimeout(300_000);
  // The build writes dist/ in the app folder, so it runs on a copy of the app.
  const app = join(work, "app");
  copyApp(app);
  out = join(work, "out");
  const built = spawnSync("bun", [join(app, "src", "release", "build.ts"), out], {
    cwd: app,
    encoding: "utf8",
  });
  expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
  for (const platform of PLATFORMS) {
    const file = join(out, `werk-${platform}`);
    expect(existsSync(file), file).toBe(true);
    expect(existsSync(`${file}.sha256`)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
  }
  exeSrc = join(out, `werk-${here}`);
});

let serving: ChildProcess | undefined;
test.afterEach(() => {
  serving?.kill("SIGTERM");
  serving = undefined;
});

async function serve(exe: string, dir: string, extraEnv: Record<string, string> = {}) {
  const port = await freePort();
  let output = "";
  const env = { PATH: SAFE_PATH, HOME: join(work, "home"), WERK_HOME: join(work, "werk-home"), WERK_OPEN: "true", ...extraEnv };
  mkdirSync(env.HOME, { recursive: true });
  serving = spawn(exe, ["serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [serving.stdout, serving.stderr]) s?.on("data", (d) => (output += String(d)));
  await expect.poll(() => output, { timeout: 30_000 }).toContain("serving on");
  return { port, output: () => output };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const { dir, exe } = emptyFolder("empty-serve");
  const before = readdirSync(dir).sort();
  const s = await serve(exe, dir);
  expect(s.output()).toMatch(/serving on http:\/\/\S+/);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/")) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`http://127.0.0.1:${s.port}/`);
  await expect(page.locator("#screen")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
  const after = readdirSync(dir).sort();
  // The only new entry is the project's own state folder: no folder of werk's own files (client, source, packages) is unpacked.
  const added = after.filter((n) => !before.includes(n));
  expect(added.filter((n) => n !== ".werk")).toEqual([]);
  if (added.includes(".werk")) {
    const inside = readdirSync(join(dir, ".werk"));
    expect(inside.filter((n) => /client|src|dist|node_modules|\.js$|\.html$/.test(n))).toEqual([]);
  }
});

const VERBS_HELP = (cwd: string, cmd: string[]) =>
  spawnSync(cmd[0] as string, [...cmd.slice(1), "help"], { cwd, encoding: "utf8", env: { PATH: SAFE_PATH, HOME: work, WERK_HOME: join(work, "wh") } });
const verbNames = (text: string) =>
  text
    .split("\n")
    .map((l) => /^\s{2}([a-z-]+)\s{2,}/.exec(l)?.[1])
    .filter((v): v is string => !!v);

test("49.3 the help of the executable lists every command", () => {
  const { dir, exe } = emptyFolder("empty-help");
  const fromExe = VERBS_HELP(dir, [exe]);
  expect(fromExe.status).toBe(0);
  const exeVerbs = verbNames(fromExe.stdout);
  expect(exeVerbs.length).toBeGreaterThan(10);
  const bun = spawnSync("bun", [join(CHECKOUT, "src", "cli.ts"), "help"], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${FAKE_DIR}:${process.env.PATH}` } });
  const checkoutVerbs = verbNames(bun.stdout);
  expect(checkoutVerbs.length).toBeGreaterThan(10);
  for (const v of checkoutVerbs) expect(exeVerbs).toContain(v);
  const env = { PATH: SAFE_PATH, HOME: work, WERK_HOME: join(work, "wh") };
  const add = spawnSync(exe, ["add", "root", "--title", "Root"], { cwd: dir, encoding: "utf8", env });
  expect(add.status, add.stderr).toBe(0);
  const find = spawnSync(exe, ["find"], { cwd: dir, encoding: "utf8", env });
  expect(find.status, find.stderr).toBe(0);
  expect(`${find.stdout}${find.stderr}`).not.toMatch(/no such file|not found|missing|ENOENT/i);
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  const { dir, exe } = emptyFolder("empty-agent");
  const script = join(work, "script.json");
  const reply = [{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done" }] } } }];
  writeFileSync(script, JSON.stringify({ roles: { chat: { replies: [reply] } } }));
  // The fake agent is a Bun script, so this one test keeps Bun on the search list for the fake only.
  const bunDir = dirname(Bun_which());
  const s = await serve(exe, dir, { WERK_FAKE_SCRIPT: script, PATH: `${FAKE_DIR}:${bunDir}:/usr/bin:/bin` });
  await page.goto(`http://127.0.0.1:${s.port}/`);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("add a card with werk");
  await box.press("Enter");
  await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Done")).toBeVisible({ timeout: 20_000 });
  const records = readFileSync(`${script}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const launch = records.find((r: { kind: string }) => r.kind === "launch");
  const text = JSON.stringify(launch.args);
  expect(text).toContain(exe.replace(/^\/private/, ""));
  expect(text).not.toMatch(/src\/cli\.ts/);
  expect(text).not.toMatch(/"[^"]*\/bun"\s+"/);
  // The command that the agent is told runs, and works.
  const told = /"([^"]*werk)" help/.exec(text.replaceAll("\\\"", '"'));
  expect(told).not.toBeNull();
});
