// The compiled executable, in a real browser (#werk-dist). A copy of the checkout builds the executable
// for this machine only; the executable is then copied alone into an empty folder and started there.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
const arch = spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim().replace("x86_64", "x64").replace("aarch64", "arm64");
const os = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout.trim().toLowerCase();
const TARGET = `${os}-${arch}`;

let built = "";
let buildLog = "";
const roots: string[] = [];
const procs: ChildProcess[] = [];

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-exe-")));
  roots.push(root);
  const copy = join(root, "w");
  mkdirSync(copy);
  for (const name of readdirSync(CHECKOUT)) {
    if ([".git", ".werk-heldout", "node_modules", "test-results", "dist", "coverage", "playwright-report"].includes(name)) continue;
    spawnSync("cp", ["-cR", join(CHECKOUT, name), copy]);
  }
  spawnSync("cp", ["-cRp", join(CHECKOUT, "node_modules"), copy]);
  const r = spawnSync("make", ["build", `BUILD_ARGS=--target bun-${TARGET}`], { cwd: copy, encoding: "utf8", env: process.env });
  buildLog = r.stdout + r.stderr;
  built = join(copy, "dist", "bin", `werk-${TARGET}`);
  if (r.status !== 0 || !existsSync(built)) throw new Error(`build failed: ${buildLog.slice(-2000)}`);
});
test.afterEach(() => {
  for (const p of procs.splice(0)) if (p.exitCode === null) p.kill("SIGKILL");
});
test.afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function project(cards: string[], script: object = { roles: {} }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-exeproj-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const lines = [{ id: "root", title: "Root" }, ...cards.map((id) => ({ id, title: `Card ${id}`, parent: "root", body: `Full text of ${id}` }))];
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.map((l, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...l } })).join("\n")}\n`);
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  return { dir, fake, env };
}
function start(cmd: string[], cwd: string, env: Record<string, string>) {
  const proc = spawn(cmd[0] as string, cmd.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const url = async () => {
    const t = Date.now();
    while (Date.now() - t < 20000) {
      const m = /http:\/\/\S+/.exec(out);
      if (m) return m[0].replace(/\/map$/, "");
      if (proc.exitCode !== null) throw new Error(`exited ${proc.exitCode}: ${err}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no url: ${out} ${err}`);
  };
  return { proc, url, err: () => err, out: () => out };
}

test("[41.1] the executable alone serves the map and the client", async ({ page: p }) => {
  const alone = realpathSync(mkdtempSync(join(tmpdir(), "werk-alone-")));
  roots.push(alone);
  const exe = join(alone, "werk");
  copyFileSync(built, exe);
  expect(readdirSync(alone)).toEqual(["werk"]);
  const proj = project(["one", "two", "three"]);
  const s = start([exe, "serve", "--port", "0"], proj.dir, { ...proj.env, PATH: "/usr/bin:/bin" });
  const url = await s.url();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await p.goto(`${url}/map`);
  await expect(p.locator("[data-tile]")).toHaveCount(3);
  await p.locator('[data-tile="two"]').click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Full text of two");
  expect(errors).toEqual([]);
});

test("[41.2] a prompt built in the executable names the executable", async ({ page: p }) => {
  const alone = realpathSync(mkdtempSync(join(tmpdir(), "werk-alone-")));
  roots.push(alone);
  const exe = join(alone, "werk");
  copyFileSync(built, exe);
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const proj = project(["one"], {
    roles: { chat: { replies: [[stream({ type: "message_start", message: { id: "m1" } }), stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } }), { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } },
  });
  const s = start([exe, "serve", "--port", "0"], proj.dir, proj.env);
  const url = await s.url();
  await p.goto(`${url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Add a card to the map");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toHaveText("ok");
  const rec = readFileSync(join(proj.fake, LAUNCHES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const args: string[] = rec.find((e) => e.kind === "launch").args;
  const prompt = args.join("\n");
  expect(prompt).toContain(exe);
  expect(prompt).not.toMatch(/\bbun\s+\S*src\/cli\.ts/);
  expect(prompt).not.toMatch(/\bbun\s+\S*\/cli\.ts/);
  // the agent runs a werk command by that path, and the card shows in the browser
  const run = spawnSync(exe, ["add", "fresh", "--title", "Added by the agent", "--parent", "root"], { cwd: proj.dir, env: proj.env, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  await expect(p.locator('[data-tile="fresh"]')).toBeVisible();
});

test("[41.4] a checkout serves the client and prompts as before", async ({ page: p }) => {
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const proj = project(["one", "two", "three"], {
    roles: { chat: { replies: [[stream({ type: "message_start", message: { id: "m1" } }), stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } }), { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } },
  });
  const s = start(["bun", join(CHECKOUT, "src", "cli.ts"), "serve", "--port", "0"], proj.dir, proj.env);
  const url = await s.url();
  await p.goto(`${url}/map`);
  await expect(p.locator("[data-tile]")).toHaveCount(3);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("hello");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toHaveText("ok");
  const rec = readFileSync(join(proj.fake, LAUNCHES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const prompt = (rec.find((e) => e.kind === "launch").args as string[]).join("\n");
  expect(prompt).toContain(`${join(CHECKOUT, "src", "cli.ts")}`);
});

test("[42.2] the started executable answers a map request", async () => {
  const proj = project(["one", "two"]);
  const alone = realpathSync(mkdtempSync(join(tmpdir(), "werk-alone-")));
  roots.push(alone);
  const smoke = spawnSync("sh", [join(CHECKOUT, "scripts", "smoke.sh"), built], { cwd: CHECKOUT, encoding: "utf8", env: process.env });
  expect(smoke.status, smoke.stdout + smoke.stderr).toBe(0);
  expect(smoke.stdout).toContain("answered a map request");
  void proj;
});
