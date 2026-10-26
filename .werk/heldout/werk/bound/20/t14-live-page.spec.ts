import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Served, startServed } from "./browser-server.ts";

const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const still = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });

let served: Served | undefined;
test.afterEach(async () => {
  await served?.dispose();
  served = undefined;
});

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  served = await startServed();
  await page.goto(served.url);
  await expect(pane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(page);
  const added = served.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(pane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
  expect(await still(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  served = await startServed({ appCopy: true });
  await page.goto(served.url);
  await expect(pane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await mark(page);
  const pidsBefore = served.pids();
  expect(pidsBefore.length).toBeGreaterThan(0);
  const before = await (await fetch(`${served.origin}/api/nothing`)).json();
  expect(before).toEqual({ error: "not found" });

  const routes = join(served.appDir, "src", "serve", "routes.ts");
  writeFileSync(
    routes,
    readFileSync(routes, "utf8").replaceAll('json({ error: "not found" }, 404)', 'json({ error: "edited route" }, 404)'),
  );
  await expect
    .poll(() => served?.output() ?? "", { timeout: 30000 })
    .toMatch(/reusing the live server/);
  expect(served.pids()).toEqual(pidsBefore);
  await expect
    .poll(async () => (await (await fetch(`${served?.origin}/api/nothing`)).json()).error, { timeout: 15000 })
    .toBe("edited route");

  const added = served.werk("add", "after-edit", "--title", "After edit", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
  expect(await still(page)).toBe(true);
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  served = await startServed({ appCopy: true });
  await page.goto(served.url);
  const heading = pane(page).getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const title = await heading.innerText();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(page);
  const entry = join(served.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => still(page), { timeout: 30000 }).toBe(false);
  await expect(pane(page).getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("draft that must survive");
});
