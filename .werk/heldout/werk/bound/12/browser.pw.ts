/** Held-out steps 06.2 and 14: the browser against a real werk server. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Held, startHeld } from "./server.ts";

const ROOT = [
  {
    type: "node.proposed",
    id: "root",
    kind: "card",
    title: "Root",
    status: "open",
    why: "The one root card.",
  },
  { type: "node.accepted", id: "root", actor: "you" },
];
const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

let held: Held | undefined;
test.afterEach(async () => {
  await held?.dispose();
  held = undefined;
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page }) => {
  held = await startHeld({
    events: [
      ...ROOT,
      { type: "node.proposed", id: "q1", kind: "excerpt", title: "Ada said so", status: "open" },
      { type: "edge.added", from: "root", to: "q1", link: "supported_by", why: "she said it" },
    ],
  });
  await page.goto(held.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  const accepted = held.werk("accept", "q1", "--actor", "you");
  expect(accepted.code).toBe(0);
  const shown = held.werk("show", "root");
  expect(shown.stdout).not.toContain("[held]");
  // The card view shows the excerpt under the card as supporting evidence.
  await expect(mapPane(page).getByText("Ada said so")).toBeVisible({ timeout: 5000 });
});

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  held = await startHeld({ events: ROOT });
  await page.goto(held.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const added = held.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(mapPane(page).getByText("Fresh idea")).toBeVisible({ timeout: 15000 });
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  held = await startHeld({ events: ROOT, appCopy: true });
  await page.goto(held.url);
  await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  await markLoaded(page);
  const pidBefore = held.listenerPid();
  const before = await (await fetch(`${held.url}/api/graph`)).json();
  expect(before.error).toBe("the graph is read with shape=1");

  const routes = join(held.appDir, "src", "serve", "routes.ts");
  const text = readFileSync(routes, "utf8");
  expect(text).toContain("the graph is read with shape=1");
  writeFileSync(routes, text.replace("the graph is read with shape=1", "edited by the person"));

  await expect
    .poll(async () => (await (await fetch(`${held?.url}/api/graph`)).json()).error, { timeout: 30000 })
    .toBe("edited by the person");
  expect(held.output()).toMatch(/reusing the live server/);
  expect(held.listenerPid()).toBe(pidBefore);

  const added = held.werk("add", "after", "--title", "After edit", "--parent", "root");
  expect(added.code).toBe(0);
  await expect(mapPane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  held = await startHeld({ events: ROOT, appCopy: true });
  await page.goto(held.url);
  const title = mapPane(page).getByRole("heading", { level: 1, name: "Root" });
  await expect(title).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(held.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited by the person\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  await expect(title).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});
