// 15.1-15.5: card text rendering, through the product (werk serve, the map, the chat pane, the grid),
// then the same checks on the renderer alone, to say what exists below the missing UI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../web/md.ts";
import { ROOT, seedCards, startWerk, type Werk } from "./werk.ts";

const CSS = readFileSync(join(ROOT, "web/md.css"), "utf8");
let werk: Werk | undefined;
test.afterEach(() => werk?.proc.kill());

async function show(page: Page, html: string, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(`<!doctype html><style>${CSS} body{margin:8px}</style><main id="body">${html}</main>`);
}

const B151 = "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.";
const B152 = [
  "--al-diff",
  "##al-diff",
  "&al-diff",
  "a code span holding `node src/cli.ts show #al-diff`",
  "see #no-such-card",
  "visit https://example.com/page#al-diff",
  "# al-diff",
  "",
  "And #al-diff on its own.",
].join("\n");
const B153 = [
  "```zsh", "echo $HOME | grep -v x", "```",
  "```TypeScript", "const n: number = 1", "```",
  "```cobol", "DISPLAY 'HELLO'.", "```",
  "```", `${"x".repeat(400)} #al-diff`, "```",
].join("\n");
const B154 = "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~";

// ---------- product paths ----------
test("15.1 product", async ({ page }) => {
  werk = await startWerk();
  seedCards(werk, [{ id: "al-diff" }, { id: "align" }, { id: "notes-test", body: B151 }]);
  await page.goto(`${werk.url}/map/notes-test`);
});
test("15.2 product", async ({ page }) => {
  werk = await startWerk();
  seedCards(werk, [{ id: "al-diff" }, { id: "guards", body: B152 }]);
  await page.goto(`${werk.url}/map/guards`);
});
test("15.3 product", async ({ page }) => {
  werk = await startWerk();
  seedCards(werk, [{ id: "al-diff" }, { id: "code-sample", body: B153 }]);
  await page.goto(`${werk.url}/map/code-sample`);
});
test("15.4 product", async ({ page }) => {
  werk = await startWerk();
  seedCards(werk, [{ id: "unsafe", body: B154 }]);
  await page.goto(`${werk.url}/map/unsafe`);
});
test("15.5 product", async ({ page }) => {
  werk = await startWerk();
  seedCards(werk, [{ id: "al-diff" }, { id: "old-idea", removed: true }, { id: "tile-card", summary: "Depends on #al-diff" }]);
  await page.goto(`${werk.url}/`);
});

// ---------- renderer alone ----------
test("15.1 renderer", async ({ page }) => {
  await show(page, renderMarkdown(B151, new Set(["al-diff", "align", "notes-test"])));
  const links = page.locator("#body a");
  await expect(links.filter({ hasText: /^#al-diff$/ })).toHaveCount(4);
  await expect(links.filter({ hasText: /^#align$/ })).toHaveCount(1);
  const font = await links.first().locator("code").evaluate((e) => getComputedStyle(e).fontFamily);
  expect(font).toMatch(/mono|Menlo|Consolas/i);
  const plain = await page.locator("#body p").evaluate((p) =>
    [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""));
  expect(plain).toContain("then");
  expect(plain).toContain("and");
  expect(await links.nth(1).getAttribute("href")).toBe("/map/al-diff");
});
test("15.2 renderer", async ({ page }) => {
  await show(page, renderMarkdown(B152, new Set(["al-diff", "guards"])));
  const p = page.locator("#body p").first();
  await expect(p).toContainText("--al-diff");
  await expect(p).toContainText("##al-diff");
  await expect(p).toContainText("&al-diff");
  await expect(page.locator("#body code", { hasText: "node src/cli.ts show #al-diff" })).toHaveCount(1);
  await expect(page.locator("#body code a")).toHaveCount(0);
  await expect(p).toContainText("#no-such-card");
  await expect(p).toContainText("https://example.com/page#al-diff");
  await expect(page.locator("#body h1")).toHaveText("al-diff");
  await expect(page.locator("#body h1 a")).toHaveCount(0);
  const hrefs = await page.locator("#body a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(["/map/al-diff"]);
});
test("15.3 renderer", async ({ page }) => {
  await show(page, renderMarkdown(B153, new Set(["al-diff", "code-sample"])), 800);
  const boxes = page.locator("#body .codebox");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
  await expect(boxes.nth(0).locator("[class^=tok-]")).not.toHaveCount(0);
  const color = (sel: string) => boxes.nth(1).locator(sel).first().evaluate((e) => getComputedStyle(e).color);
  const kw = await boxes.nth(1).locator(".tok-kw", { hasText: "const" }).evaluate((e) => getComputedStyle(e).color);
  const nColor = await boxes.nth(1).locator("code").evaluate((e) => getComputedStyle(e).color);
  expect(kw).not.toBe(nColor);
  void color;
  await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(boxes.nth(2).locator("[class^=tok-]")).toHaveCount(0);
  const pre = boxes.nth(3).locator("pre");
  expect(await pre.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === "auto")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("#body .codebox a")).toHaveCount(0);
});
test("15.4 renderer", async ({ page }) => {
  await show(page, renderMarkdown(B154, new Set(["unsafe"])));
  await expect(page.locator("#body")).toContainText("<script>window.__pwned = true</script>");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(page.locator("#body script")).toHaveCount(0);
  await expect(page.locator("#body strong")).toHaveText("bold");
  await expect(page.locator("#body del")).toHaveText("gone");
});
test("15.5 renderer", async ({ page }) => {
  const known = new Set(["al-diff", "tile-card"]); // removed cards stay out of the known set (#werk-reflink-inview)
  const msg = renderMarkdown("Compare #al-diff with #old-idea and show code", known);
  const streaming = renderMarkdown('```json\n{"a": 1,', known);
  const done = renderMarkdown('```json\n{"a": 1, "b": true}\n```', known);
  const tile = renderTileInline("Depends on #al-diff", known);
  await show(page, `<div id="m">${msg}</div><div id="s">${streaming}</div><div id="d">${done}</div><a id="t" href="/map/tile-card">${tile}</a>`);
  await expect(page.locator("#m a", { hasText: "#al-diff" })).toHaveAttribute("href", "/map/al-diff");
  await expect(page.locator("#m a", { hasText: "old-idea" })).toHaveCount(0);
  await expect(page.locator("#s .codebox-tag")).toHaveText("json");
  await expect(page.locator("#s pre")).toContainText('{"a": 1,');
  await expect(page.locator("#d .tok-key")).not.toHaveCount(0);
  await expect(page.locator("#t")).toHaveText("Depends on #al-diff");
  await expect(page.locator("#t a")).toHaveCount(0);
});
