/// <reference lib="dom" />
// Scenarios 15.1 - 15.5: rendered card text. No werk server serves a map page or a chat pane in
// this checkout, so each test serves the product renderer's HTML (web/md.ts) with its style sheet
// (web/md.css) at /map/<id> on a test origin. The known ids come from the product's fold of a log.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { fold } from "../src/map/fold.ts";
import { renderMarkdown, renderTileInline } from "../web/md";

const ORIGIN = "http://werk.test";
const CSS = readFileSync(new URL("../web/md.css", import.meta.url), "utf8");

type Ev = { type: string; payload: object };
function knownIds(events: Ev[]): Set<string> {
  const text = events.map((e, i) => `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })}\n`).join("");
  return new Set(fold(text).nodes.keys());
}
const card = (id: string, body = "") => ({ type: "node.added", payload: { id, kind: "card", title: id, body } });

const html = (inner: string) =>
  `<!doctype html><html><head><style>${CSS}</style></head><body>${inner}</body></html>`;

async function serve(p: Page, bodies: Record<string, string>, known: Set<string>) {
  await p.route(`${ORIGIN}/**`, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/map\//, ""));
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({
      contentType: "text/html",
      body: html(`<h1 class="card-id">${id}</h1><article>${renderMarkdown(body, known)}</article>`),
    });
  });
}

const color = (p: Page, sel: string) =>
  p.locator(sel).first().evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference becomes the same link to that card", async ({ page: p }) => {
  const body = "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.";
  const known = knownIds([card("al-diff", "The diff card."), card("align"), card("notes-test", body)]);
  await serve(p, { "notes-test": body, "al-diff": "The diff card." }, known);
  await p.goto(`${ORIGIN}/map/notes-test`);
  const diff = p.locator('article a[href="/map/al-diff"]');
  await expect(diff).toHaveCount(4);
  await expect(diff).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diff.all()) {
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono|Menlo|Consolas|SFMono/i);
  }
  await expect(p.locator('article a[href="/map/align"]')).toHaveText("#align");
  await expect(p.locator("article a")).toHaveCount(5);
  const textNodes = await p.locator("article p").evaluate((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("|"),
  );
  expect(textNodes).toContain("then");
  expect(textNodes).toContain("and");
  await diff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("h1.card-id")).toHaveText("al-diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
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
    "A real reference: #al-diff",
  ].join("\n");
  const known = knownIds([card("al-diff"), card("guards", body)]);
  expect(known.has("no-such-card")).toBe(false);
  await serve(p, { guards: body }, known);
  await p.goto(`${ORIGIN}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = p.locator("article p", { hasText: text });
    await expect(para.first()).toContainText(text);
    await expect(para.first().locator("a")).toHaveCount(0);
  }
  const code = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = p.locator("article p", { hasText: "https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = p.locator("article h1, article h2, article h3").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  const real = p.locator("article p", { hasText: "A real reference" }).locator('a[href="/map/al-diff"]');
  await expect(real).toHaveCount(1);
  await expect(p.locator('article a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const long = `${"long-line-".repeat(40)} #al-diff`;
  const body = [
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
  const known = knownIds([card("al-diff"), card("code-sample", body)]);
  await serve(p, { "code-sample": body }, known);
  await p.goto(`${ORIGIN}/map/code-sample`);
  const boxes = p.locator("article .codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const zshColours = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(zshColours).toBeGreaterThanOrEqual(2);
  const ts = boxes.nth(1);
  const constColour = await ts.locator("code span", { hasText: /^const$/ }).first().evaluate((e) => getComputedStyle(e).color);
  // "n" is plain text in the code element, or its own span
  const nSpan = ts.locator("code span", { hasText: /^n$/ });
  const nColour = (await nSpan.count()) > 0 ? await nSpan.first().evaluate((e) => getComputedStyle(e).color) : await color(p, "article .codebox:nth-of-type(2) code");
  expect(constColour).not.toBe(nColour);
  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await cobol.locator("code, code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobolColours).toBe(1);
  const wide = boxes.nth(3);
  const sizes = await wide.locator("pre").evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, o: getComputedStyle(el).overflowX }));
  expect(sizes.s).toBeGreaterThan(sizes.c);
  expect(["auto", "scroll"]).toContain(sizes.o);
  const pageWidth = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(pageWidth[0]).toBeLessThanOrEqual(pageWidth[1] as number);
  await expect(p.locator("article .codebox a")).toHaveCount(0);
  await expect(wide.locator("code")).toContainText("#al-diff");
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const body = "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~";
  const known = knownIds([card("unsafe", body)]);
  await serve(p, { unsafe: body }, known);
  await p.goto(`${ORIGIN}/map/unsafe`);
  await expect(p.locator("article")).toContainText("<script>window.__pwned = true</script>");
  await expect(p.locator("article script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  const bold = p.locator("article strong, article b", { hasText: "bold" });
  await expect(bold).toHaveCount(1);
  expect(Number(await bold.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = p.locator("article del, article s", { hasText: "gone" });
  await expect(gone).toHaveCount(1);
  expect(await gone.evaluate((e) => getComputedStyle(e).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const known = knownIds([
    card("al-diff"),
    card("old-idea"),
    { type: "node.removed", payload: { id: "old-idea" } },
    card("tile-card", "Depends on #al-diff"),
  ]);
  expect(known.has("old-idea")).toBe(false);
  await p.goto("about:blank");
  await p.setContent(html(`<div id="msg">${renderMarkdown("Compare #al-diff with #old-idea and show code", known)}</div>`));
  await expect(p.locator('#msg a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(p.locator("#msg a")).toHaveCount(1);
  await expect(p.locator("#msg")).toContainText("#old-idea");

  const full = 'Here:\n```json\n{"id": "al-diff", "n": 2, "ok": true}\n```';
  const partial = full.slice(0, full.indexOf(' "n"'));
  await p.setContent(html(`<div id="reply">${renderMarkdown(partial, known)}</div>`));
  await expect(p.locator("#reply .codebox .codebox-tag")).toHaveText("json");
  await expect(p.locator("#reply .codebox code")).toHaveText('{"id": "al-diff",');
  await p.setContent(html(`<div id="reply">${renderMarkdown(full, known)}</div>`));
  await expect(p.locator("#reply .codebox code")).toHaveText('{"id": "al-diff", "n": 2, "ok": true}');
  const colours = await p
    .locator("#reply .codebox code, #reply .codebox code span")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(colours).toBeGreaterThanOrEqual(3);

  await serve(p, { "tile-card": "Depends on #al-diff" }, known);
  await p.setContent(
    html(`<a class="tile" href="${ORIGIN}/map/tile-card">${renderTileInline("Depends on #al-diff", known)}</a>`),
  );
  await expect(p.locator("a.tile")).toHaveText("Depends on #al-diff");
  await expect(p.locator("a.tile a")).toHaveCount(0);
  await p.locator("a.tile").click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.locator("h1.card-id")).toHaveText("tile-card");
});
