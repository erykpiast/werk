import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const marked = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const listener = (port: string) =>
  spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).stdout.trim();

test("14.1 a card added from the command line appears with no reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
  await composer(page).fill("half a thought");
  await marked(page);
  const added = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(mapPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer(page)).toHaveValue("half a thought");
});

test("14.2 a server edit changes a response and the live page stays connected", async ({ page, appCopy }) => {
  await page.goto(appCopy.url);
  await expect(mapPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await marked(page);
  const port = new URL(appCopy.origin).port;
  const before = listener(port);
  expect(before).not.toBe("");
  const routes = join(appCopy.appDir, "src", "serve", "routes.ts");
  const source = readFileSync(routes, "utf8");
  expect(source).toContain("return json({ projects: entries(ctx.projects) });");
  writeFileSync(routes, source.replace("return json({ projects: entries(ctx.projects) });", "return json({ projects: entries(ctx.projects), edited: true });"));
  await expect.poll(async () => (await (await fetch(`${appCopy.origin}/api/projects`)).json() as { edited?: boolean }).edited, { timeout: 30000 }).toBe(true);
  expect(appCopy.output()).toMatch(/reusing the live server/);
  expect(listener(port)).toBe(before);
  const added = appCopy.werk("add", "after", "--title", "After edit", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(mapPane(page).getByText("After edit")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(appCopy.url);
  const heading = mapPane(page).getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const title = await heading.innerText();
  await composer(page).fill("draft that must survive");
  await marked(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  await expect(heading).toHaveText(title);
  await expect(composer(page)).toHaveValue("draft that must survive");
});
