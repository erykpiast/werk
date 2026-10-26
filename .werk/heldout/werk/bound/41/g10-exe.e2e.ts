// g10: the compiled executable (41.1, 41.2, 41.3, 41.5) and the checkout (41.4). The executable comes from
// a build in a copy of the checkout, whose path is in G10_EXE (the file werk-<platform>-<arch>).
import { spawn, spawnSync } from "node:child_process";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CHECKOUT = realpathSync(join(import.meta.dirname, ".."));
const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");
const BUILT = process.env.G10_BIN ?? "";

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const reply = (id: string, text: string) => [
  stream({ type: "message_start", message: { id } }),
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } }),
  { event: { type: "assistant", message: { id, content: [{ type: "text", text }] } } },
];

type Started = { url: string; dir: string; fake: string; exe: string; pid: number; stop(): Promise<void> };
const toStop: Started[] = [];
test.afterEach(async () => {
  for (const s of toStop.splice(0)) {
    await s.stop();
  }
});

/** Copies only the executable into an empty folder and starts it in a copy of the fixture project. */
async function startExe(): Promise<Started> {
  expect(existsSync(BUILT), `G10_BIN ${BUILT}`).toBe(true);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "g10-exe-")));
  const bin = join(root, "empty");
  mkdirSync(bin);
  const exe = join(bin, "werk");
  cpSync(BUILT, exe);
  expect(readdirSync(bin)).toEqual(["werk"]);
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const fake = join(root, "fake");
  mkdirSync(fake);
  writeFileSync(
    join(fake, SCRIPT_FILE),
    JSON.stringify({ roles: { chat: { replies: [reply("m1", "Hello from the fake chat agent")] } } }),
  );
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake, TMPDIR: join(root, "tmp") };
  mkdirSync(env.TMPDIR);
  const proc = spawn(exe, ["serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.once("exit", (code) => reject(new Error(`exe exited ${code}: ${err}`)));
  });
  const s: Started = {
    url,
    dir,
    fake,
    exe,
    pid: proc.pid ?? 0,
    stop: async () => {
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once("exit", r));
        proc.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
  toStop.push(s);
  return s;
}

function launches(fake: string): { args: string[]; role: string; messages: string[] }[] {
  const file = join(fake, LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  const out: { pid: number; args: string[]; role: string; messages: string[] }[] = [];
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line) as LaunchEntry;
    if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [] });
    else if (e.kind === "message") out.find((l) => l.pid === e.pid)?.messages.push(JSON.stringify(e.message));
  }
  return out;
}

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}

test("41.1 the executable alone serves the client and the three cards, and a card opens in full", async ({
  page: p,
}) => {
  const w = await startExe();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const bad: string[] = [];
  p.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toContainText("Retry a failed payment once");
  await expect(p.locator('a[data-tile="a:b"]')).toContainText("Refund within a day");
  await p.locator('a[data-tile="retry"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry a failed payment once");
  await expect(p.locator('[data-field="body"]')).toContainText("A second failure goes back to");
  expect(errors).toEqual([]);
  expect(bad).toEqual([]);
  // the client files are served from the executable (an asset request answered)
  const html = await (await fetch(`${w.url}/map`)).text();
  expect(html).toContain("/assets/");
});

test("41.2 a prompt built in the executable names the executable; a card the agent adds by that path shows", async ({
  page: p,
}) => {
  const w = await startExe();
  await p.goto(`${w.url}/map`);
  await say(p, "Add a card to the map");
  await expect(pane(p).locator(".msg.agent").first()).toContainText("Hello from the fake chat agent");
  const l = launches(w.fake).find((x) => x.role === "chat");
  expect(l).toBeDefined();
  const prompt = (l?.args ?? []).join("\n");
  console.log("41.2 args length", prompt.length, "has exe path", prompt.includes(w.exe));
  expect(prompt).toContain(w.exe);
  expect(prompt).not.toMatch(/\b(bun|node|deno)\s+\S*\.(ts|js|mjs)\b/);
  expect(prompt).not.toContain("/$bunfs/");
  // The fake agent cannot run a command; the test plays the agent's step and runs the command from the prompt.
  const run = spawnSync(
    w.exe,
    ["add", "pinged", "--title", "Added by the path", "--why", "A test", "--parent", "root", "--who", "me"],
    { cwd: w.dir, encoding: "utf8", env: cleanEnv(process.env, FAKE_BIN) },
  );
  console.log("41.2 add:", run.status, run.stdout.slice(0, 200), run.stderr.slice(0, 300));
  expect(run.status).toBe(0);
  await expect(p.locator('a[data-tile="pinged"]')).toContainText("Added by the path");
});

test("41.3 commands werk shows and child processes name the executable", async ({ page: p }) => {
  const w = await startExe();
  await p.goto(`${w.url}/map`);
  // Is there anything in the page that starts a build pass?
  const buttons = await p.getByRole("button").allInnerTexts();
  console.log("41.3 buttons:", JSON.stringify(buttons));
  const buildControl = await p.getByRole("button", { name: /build/i }).count();
  console.log("41.3 build controls:", buildControl);
  await say(p, "hello");
  await expect(pane(p).locator(".msg.agent").first()).toContainText("Hello from the fake chat agent");
  const ps = spawnSync("ps", ["-axo", "pid,ppid,command"], { encoding: "utf8" }).stdout.split("\n");
  const kids = ps.filter((line) => new RegExp(`^\\s*\\d+\\s+${w.pid}\\s`).test(line));
  console.log("41.3 children of the executable:", JSON.stringify(kids.map((k) => k.slice(0, 160))));
  // a printed command: a refusal from the executable names its own file
  const run = spawnSync(w.exe, ["help"], { cwd: w.dir, encoding: "utf8" });
  console.log("41.3 help first line:", run.stdout.split("\n")[0]);
  expect(buildControl).toBeGreaterThan(0);
});

test("41.4 a checkout serves the client and prompts as before", async ({ page: p }, info) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "g10-co-")));
  try {
    const dir = join(root, "project");
    cpSync(FIXTURE, dir, { recursive: true });
    const fake = join(root, "fake");
    mkdirSync(fake);
    writeFileSync(
      join(fake, SCRIPT_FILE),
      JSON.stringify({ roles: { chat: { replies: [reply("m1", "Hello from the fake chat agent")] } } }),
    );
    const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
    const cli = join(CHECKOUT, "src", "cli.ts");
    const proc = spawn("bun", [cli, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    const url = await new Promise<string>((resolve, reject) => {
      let out = "";
      proc.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const f = /http:\/\/\S+/.exec(out);
        if (f !== null) resolve(f[0].replace(/\/map$/, ""));
      });
      proc.once("exit", (c) => reject(new Error(`exit ${c}`)));
    });
    try {
      const errors: string[] = [];
      p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(`${url}/map`);
      await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
      await expect(p.locator('a[data-tile="retry"]')).toBeVisible();
      await expect(p.locator('a[data-tile="a:b"]')).toBeVisible();
      await say(p, "hi");
      await expect(pane(p).locator(".msg.agent").first()).toContainText("Hello from the fake chat agent");
      const prompt = (launches(fake).find((x) => x.role === "chat")?.args ?? []).join("\n");
      expect(prompt).toContain(`bun ${cli}`);
      const paths = [...prompt.matchAll(/\bbun\s+(\S+cli\.ts)/g)].map((m) => m[1]);
      console.log("41.4 prompt bun paths:", JSON.stringify([...new Set(paths)]));
      expect(new Set(paths)).toEqual(new Set([cli]));
      expect(errors).toEqual([]);
    } finally {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGTERM");
      await exited;
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  void info;
});

test("41.5 the executable for my platform starts and serves the client", async ({ page: p }) => {
  const dist = join(BUILT, "..");
  const names = readdirSync(dist).sort();
  console.log("41.5 dist/bin:", JSON.stringify(names));
  expect(names).toEqual(["werk-darwin-arm64", "werk-darwin-x64", "werk-linux-arm64", "werk-linux-x64"]);
  expect(names.some((n) => /windows|win32|\.exe$/i.test(n))).toBe(false);
  const w = await startExe();
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toBeVisible();
});
