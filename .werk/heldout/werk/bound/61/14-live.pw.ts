import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({ page, app }) => {
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

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page, appCopy }) => {
  await page.goto(`${appCopy.url}/map/root`);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);
  const lock = readdirSync(appCopy.home, { recursive: true }).map(String).find((f) => /lock/.test(f));
  const pidBefore = lock ? readFileSync(join(appCopy.home, lock), "utf8") : "";
  const before = await (await fetch(`${appCopy.origin}/api/projects`)).json();
  expect(before.edited).toBeUndefined();

  const routes = join(appCopy.appDir, "src", "serve", "routes.ts");
  const text = readFileSync(routes, "utf8");
  const target = "return json({ projects: entries(ctx.projects) });";
  expect(text).toContain(target);
  writeFileSync(routes, text.replace(target, "return json({ projects: entries(ctx.projects), edited: true });"));

  await expect.poll(() => appCopy.output(), { timeout: 20000 }).toContain("reusing the live server");
  await expect
    .poll(async () => (await (await fetch(`${appCopy.origin}/api/projects`)).json()).edited, { timeout: 20000 })
    .toBe(true);
  const lockAfter = lock ? readFileSync(join(appCopy.home, lock), "utf8") : "";
  expect(lockAfter).toBe(pidBefore);
  // The same port still answers.
  expect((await fetch(`${appCopy.origin}/api/projects`)).ok).toBe(true);

  expect(appCopy.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
  await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(`${appCopy.url}/map/root`);
  const title = await leftPane(page).getByRole("heading", { level: 1 }).innerText();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(composer).toHaveValue("draft that must survive");
});
