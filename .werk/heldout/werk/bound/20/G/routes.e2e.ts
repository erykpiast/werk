/// <reference lib="dom" />
// Held-out steps 14.1-14.3 and 69.1-69.3: addresses, Back and Forward, the live page, reconnect, the refines tree.
import { expect, type Page, test } from "@playwright/test";
import { test as htest } from "../../e2e/harness.ts";
import { project, stop } from "../../e2e/project.ts";

test.afterEach(stop);

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

test("14.1 addresses, Back and Forward, and a not-found page", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  const chat = p.getByRole("complementary", { name: "Chat" });
  await expect(chat).toBeVisible();
  const left = await p.locator("#left-pane").boundingBox();
  const right = await chat.boundingBox();
  expect(right && left && right.x >= left.x + left.width - 1).toBe(true);
  await expect(chat).not.toContainText("Root");

  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");

  await p.goto(`${w.url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/not found|no card/i);
  await expect(p.getByRole("heading", { name: "Root" })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child" })).toHaveCount(0);
  await expect(p.locator("#view")).not.toContainText("Root");
  await expect(p.locator("#view")).not.toContainText("Child");
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

htest("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  w.werk("retitle", "root", "Root");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
  await expect(h1(p)).toHaveText("Root");
});

test("69.1 the map shows the project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", { id: "one", kind: "card", title: "First child", parent: "root" });
    down.seed("node.added", { id: "two", kind: "card", title: "Second child", parent: "root" });
    down.seed("node.added", { id: "grand", kind: "card", title: "The grandchild", parent: "one" });
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  const subcards = p.locator('[data-section="subcards"]');
  await expect(subcards.locator('a[data-tile="one"]')).toContainText("First child");
  await expect(subcards.locator('a[data-tile="two"]')).toContainText("Second child");
  await expect(p.locator('a[data-tile="grand"]')).toHaveCount(0);
  await p.locator('a[data-tile="one"]').click();
  await expect(h1(p)).toHaveText("First child");
  await expect(p.locator('[data-section="subcards"] a[data-tile="grand"]')).toContainText("The grandchild");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "applog", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "applog", "--actor", "you");
  const tile = p.locator('[data-section="subcards"] a[data-tile="applog"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await marked(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    down.seed("node.added", {
      id: "kid",
      kind: "card",
      title: "A child card",
      body: "The child body",
      parent: "root",
    }),
  );
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="kid"]').click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
  await expect(p.locator('[data-field="body"]')).toHaveText("The child body");
  const view = p.locator("#view");
  await expect(view.locator("[contenteditable]:not([contenteditable=false])")).toHaveCount(0);
  await expect(view.locator("article input, article textarea")).toHaveCount(0);
  await expect(view.getByRole("textbox", { name: /title|body|edit/i })).toHaveCount(0);
  await expect(view.getByRole("button", { name: /title|body|edit|rename/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
});
