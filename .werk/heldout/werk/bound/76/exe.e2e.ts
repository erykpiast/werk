import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { aloneExe, CHECKOUT } from "./exe.ts";

const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
const procs: ChildProcess[] = [];
const dirs: string[] = [];
test.afterEach(async () => {
  for (const p of procs.splice(0)) {
    if (p.exitCode === null) {
      const exited = new Promise((r) => p.once("exit", r));
      p.kill("SIGTERM");
      await exited;
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function threeCardProject(script?: object) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-exe-")));
  dirs.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script ?? { roles: {} }));
  const ev = (seq: number, payload: object) => JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload });
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    [
      ev(1, { id: "root", kind: "card", title: "Root card" }),
      ev(2, { id: "one", kind: "card", title: "Card one", why: "Why one", body: "The full text of card one.", parent: "root" }),
      ev(3, { id: "two", kind: "card", title: "Card two", parent: "root" }),
    ].join("\n") + "\n",
  );
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  return { root, dir, fake, env };
}

function startServe(cmd: string[], cwd: string, env: Record<string, string>): Promise<{ url: string; proc: ChildProcess; err: () => string }> {
  const [program, ...args] = cmd;
  const proc = spawn(program as string, [...args, "serve", "--port", "0"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  return new Promise((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const m = /http:\/\/\S+/.exec(out);
      if (m) resolve({ url: m[0].replace(/\/map$/, ""), proc, err: () => err });
    });
    proc.once("exit", (code) => reject(new Error(`serve exited ${code}: ${err}`)));
  });
}

test("41.1 the executable alone serves the map and the client", async ({ page: p }) => {
  test.setTimeout(240_000);
  const exe = aloneExe();
  const folder = join(exe, "..");
  expect(existsSync(join(folder, "node_modules"))).toBe(false);
  expect(existsSync(join(folder, "src"))).toBe(false);
  expect(existsSync(join(folder, "dist"))).toBe(false);
  const { dir, env } = threeCardProject();
  const s = await startServe([exe], dir, env);
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(`${s.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  await expect(p.locator('[data-tile="one"]')).toContainText("Card one");
  await p.locator('[data-tile="one"]').click();
  await expect(p.locator('[data-field="body"]')).toHaveText("The full text of card one.");
  expect(errors).toEqual([]);
  const client = await fetch(`${s.url}/`);
  expect((await client.text()).includes("<script")).toBe(true);
});

test("41.2 a prompt built in the executable names the executable", async ({ page: p }) => {
  test.setTimeout(240_000);
  const exe = aloneExe();
  const reply = [{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done." }] } } }];
  const { dir, fake, env } = threeCardProject({ roles: { chat: { replies: [reply] } } });
  const s = await startServe([exe], dir, env);
  await p.goto(`${s.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Add a card to the map");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toHaveText("Done.");
  const entries = readFileSync(join(fake, LAUNCHES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry);
  const launch = entries.find((e) => e.kind === "launch") as { args: string[] };
  const prompt = launch.args.join("\n");
  expect(prompt).toContain(exe);
  expect(prompt).not.toMatch(/\bbun\b\S*\s+\S*\/src\/cli\.ts/);
  expect(prompt).not.toMatch(/src\/cli\.ts/);
  const add = spawnSync(exe, ["add", "fresh", "--title", "Fresh from the agent", "--parent", "root"], { cwd: dir, env, encoding: "utf8" });
  expect(add.status).toBe(0);
  await expect(p.locator('[data-tile="fresh"]')).toBeVisible();
});

test("41.4 a checkout serves the client and prompts as before", async ({ page: p }) => {
  const reply = [{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "A reply." }] } } }];
  const { dir, fake, env } = threeCardProject({ roles: { chat: { replies: [reply] } } });
  const cli = join(CHECKOUT, "src", "cli.ts");
  const s = await startServe(["bun", cli], dir, env);
  await p.goto(`${s.url}/map`);
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Hello");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toHaveText("A reply.");
  const entries = readFileSync(join(fake, LAUNCHES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry);
  const launch = entries.find((e) => e.kind === "launch") as { args: string[] };
  const prompt = launch.args.join("\n");
  expect(prompt).toContain(`${cli}`);
  expect(prompt.match(/\/[^\s'`]*\/src\/cli\.ts/g)?.every((m) => m === cli)).toBe(true);
  void cpSync;
});
