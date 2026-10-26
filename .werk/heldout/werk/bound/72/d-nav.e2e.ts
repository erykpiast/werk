// Fork D: addresses, live redraw, reconnect, dev reload, and the refines tree (14.x, 69.1-69.3).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { test as htest } from "../e2e/harness.ts";
import { card, cleanup, mark, marked, proj, serve } from "./d-util.ts";

test.afterEach(cleanup);

const h1 = (p: Page) => p.locator("#left-pane").getByRole("heading", { level: 1 });

function rootChild() {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "child", { title: "Child" });
  return p;
}

test("14.1 a person moves between cards by address and sees a not-found page", async ({ page }) => {
  const p = rootChild();
  const url = await serve(p).url;
  await page.goto(`${url}/map`);
  await expect(h1(page)).toHaveText("Root");
  await expect(page.locator("#chat-pane")).toBeVisible();
  await expect(page.locator("#chat-pane").getByRole("textbox", { name: "Message" })).toBeVisible();
  await page.goto(`${url}/map/child`);
  await expect(h1(page)).toHaveText("Child");
  await page.goBack();
  await expect(h1(page)).toHaveText("Root");
  await page.goForward();
  await expect(h1(page)).toHaveText("Child");
  await page.goto(`${url}/map/no-card-has-this`);
  await expect(page.locator("#view")).toContainText(/not found|no card|does not hold/i);
  await expect(page.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
  await expect(page.locator("#view")).not.toContainText("Root");
  await expect(page.locator("#view")).not.toContainText("Child");
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  const p = rootChild();
  const url = await serve(p).url;
  await page.goto(`${url}/map/root`);
  await expect(h1(page)).toHaveText("Root");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(page);
  p.ok("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(page.locator("#view")).toContainText("Fresh idea");
  expect(await marked(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page }) => {
  const p = rootChild();
  const s = serve(p);
  const url = await s.url;
  await page.goto(`${url}/map/root`);
  await expect(h1(page)).toHaveText("Root");
  await mark(page);
  s.proc.kill("SIGTERM");
  await s.exited;
  p.ok("add", "offline", "--title", "Written offline", "--parent", "root");
  const again = serve(p, Number(new URL(url).port));
  await again.url;
  await expect(page.locator("#view")).toContainText("Written offline");
  console.log(`14.3 same document kept: ${await marked(page)}`);
});

htest("14.4 in dev, a server edit changes a response and the live page stays connected", async ({ page, harness }) => {
  htest.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const before = await fetch(`${w.url}/no/such/address`);
  const oldText = await before.text();
  await page.goto(`${w.url}/map/root`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await mark(page);
  const file = join(w.app, "src", "serve", "server.ts");
  const text = readFileSync(file, "utf8");
  expect(text).toContain('"werk: no such address\\n"');
  writeFileSync(file, text.replace('"werk: no such address\\n"', '"werk: heldout edit\\n"'));
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 })
    .toBe("werk: heldout edit\n");
  expect(oldText).not.toBe("werk: heldout edit\n");
  expect(w.err()).toMatch(/reus\w* the live server/);
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(page.locator("#view")).toContainText("After edit");
  expect(await marked(page)).toBe(true);
});

htest(
  "14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft",
  async ({ page, harness }) => {
    htest.setTimeout(90_000);
    const w = await harness.start({ copy: true });
    await page.goto(`${w.url}/map/retry`);
    const title = await page.getByRole("heading", { level: 1 }).textContent();
    await page.waitForLoadState("networkidle");
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await mark(page);
    const file = join(w.app, "web", "main.tsx");
    const text = readFileSync(file, "utf8");
    expect(text).toContain('mount("chat-pane")');
    writeFileSync(
      file,
      text.replace('mount("chat-pane")', 'document.body.dataset.heldout = "yes";\nmount("chat-pane")'),
    );
    await expect(page.locator("body")).toHaveAttribute("data-heldout", "yes", { timeout: 20_000 });
    expect(await marked(page)).toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title ?? "");
    await expect(composer).toHaveValue("draft that must survive");
  },
);

test("69.1 the map shows the project as a refines tree", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Tree root" });
  card(p, "left", { title: "Left child" });
  card(p, "right", { title: "Right child" });
  card(p, "grand", { title: "Grand child", parent: "left" });
  const url = await serve(p).url;
  await page.goto(`${url}/map`);
  await expect(h1(page)).toHaveText("Tree root");
  await expect(page.locator('#view [data-tile="left"]')).toContainText("Left child");
  await expect(page.locator('#view [data-tile="right"]')).toContainText("Right child");
  await expect(page.locator('#view [data-tile="grand"]')).toHaveCount(0);
  await page.locator('#view [data-tile="left"]').click();
  await expect(h1(page)).toHaveText("Left child");
  await expect(page.locator('#view [data-tile="grand"]')).toContainText("Grand child");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Tree root" });
  const url = await serve(p).url;
  await page.goto(`${url}/map`);
  await expect(h1(page)).toHaveText("Tree root");
  await expect(page.locator("#view")).not.toContainText("Use an append-only log");
  await mark(page);
  p.ok("add", "log", "--title", "Use an append-only log", "--parent", "root");
  p.ok("accept", "log", "--actor", "you");
  const tile = page.locator('#view [data-tile="log"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile).toHaveAttribute("data-proposed", "false", { timeout: 5000 });
  expect(await marked(page)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Tree root" });
  card(p, "left", { title: "Left child", body: "Left body words" });
  const url = await serve(p).url;
  await page.goto(`${url}/map`);
  await page.locator('#view [data-tile="left"]').click();
  await expect(page).toHaveURL(/\/map\/left$/);
  await expect(h1(page)).toHaveText("Left child");
  await expect(page.locator('[data-field="body"]')).toContainText("Left body words");
  const view = page.locator("#view");
  // The only text box in the card view is the note box, which writes a note, not the card's words.
  const boxes = view.locator("input, textarea, [contenteditable=true], [contenteditable='']");
  const names = await boxes.evaluateAll((els) =>
    els.map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("placeholder") ?? ""}`),
  );
  for (const name of names) expect(name).toMatch(/note/i);
  await expect(view.getByRole("button", { name: /edit|title|body|rename/i })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/map\/left$/);
  await expect(h1(page)).toHaveText("Left child");
});
