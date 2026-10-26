/// <reference lib="dom" />
// Held-out steps 15.1–15.5. No werk server serves a card page, a chat pane or a grid in this
// checkout, so each test mounts the HTML of werk's card-text renderer with its style sheet in a
// page at a test origin, the way a card page, a chat message and a tile would mount it.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../repo/web/md";

const ORIGIN = "http://werk.heldout";
const CSS = readFileSync(new URL("../repo/web/md.css", import.meta.url), "utf8");

const html = (body: string, head = "") =>
  `<!doctype html><html><head><style>${CSS}</style></head><body>${head}<article>${body}</article></body></html>`;

/** Serve /map/<id> as the card page of that card. */
async function serve(p: Page, bodies: Record<string, string>, known: Set<string>) {
  await p.route(`${ORIGIN}/**`, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/map\//, ""));
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, body: "not in the map" });
    return route.fulfill({ contentType: "text/html", body: html(renderMarkdown(body, known), `<h1 data-card="${id}">${id}</h1>`) });
  });
}
const colourOf = (p: Page, sel: string) => p.locator(sel).first().evaluate((el) => getComputedStyle(el).color);

test("15.1", async ({ page: p }) => {
  const known = new Set(["al-diff", "align", "notes-test"]);
  await serve(p, { "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.", "al-diff": "The diff card.", align: "Align." }, known);
  await p.goto(`${ORIGIN}/map/notes-test`);
  const diff = p.locator("article a", { hasText: "#al-diff" });
  await expect(diff).toHaveCount(4);
  for (const a of await diff.all()) {
    await expect(a).toHaveText("#al-diff");
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  await expect(p.locator("article a", { hasText: "#align" })).toHaveCount(1);
  await expect(p.locator("article a")).toHaveCount(5);
  const prose = await p.locator("article").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(prose).toContain(" then ");
  expect(prose).toContain(" and ");
  await diff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "al-diff");
});

test("15.2", async ({ page: p }) => {
  const known = new Set(["al-diff", "guards"]);
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
    "A reference #al-diff on its own.",
  ].join("\n");
  await serve(p, { guards: body }, known);
  await p.goto(`${ORIGIN}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = p.locator("article p", { hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = p.locator("article p", { hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const h = p.locator("article h1");
  await expect(h).toHaveText("al-diff");
  await expect(h.locator("a")).toHaveCount(0);
  const own = p.locator("article p", { hasText: "on its own" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const body = [
    "```zsh",
    "echo $HOME | grep -v x",
    "```",
    "```TypeScript",
    "const n: number = 1",
    "```",
    "```cobol",
    "DISPLAY 'HELLO'.",
    "```",
    "```",
    `${"wide ".repeat(80)}#al-diff`,
    "```",
  ].join("\n");
  await serve(p, { "code-sample": body }, new Set(["al-diff", "code-sample"]));
  await p.goto(`${ORIGIN}/map/code-sample`);
  const boxes = p.locator("article pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => p.locator("article .codebox").nth(i);
  await expect(p.locator("article .codebox")).toHaveCount(4);
  await expect(box(0)).toContainText("zsh");
  await expect(box(0).locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await box(0).locator("code, code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nColour = await box(1)
    .locator("code")
    .evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (/\bn\b/.test(t.textContent ?? "")) return getComputedStyle(t.parentElement as Element).color;
      }
      return "";
    });
  expect(nColour).not.toBe("");
  expect(kwColour).not.toBe(nColour);
  await expect(box(2)).toContainText("cobol");
  const cobol = await box(2).locator("code, code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobol).toBe(1);
  const s = await box(3).locator("pre").evaluate((el) => ({ w: el.scrollWidth, c: el.clientWidth, o: getComputedStyle(el).overflowX }));
  expect(s.w).toBeGreaterThan(s.c);
  expect(["auto", "scroll"]).toContain(s.o);
  const page = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(page[0]).toBeLessThanOrEqual(page[1] as number);
  await expect(p.locator("article pre a")).toHaveCount(0);
  await expect(box(3).locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  await serve(p, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }, new Set(["unsafe"]));
  await p.goto(`${ORIGIN}/map/unsafe`);
  await expect(p.locator("article")).toContainText("<script>window.__pwned = true</script>");
  await expect(p.locator("article script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const b = p.locator("article strong, article b");
  await expect(b).toHaveText("bold");
  expect(Number(await b.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const del = p.locator("article del, article s");
  await expect(del).toHaveText("gone");
  await expect(del).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const known = new Set(["al-diff", "tile-card"]);
  await serve(p, { "tile-card": "Depends on #al-diff" }, known);
  await p.goto(`${ORIGIN}/map/tile-card`);
  const mount = (inner: string) =>
    p.evaluate((h) => {
      document.body.innerHTML = h;
    }, inner);
  await mount(`<div class="msg user">${renderMarkdown("Compare #al-diff with #old-idea and show code", known)}</div>`);
  const user = p.locator(".msg.user");
  await expect(user.locator("a")).toHaveCount(1);
  await expect(user.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(user.locator("a")).toHaveText("#al-diff");
  await expect(user).toContainText("#old-idea");

  const reply = 'Here:\n```json\n{"card": "al-diff", "count": 2, "ok": true}\n```\nDone.';
  const partial = reply.slice(0, reply.indexOf('"count"') + 10);
  await mount(`<div class="msg agent">${renderMarkdown(partial, known)}</div>`);
  await expect(p.locator(".msg.agent .codebox")).toContainText("json");
  await expect(p.locator(".msg.agent pre code")).toHaveText('{"card": "al-diff", "count": 2');
  await mount(`<div class="msg agent">${renderMarkdown(reply, known)}</div>`);
  const code = p.locator(".msg.agent pre code");
  await expect(code).toHaveText('{"card": "al-diff", "count": 2, "ok": true}');
  const colours = await code.locator("span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  await mount(`<a class="tile" href="${ORIGIN}/map/tile-card"><span>${renderTileInline("Depends on #al-diff", known)}</span></a>`);
  const tile = p.locator("a.tile");
  await expect(tile).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "tile-card");
  void colourOf;
});
