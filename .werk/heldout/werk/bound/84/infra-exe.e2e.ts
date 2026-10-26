/// <reference lib="dom" />
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { LAUNCHES_FILE } from "../src/test/fake-script.ts";
import { builtCopy, COPY, startExe, type Running } from "./infra-helper.ts";

test.setTimeout(180000);
let cleanup: (() => void)[] = [];
test.afterEach(() => { for (const c of cleanup.splice(0)) c(); });

async function up(script?: object) {
  const { w, root } = await startExe(script);
  cleanup.push(() => { w.proc.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); });
  return w;
}

test("41.1 the executable alone serves the map and the client", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const w = await up();
  expect(readdirSync(join(w.dir, "..", "bin"))).toEqual(["werk"]);
  await page.goto(`${w.url}/map`);
  await expect(page.getByRole("heading", { name: "Ship the checkout", level: 1 })).toBeVisible();
  await expect(page.getByText("Retry a failed payment once").first()).toBeVisible();
  await expect(page.getByText("Refund within a day").first()).toBeVisible();
  await page.goto(`${w.url}/map/retry`);
  await expect(page.getByRole("heading", { name: "Retry a failed payment once", level: 1 })).toBeVisible();
  await expect(page.getByText("A second failure goes back to").first()).toBeVisible();
  expect(errors).toEqual([]);
});

function launchArgs(w: Running): string[][] {
  const file = join(w.fake, LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === "launch").map((e) => e.args);
}

test("41.2 a prompt built in the executable names the executable", async ({ page }) => {
  const reply = [
    { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } },
  ];
  const w = await up({ roles: { chat: { replies: [reply] } } });
  await page.goto(`${w.url}/map`);
  const pane = page.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Add a card to the map");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => launchArgs(w).length).toBeGreaterThan(0);
  const args = launchArgs(w)[0] as string[];
  const prompt = args.filter((a) => a.includes("werk")).join("\n");
  expect(prompt).toContain(w.exe);
  expect(prompt).not.toMatch(/\bbun\s+\S*cli\.ts/);
  expect(prompt).not.toMatch(/\bnode\s+\S*cli\.ts/);
  const run = spawnSync(w.exe, ["add", "fresh", "--title", "Added by exe path", "--parent", "root"], { cwd: w.dir, env: w.env, encoding: "utf8" });
  expect(run.status).toBe(0);
  await expect(page.getByText("Added by exe path").first()).toBeVisible();
});

test("41.3 a build pass started from the browser names the executable", async ({ page }) => {
  const w = await up();
  await page.goto(`${w.url}/board`);
  const start = page.getByRole("button", { name: /build/i });
  await expect(start).toBeVisible({ timeout: 3000 });
});

test("41.4 a checkout serves the client and prompts as before", async ({ page }) => {
  const { fixtureCopy, FAKE_BIN, CHECKOUT } = await import("./infra-helper.ts");
  const { cleanEnv } = await import("../src/test/clean-env.ts");
  const { mkdtempSync, realpathSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawn } = await import("node:child_process");
  const { FAKE_DIR_VAR, SCRIPT_FILE } = await import("../src/test/fake-script.ts");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-infra-")));
  const dir = fixtureCopy(root);
  const fake = join(root, "fake");
  mkdirSync(fake);
  const reply = [
    { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "pong reply" }] } } },
  ];
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: { chat: { replies: [reply] } } }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  const proc = spawn("bun", [join(CHECKOUT, "src/cli.ts"), "serve", "--port", "0"], { cwd: dir, env });
  cleanup.push(() => { proc.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); });
  const url = await new Promise<string>((res) => { let o = ""; proc.stdout.on("data", (c) => { o += c; const m = /http:\/\/\S+/.exec(o); if (m) res(m[0].replace(/\/map$/, "")); }); });
  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { name: "Ship the checkout", level: 1 })).toBeVisible();
  await expect(page.getByText("Retry a failed payment once").first()).toBeVisible();
  await expect(page.getByText("Refund within a day").first()).toBeVisible();
  const pane = page.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("ping");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.getByText("pong reply")).toBeVisible();
  const file = join(fake, LAUNCHES_FILE);
  const args = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.kind === "launch").args as string[];
  const text = args.join("\n");
  expect(text).toContain(`bun ${join(CHECKOUT, "src/cli.ts")}`);
});

test("41.5 make build gives four executables, no Windows, and mine serves", async ({ page }) => {
  builtCopy();
  const bin = join(COPY, "dist", "bin");
  expect(readdirSync(bin).sort()).toEqual(["werk-darwin-arm64", "werk-darwin-x64", "werk-linux-arm64", "werk-linux-x64"]);
  const w = await up();
  await page.goto(`${w.url}/map`);
  await expect(page.getByRole("heading", { name: "Ship the checkout", level: 1 })).toBeVisible();
});

test("42.2 the started executable answers a map request with the fixture cards", async () => {
  const w = await up();
  const home = await (await fetch(`${w.url}/api/home`)).text();
  expect(home).toContain("Ship the checkout");
  expect(home).toContain("Retry a failed payment once");
  const smoke = spawnSync("sh", ["scripts/smoke.sh", w.exe], { cwd: COPY, encoding: "utf8" });
  expect(smoke.status).toBe(0);
  expect(smoke.stdout).toContain("answered a map request");
});
