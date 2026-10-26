import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as plain, type Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { real, startCopyServer } from "./helpers-14-17.ts";

const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const still = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("14.1 a card added from the command line shows on the open page without a reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(pane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(page);
  const added = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root", "--why", "w");
  expect(added.code).toBe(0);
  await expect(pane(page).getByText("Fresh idea")).toBeVisible({ timeout: 15000 });
  expect(await still(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

plain("14.2 in dev a server edit changes a response and the live channel stays up", async ({ page }) => {
  const s = await startCopyServer();
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const pidBefore = s.listenerPid();
    expect(pidBefore).not.toBe("");
    const before = await (await fetch(`${s.origin}/api/projects`)).json();
    expect(before.edited).toBeUndefined();

    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(src).toContain(needle);
    writeFileSync(routes, src.replace(needle, "return json({ projects: entries(ctx.projects), edited: true });"));

    await expect.poll(() => s.output(), { timeout: 20000 }).toContain("reusing the live server");
    await expect
      .poll(async () => (await (await fetch(`${s.origin}/api/projects`)).json()).edited, { timeout: 20000 })
      .toBe(true);
    expect(s.listenerPid()).toBe(pidBefore);

    expect(s.werk("add", "after", "--title", "After edit", "--parent", "root", "--why", "w").code).toBe(0);
    await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
    expect(await still(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  real(appCopy.werk, "c1", "root", "A card page");
  await page.goto(`${appCopy.url}/map/c1`);
  const heading = pane(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("A card page");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => still(page), { timeout: 25000 }).toBe(false);
  await expect(heading).toHaveText("A card page");
  await expect(composer).toHaveValue("draft that must survive");
});
