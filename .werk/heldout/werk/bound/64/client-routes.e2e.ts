/// <reference lib="dom" />
// Held-out steps 14.1-14.5: addresses, live updates, reconnect and dev reloads in a real browser.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as pw } from "@playwright/test";
import { test } from "../e2e/harness";
import { project, stop } from "../e2e/project.ts";

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

pw.describe("project harness", () => {
  pw.afterEach(stop);

  pw("14.1", async ({ page: p }) => {
    const w = await project();
    w.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" });
    await p.goto(`${w.url}/map`);
    await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
    await expect(p.locator("#chat-pane")).toBeVisible();
    await expect(p.locator("#chat-pane").getByRole("textbox", { name: "Message" })).toBeVisible();
    await p.goto(`${w.url}/map/child`);
    await expect(h1(p)).toHaveText("Child");
    await p.goBack();
    await expect(h1(p)).toHaveText("Root");
    await p.goForward();
    await expect(h1(p)).toHaveText("Child");
    await p.goto(`${w.url}/map/no-card-has-this-id`);
    await expect(p.locator("#view")).toContainText(/not found|not in the map|is in the map/i);
    await expect(p.locator("#view")).toContainText("no-card-has-this-id");
    await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
    await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
  });

  pw("14.2", async ({ page: p }) => {
    const w = await project();
    await p.goto(`${w.url}/map/root`);
    await expect(h1(p)).toHaveText("Root");
    await p.waitForLoadState("networkidle");
    const composer = p.getByRole("complementary", { name: "Chat" }).getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(p);
    w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(p.locator("#view")).toContainText("Fresh idea");
    expect(await marked(p)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });
});

test("14.3", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
});

test("14.4", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle");
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toMatch(/reus\w* the live server/);
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: edited reply\n");
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
