import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { cleanEnv } from "../src/test-env/env.ts";
import { expect, test } from "../e2e/support/fixtures.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("14.1 a card added from the command line appears without a reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const r = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(r.code).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page }) => {
  const server = await startBrowserServer({ appCopy: true });
  let child: ChildProcess | undefined;
  let output = "";
  try {
    const port = new URL(server.origin).port;
    const cli = join(server.appDir, "src", "cli.ts");
    const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_DEV: "1", WERK_HOME: server.home };
    child = spawn("bun", [cli, "serve", "--port", port], { cwd: server.dir, env });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
    await expect.poll(async () => (await fetch(`${server.origin}/api/projects`).catch(() => null))?.ok === true, { timeout: 30000 }).toBe(true);
    const pid = child.pid;
    await page.goto(server.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);
    const before = await (await fetch(`${server.origin}/api/projects`)).json();
    expect(before.edited).toBeUndefined();

    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    expect(src).toContain("return json({ projects: entries(ctx.projects) });");
    writeFileSync(routes, src.replace("return json({ projects: entries(ctx.projects) });", "return json({ projects: entries(ctx.projects), edited: true });"));

    await expect.poll(() => output, { timeout: 30000 }).toMatch(/reusing the live server/);
    expect(child.exitCode).toBeNull();
    expect(child.pid).toBe(pid);
    await expect.poll(async () => (await (await fetch(`${server.origin}/api/projects`)).json()).edited, { timeout: 30000 }).toBe(true);

    expect(server.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    if (child && child.exitCode === null) {
      const done = new Promise((r) => child?.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
    await server.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(appCopy.url);
  const title = leftPane(page).getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  const titleText = await title.innerText();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(titleText);
  await expect(composer).toHaveValue("draft that must survive");
});
