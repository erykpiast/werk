// Held-out steps 69.1-69.4: the map as a refines tree, live adds, the open card, and the server lock.
import { expect, type Page, test } from "@playwright/test";
import { makeProject } from "./srv.ts";

let cleanup: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function project() {
  const p = makeProject();
  cleanup = p.cleanup;
  p.card("root", { title: "Root card" });
  p.card("left", { title: "Left child", parent: "root" });
  p.card("right", { title: "Right child", parent: "root" });
  p.card("grand", { title: "Grandchild card", parent: "left" });
  return p;
}

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });

test("69.1 the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = project();
  const url = await w.serve().url;
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  const view = p.locator("#view");
  await expect(view.locator('[data-tile="left"]')).toContainText("Left child");
  await expect(view.locator('[data-tile="right"]')).toContainText("Right child");
  await expect(view.locator('[data-tile="grand"]')).toHaveCount(0);
  await view.locator('[data-tile="left"]').click();
  await expect(h1(p)).toHaveText("Left child");
  await expect(view.locator('[data-tile="grand"]')).toContainText("Grandchild card");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = project();
  const url = await w.serve().url;
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
  w.werk("add", "applog", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "applog", "--actor", "you");
  await expect(p.locator('#view [data-tile="applog"]')).toContainText("Use an append-only log", { timeout: 5000 });
  expect(await p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = project();
  const url = await w.serve().url;
  await p.goto(`${url}/map`);
  await p.locator('#view [data-tile="right"]').click();
  await expect(p).toHaveURL(/\/map\/right$/);
  await expect(h1(p)).toHaveText("Right child");
  const view = p.locator("#view");
  // The only text box in the card view is the thread's note box, which writes a note, not the card's words.
  const boxes = await view.getByRole("textbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(boxes.filter((name) => name !== "Note")).toEqual([]);
  await expect(view.locator("[contenteditable]")).toHaveCount(0);
  await expect(p.getByRole("button", { name: /edit|retitle|rename|save/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/right$/);
  await expect(h1(p)).toHaveText("Right child");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  const w = project();
  const first = w.serve();
  const url = await first.url;
  const pid = first.proc.pid;
  const started = Date.now();
  const second = w.serve();
  // The wait message comes while the second server still runs.
  await expect.poll(() => second.err(), { timeout: 3000 }).toMatch(new RegExp(`wait.*${pid}|${pid}.*wait`, "i"));
  const code = await second.exited;
  const took = Date.now() - started;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(7000);
  expect(second.err()).toContain(String(pid));
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator('#view [data-tile="left"]')).toBeVisible();
  await expect(p.locator('#view [data-tile="right"]')).toBeVisible();
});
