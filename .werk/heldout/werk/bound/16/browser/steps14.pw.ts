import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

function freePort(): Promise<number> {
  return new Promise((ok, bad) => {
    const probe = createServer();
    probe.once("error", bad);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => ok(port));
    });
  });
}

type Server = {
  url: string;
  port: number;
  dir: string;
  appDir: string;
  log: () => string;
  werk: (...args: string[]) => { code: number; stdout: string; stderr: string };
  dispose: () => Promise<void>;
};

/** A werk server in dev mode on a copy of the app, with its output kept. */
async function startDev(): Promise<Server> {
  const env = { ...cleanEnv(process.env), WERK_DEV: "1" };
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  const end = Date.now() + 40000;
  for (;;) {
    const res = await fetch(`${url}/api/graph?shape=1`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url, port, dir, appDir,
    log: () => output,
    werk: (...args) => {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    dispose: async () => {
      const exited = new Promise((done) => child.once("exit", done));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const marked = (page: Page) => page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
const stillLoaded = (page: Page) => page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const listeners = (port: number) =>
  spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n").sort().join(",");

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({ page }) => {
  const s = await startDev();
  try {
    await page.goto(s.url);
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await marked(page);
    const added = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(mapPane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

test("14.2 a server edit changes a response and the live page stays connected", async ({ page }) => {
  const s = await startDev();
  try {
    await page.goto(s.url);
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await marked(page);
    const before = listeners(s.port);
    expect(before).not.toBe("");
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    writeFileSync(routes, readFileSync(routes, "utf8").replace("the graph is read with shape=1", "the graph is read with shape=1 (edited)"));
    await expect.poll(async () => (await (await fetch(`${s.url}/api/graph`)).json() as { error: string }).error, { timeout: 20000 }).toContain("(edited)");
    expect(s.log()).toMatch(/reusing the live server/);
    expect(listeners(s.port)).toBe(before);
    const added = s.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(mapPane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  const s = await startDev();
  try {
    await page.goto(s.url);
    const title = mapPane(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await marked(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toHaveText(titleText ?? "");
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await s.dispose();
  }
});
