/// <reference lib="dom" />
// Held-out user paths 15.1 to 15.5. No werk server serves a map page yet, so each card page is
// the renderer's HTML with its style sheet, served at a test origin (#werk-test-visual-renderer-page).
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../web/md";

const ORIGIN = "http://heldout.test";
const CSS = readFileSync(new URL("../web/md.css", import.meta.url), "utf8");

function html(body: string): string {
  return `<!doctype html><html><head><style>${CSS}</style></head><body>${body}</body></html>`;
}

async function serveMap(p: Page, cards: Record<string, string>, known: Set<string>): Promise<void> {
  await p.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const id = decodeURIComponent(path.replace(/^\/map\//, ""));
    const text = cards[id];
    if (text === undefined) return route.fulfill({ status: 404, body: "not in the map" });
    return route.fulfill({
      contentType: "text/html",
      body: html(`<main data-open-card="${id}"><article class="card-body">${renderMarkdown(text, known)}</article></main>`),
    });
  });
}

/** Each text run in `root` with the colour of the element that holds it. */
function textColours(root: Locator): Promise<{ text: string; colour: string }[]> {
  return root.evaluate((el) => {
    const out: { text: string; colour: string }[] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
      if ((n.textContent ?? "").trim() === "") continue;
      out.push({ text: n.textContent ?? "", colour: getComputedStyle(n.parentElement as Element).color });
    }
    return out;
  });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const known = new Set(["al-diff", "align", "notes-test"]);
  await serveMap(
    p,
    {
      "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
      "al-diff": "The al-diff card.",
      align: "The align card.",
    },
    known,
  );
  await p.goto(`${ORIGIN}/map/notes-test`);
  const body = p.locator("article.card-body");
  const diff = body.locator("a", { hasText: /^#al-diff$/ });
  await expect(diff).toHaveCount(4);
  for (const a of await diff.all()) {
    await expect(a).toHaveText("#al-diff");
    const font = await a.evaluate((el) => {
      const inner = el.querySelector("code") ?? el;
      return getComputedStyle(inner).fontFamily;
    });
    expect(font.toLowerCase()).toMatch(/mono|courier|consolas|menlo/);
  }
  await expect(body.locator("a", { hasText: /^#align$/ })).toHaveCount(1);
  await expect(body.locator("a")).toHaveCount(5);
  // "then" and "and" are outside every link.
  const loose = await body.evaluate((el) => {
    const copy = el.cloneNode(true) as Element;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(loose).toContain("then");
  expect(loose).toContain("and");
  await expect(body.locator("a", { hasText: "then" })).toHaveCount(0);

  await diff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("main")).toHaveAttribute("data-open-card", "al-diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const known = new Set(["al-diff", "guards"]);
  const text = [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
    "# al-diff",
    "Here #al-diff stands on its own.",
  ].join("\n\n");
  await serveMap(p, { guards: text }, known);
  await p.goto(`${ORIGIN}/map/guards`);
  const body = p.locator("article.card-body");
  for (const plain of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const block = body.locator("p", { hasText: plain });
    await expect(block).toHaveCount(1);
    await expect(block).toHaveText(plain);
    await expect(block.locator("a")).toHaveCount(0);
  }
  const code = body.locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  await expect(body.locator('a[href="/map/al-diff"]', { hasText: "node" })).toHaveCount(0);
  const url = body.locator("p", { hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toHaveText("visit https://example.com/page#al-diff");
  await expect(url.locator('a[href*="/map/"]')).toHaveCount(0);
  const heading = body.locator("h1, h2, h3, h4, h5, h6", { hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const own = body.locator("p", { hasText: "stands on its own" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
  await expect(own).toHaveText("#al-diff");
  await expect(body.locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(body.locator('a[href="/map/no-such-card"]')).toHaveCount(0);
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 900, height: 700 });
  const known = new Set(["al-diff", "code-sample"]);
  const long = `${"wide_".repeat(80)} #al-diff`;
  const text = [
    "```zsh",
    "echo $HOME | grep -v x",
    "```",
    "",
    "```TypeScript",
    "const n: number = 1",
    "```",
    "",
    "```cobol",
    "DISPLAY 'HELLO'.",
    "```",
    "",
    "```",
    long,
    "```",
  ].join("\n");
  await serveMap(p, { "code-sample": text }, known);
  await p.goto(`${ORIGIN}/map/code-sample`);
  const body = p.locator("article.card-body");
  const pres = body.locator("pre");
  await expect(pres).toHaveCount(4);
  // Each fence in its own box: each pre has a distinct box ancestor that holds one pre.
  const boxes = body.locator(":scope > *:has(pre)");
  await expect(boxes).toHaveCount(4);
  for (const box of await boxes.all()) await expect(box.locator("pre")).toHaveCount(1);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];

  await expect(zsh).toContainText("zsh");
  await expect(zsh.locator("pre")).toHaveText("echo $HOME | grep -v x");
  const zshColours = new Set((await textColours(zsh.locator("pre"))).map((r) => r.colour));
  expect(zshColours.size).toBeGreaterThanOrEqual(2);

  const tsRuns = await textColours(ts.locator("pre"));
  const kw = tsRuns.find((r) => r.text.trim() === "const");
  const name = tsRuns.find((r) => /(^|\s)n(\s|:|$)/.test(r.text) && !r.text.includes("number"))
    ?? tsRuns.find((r) => /(^|\s)n:/.test(r.text));
  expect(kw, JSON.stringify(tsRuns)).toBeDefined();
  expect(name, JSON.stringify(tsRuns)).toBeDefined();
  expect(kw?.colour).not.toBe(name?.colour);

  await expect(cobol).toContainText("cobol");
  await expect(cobol.locator("pre")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = new Set((await textColours(cobol.locator("pre"))).map((r) => r.colour));
  expect(cobolColours.size).toBe(1);

  const scroll = await plain.locator("pre").evaluate((el) => {
    const style = getComputedStyle(el);
    return { inner: el.scrollWidth, outer: el.clientWidth, overflow: style.overflowX };
  });
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.overflow);
  const pageWidth = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);

  await expect(plain.locator("pre")).toContainText("#al-diff");
  await expect(body.locator("pre a")).toHaveCount(0);
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  const known = new Set(["unsafe"]);
  await serveMap(p, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }, known);
  await p.goto(`${ORIGIN}/map/unsafe`);
  const body = p.locator("article.card-body");
  await expect(body).toContainText("<script>window.__pwned = true</script>");
  await expect(body.locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body.getByText("bold", { exact: true });
  const weight = await bold.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(weight).toBeGreaterThanOrEqual(600);
  const gone = body.getByText("gone", { exact: true });
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  // "old-idea" is removed, so it is not in the set of ids the map can open.
  const known = new Set(["al-diff", "tile-card"]);
  await serveMap(p, { "tile-card": "Depends on #al-diff", "al-diff": "The al-diff card." }, known);
  await p.goto(`${ORIGIN}/map/al-diff`);
  const mount = (inner: string) =>
    p.evaluate((h) => {
      document.body.innerHTML = h;
    }, inner);

  await mount(`<section class="pane"><div class="msg user">${renderMarkdown("Compare #al-diff with #old-idea and show code", known)}</div></section>`);
  const user = p.locator(".msg.user");
  await expect(user.locator("a")).toHaveCount(1);
  await expect(user.locator("a")).toHaveText("#al-diff");
  await expect(user.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(user).toContainText("#old-idea");

  const reply = 'Here is the card:\n```json\n{"id": "al-diff", "open": true, "depth": 2}\n```\nDone.';
  const cut = reply.indexOf('"open"');
  await mount(`<div class="msg agent">${renderMarkdown(reply.slice(0, cut), known)}</div>`);
  const streaming = p.locator(".msg.agent");
  await expect(streaming.locator("pre")).toHaveCount(1);
  await expect(streaming.locator(":scope *:has(> pre), :scope *:has(pre)").first()).toContainText("json");
  await expect(streaming.locator("pre")).toContainText('{"id": "al-diff", ');

  await mount(`<div class="msg agent">${renderMarkdown(reply, known)}</div>`);
  const pre = p.locator(".msg.agent pre");
  await expect(pre).toHaveText('{"id": "al-diff", "open": true, "depth": 2}');
  const colours = new Set((await textColours(pre)).map((r) => r.colour));
  expect(colours.size).toBeGreaterThanOrEqual(2);

  await mount(
    `<a class="tile" href="/map/tile-card"><span class="summary">${renderTileInline("Depends on #al-diff", known)}</span></a>`,
  );
  const tile = p.locator("a.tile");
  await expect(tile).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.locator("main")).toHaveAttribute("data-open-card", "tile-card");
});
