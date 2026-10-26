import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as baseTest } from "@playwright/test";
import { test } from "../e2e/harness";
import { project, stop } from "../e2e/project.ts";

baseTest.afterEach(stop);
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const heading = (p: Page) => p.getByRole("heading", { level: 1 });

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

baseTest("13.3 each open tab gets one changed signal without card data, and reads the map again", async ({ browser }) => {
  const w = await project();
  const ctx = await browser.newContext();
  const pages = [await ctx.newPage(), await ctx.newPage()];
  for (const p of pages) {
    await p.goto(`${w.url}/map`);
    await expect(p.locator("body")).toContainText("Root");
    await p.evaluate(() => {
      const seen: { type: string; data: string }[] = [];
      (window as unknown as { seen: typeof seen }).seen = seen;
      const es = new EventSource("/api/events");
      es.addEventListener("changed", (e) => seen.push({ type: "changed", data: (e as MessageEvent).data }));
      (window as unknown as { probe: EventSource }).probe = es;
    });
  }
  await pages[0]?.waitForTimeout(500);
  w.werk("add", "second", "--title", "The second card", "--parent", "root");
  for (const p of pages) {
    await expect(p.locator('[data-tile="second"]')).toBeVisible();
    const seen = await p.evaluate(() => (window as unknown as { seen: { type: string; data: string }[] }).seen);
    expect(seen.length).toBe(1);
    expect(seen[0]?.data ?? "").not.toContain("second");
    expect((seen[0]?.data ?? "").length).toBeLessThan(40);
  }
});

baseTest("14.2 a card added from the command line appears without a reload, and the draft stays", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator('[data-tile="fresh"]')).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toBeVisible();
  const title = await heading(p).innerText();
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--why", "w", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
  await expect(heading(p)).toHaveText(title);
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toBeVisible();
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: nothing lives here\\n"');
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 })
    .toBe("werk: nothing lives here\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(w.port).toBe(Number(new URL(w.url).port));
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/root`);
  const title = await heading(p).innerText();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p)).toHaveText(title);
  await expect(composer).toHaveValue("draft that must survive");
});

// ---- 69 ----
baseTest("69.1 the map shows the project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    const c = (id: string, parent: string) => d.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent });
    c("kid1", "root");
    c("kid2", "root");
    c("grand", "kid1");
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('[data-tile="kid1"]')).toBeVisible();
  await expect(p.locator('[data-tile="kid2"]')).toBeVisible();
  await expect(p.locator('[data-tile="grand"]')).toHaveCount(0);
  await p.locator('[data-tile="kid1"]').click();
  await expect(p.locator('[data-tile="grand"]')).toBeVisible();
});

baseTest("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('[data-tile="log"]')).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(p.locator('[data-tile="log"]')).toHaveAttribute("data-proposed", "false");
  expect(await marked(p)).toBe(true);
});

baseTest("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.seed("node.added", { id: "kid", kind: "card", title: "A child card", body: "Body text", parent: "root" }));
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="kid"]').click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(heading(p)).toHaveText("A child card");
  const art = p.locator("article");
  await expect(art.locator("input, textarea, [contenteditable=true]")).toHaveCount(0);
  await expect(p.getByRole("button", { name: /edit|save|rename|change title/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(heading(p)).toHaveText("A child card");
});
