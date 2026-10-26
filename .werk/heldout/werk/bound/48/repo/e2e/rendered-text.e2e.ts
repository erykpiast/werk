/// <reference lib="dom" />
// The rendered card text in a real browser (#werk-reflink, #werk-codeblock, #werk-test-visual).
// The renderer's HTML and its style sheet go into a page served at a test origin, so a card link
// is a real navigation. No werk server serves a card page yet, so the test mounts the HTML that
// the card page and the chat pane will mount (#werk-test-visual-renderer-page).

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../web/md";

const ORIGIN = "http://werk.test";
const CSS = readFileSync(new URL("../web/md.css", import.meta.url), "utf8");
const KNOWN = new Set(["al-diff", "align", "notes-test", "guards", "code-sample", "unsafe", "tile-card"]);

function page(html: string, title = ""): string {
  return `<!doctype html><html><head><style>${CSS}</style></head><body>${title}<article>${html}</article></body></html>`;
}

/** Serve each map address as a page that holds the given card's rendered body. */
async function serveCards(p: Page, bodies: Record<string, string>): Promise<void> {
  await p.route(`${ORIGIN}/**`, async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/map\//, ""));
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, body: "no card" });
    return route.fulfill({
      contentType: "text/html",
      body: page(renderMarkdown(body, KNOWN), `<h1 data-card="${id}">${id}</h1>`),
    });
  });
}

function colour(p: Page, selector: string): Promise<string> {
  return p
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}

test("every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  await serveCards(p, {
    "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
    "al-diff": "Every proposed change is a diff.",
  });
  await p.goto(`${ORIGIN}/map/notes-test`);

  const links = p.locator("article a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const link of await p.locator('article a[href="/map/al-diff"] code').all()) {
    expect(await link.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  }
  await expect(p.locator('article a[href="/map/align"]')).toHaveCount(1);
  // "then" and "and" stay ordinary text between the links.
  const prose = await p.locator("article p").evaluate((el) => {
    const copy = el.cloneNode(true) as typeof el;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toBe("See , then , then , then , and  too.");

  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "al-diff");
});

test("text that only looks like a reference stays text", async ({ page: p }) => {
  const body = [
    "--al-diff",
    "",
    "##al-diff",
    "",
    "&al-diff",
    "",
    "a code span holding `node src/cli.ts show #al-diff`",
    "",
    "see #no-such-card",
    "",
    "visit https://example.com/page#al-diff",
    "",
    "# al-diff",
    "",
    "And #al-diff on its own.",
  ].join("\n");
  await serveCards(p, { guards: body });
  await p.goto(`${ORIGIN}/map/guards`);

  const paragraphs = p.locator("article p");
  for (const text of [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
  ]) {
    const para = paragraphs.filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  await expect(p.locator("article h1")).toHaveText("al-diff");
  await expect(p.locator("article h1 a")).toHaveCount(0);

  const links = p.locator("article a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
  await expect(links).toHaveText("#al-diff");
});

test("fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const wide = `${"x".repeat(300)} #al-diff`;
  const body = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. al-diff", "```"],
    ...["```", wide, "```"],
  ].join("\n");
  await serveCards(p, { "code-sample": body });
  await p.goto(`${ORIGIN}/map/code-sample`);

  const boxes = p.locator("article .codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];

  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(3);

  const kw = await ts
    .locator(".tok-kw")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const name = await ts.locator("code").evaluate((el) => getComputedStyle(el).color);
  await expect(ts.locator(".tok-kw").first()).toHaveText("const");
  expect(kw).not.toBe(name);

  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'. al-diff");

  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const pageWidth = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);

  await expect(p.locator("article .codebox a")).toHaveCount(0);
});

test("card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  await serveCards(p, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${ORIGIN}/map/unsafe`);

  await expect(p.locator("article p")).toContainText("<script>window.__pwned = true</script>");
  await expect(p.locator("article script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(p.locator("article strong")).toHaveText("bold");
  await expect(p.locator("article strong")).toHaveCSS("font-weight", "700");
  await expect(p.locator("article del")).toHaveText("gone");
  await expect(p.locator("article del")).toHaveCSS("text-decoration-line", "line-through");
});

test("references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  // "old-idea" is removed, so the map cannot open it and it is not a known id (#werk-reflink-inview).
  await p.goto("about:blank");
  const mount = (html: string) => p.setContent(page(html));

  await mount(`<div class="msg user">${renderMarkdown("Compare #al-diff with #old-idea and show code", KNOWN)}</div>`);
  await expect(p.locator(".msg.user a")).toHaveCount(1);
  await expect(p.locator(".msg.user a")).toHaveAttribute("href", "/map/al-diff");
  await expect(p.locator(".msg.user a")).toHaveText("#al-diff");
  await expect(p.locator(".msg.user p")).toContainText("with #old-idea and");

  const reply = 'Here it is:\n```json\n{"card": "al-diff", "depth": 2, "open": true}\n```';
  const streaming = reply.slice(0, reply.indexOf("2,"));
  await mount(`<div class="msg agent">${renderMarkdown(streaming, KNOWN)}</div>`);
  await expect(p.locator(".msg.agent .codebox .codebox-tag")).toHaveText("json");
  await expect(p.locator(".msg.agent .codebox code")).toHaveText('{"card": "al-diff", "depth": ');

  await mount(`<div class="msg agent">${renderMarkdown(reply, KNOWN)}</div>`);
  const code = p.locator(".msg.agent .codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const key = await colour(p, ".msg.agent .tok-key");
  const str = await colour(p, ".msg.agent .tok-str");
  const plain = await code.evaluate((el) => getComputedStyle(el).color);
  expect(new Set([key, str, plain]).size).toBe(3);

  await serveCards(p, { "tile-card": "Depends on #al-diff" });
  await mount(
    `<a class="tile" href="${ORIGIN}/map/tile-card"><span class="summary">${renderTileInline("Depends on #al-diff", KNOWN)}</span></a>`,
  );
  const tile = p.locator("a.tile");
  await expect(tile).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "tile-card");
});
