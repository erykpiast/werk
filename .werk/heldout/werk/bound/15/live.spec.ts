// Steps 14.1 to 14.3: the live page, in a real browser against a real werk server.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Served, serveProject } from "./server.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

let served: Served | undefined;
test.afterEach(async () => {
  await served?.dispose();
  served = undefined;
});

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  served = await serveProject({ rootTitle: "Root" });
  await page.goto(served.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  await composer(page).fill("half a thought");
  await markLoaded(page);

  const added = served.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);

  await expect(mapPane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer(page)).toHaveValue("half a thought");
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  served = await serveProject({ appCopy: true, rootTitle: "Root" });
  await page.goto(served.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  await markLoaded(page);
  const before = served.holder();

  const routes = join(served.appDir, "src", "serve", "routes.ts");
  writeFileSync(
    routes,
    readFileSync(routes, "utf8").replace("the graph is read with shape=1", "the graph is read with shape=1 (edited)"),
  );

  await expect
    .poll(async () => (await (await fetch(`${served?.url}/api/graph`)).text()), { timeout: 20000 })
    .toContain("(edited)");
  expect(served.output()).toMatch(/reusing the live server/);
  expect(served.holder()).toEqual(before);
  expect(before.port).toBe(served.port);

  const added = served.werk("add", "after", "--title", "After edit", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(mapPane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  served = await serveProject({ appCopy: true, rootTitle: "Root" });
  await page.goto(served.url);
  const heading = mapPane(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Root");
  await composer(page).fill("draft that must survive");
  await markLoaded(page);

  const entry = join(served.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(heading).toHaveText("Root");
  await expect(composer(page)).toHaveValue("draft that must survive");
});
