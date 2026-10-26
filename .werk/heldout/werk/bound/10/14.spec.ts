// werk/14: live updates and hot reload in dev, on a real server and a real browser.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const FIXTURE = join(import.meta.dirname, "..", "e2e", "fixtures", "project");
const ROOT_LOG =
  [
    { type: "node.proposed", id: "root", kind: "card", title: "Root", status: "open", why: "The one card." },
    { type: "node.accepted", id: "root", actor: "you" },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n") + "\n";

const mark = (page: Page) => page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
const loaded = (page: Page) => page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  const server = await startBrowserServer();
  try {
    writeFileSync(join(server.dir, ".werk", "log.jsonl"), ROOT_LOG);
    await server.start();
    await page.goto(server.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(page);
    const added = server.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code).toBe(0);
    await expect(pane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
    expect(await loaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await server.dispose();
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
  const dir = join(root, "project");
  const appDir = join(root, "app");
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, ".werk", "log.jsonl"), ROOT_LOG);
  const cli = copyApp(appDir);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...cleanEnv(process.env) };
  let output = "";
  let child: ChildProcess | undefined;
  try {
    child = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env: { ...env, WERK_DEV: "1" } });
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", (c) => (output += String(c)));
    await expect
      .poll(async () => (await fetch(`${url}/api/graph?shape=1`).catch(() => null))?.ok === true, { timeout: 30000 })
      .toBe(true);
    const lock = () => JSON.parse(readFileSync(join(dir, ".werk", "serve.lock"), "utf8")) as { pid: number; port: number };
    const before = lock();

    await page.goto(url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await mark(page);

    const routes = join(appDir, "src", "serve", "routes.ts");
    const source = readFileSync(routes, "utf8");
    expect(source).toContain("the graph is read with shape=1");
    writeFileSync(routes, source.replace("the graph is read with shape=1", "the graph is read with shape=1 (edited)"));

    await expect.poll(() => output, { timeout: 20000 }).toMatch(/reusing the live server/);
    const after = lock();
    expect(after).toEqual(before);
    expect(after.port).toBe(port);
    expect(() => process.kill(after.pid, 0)).not.toThrow();
    const res = await fetch(`${url}/api/graph`);
    expect(await res.text()).toContain("(edited)");

    const added = spawnSync("bun", [cli, "add", "after", "--title", "After edit", "--parent", "root"], { cwd: dir, env, encoding: "utf8" });
    expect(added.status).toBe(0);
    await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await loaded(page)).toBe(true);
  } finally {
    const running = child;
    if (running && running.exitCode === null) {
      const exited = new Promise((done) => running.once("exit", done));
      running.kill("SIGTERM");
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  const server = await startBrowserServer({ appCopy: true });
  try {
    await server.start();
    await page.goto(server.url);
    const heading = pane(page).getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const title = await heading.innerText();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await mark(page);

    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited by the held-out test\n`);

    await expect.poll(() => loaded(page), { timeout: 20000 }).toBe(false);
    await expect(pane(page).getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await server.dispose();
  }
});
