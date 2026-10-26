/// <reference lib="dom" />
// Held-out browser steps 15.x. werk has no map server, so each card page is the renderer's HTML for
// that card, served at a test origin with the product's style sheet (the same mount as e2e/).
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../web/md";

const ORIGIN = "http://heldout.test";
const CSS = readFileSync(new URL("../web/md.css", import.meta.url), "utf8");
const page = (html: string, head = "") =>
  `<!doctype html><html><head><style>${CSS}</style></head><body>${head}<article>${html}</article></body></html>`;

async function serve(p: Page, bodies: Record<string, string>, known: Set<string>) {
  await p.route(`${ORIGIN}/**`, async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/map\//, ""));
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, body: "no card" });
    return route.fulfill({ contentType: "text/html", body: page(renderMarkdown(body, known), `<h1 data-card="${id}">${id}</h1>`) });
  });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const known = new Set(["al-diff", "align", "notes-test"]);
  await serve(p, { "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.", "al-diff": "Diff card.", align: "Align." }, known);
  await p.goto(`${ORIGIN}/map/notes-test`);
  const diff = p.locator('article a[href="/map/al-diff"]');
  await expect(diff).toHaveCount(4);
  await expect(diff).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diff.all()) {
    const ff = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(ff).toMatch(/mono/i);
  }
  await expect(p.locator('article a[href="/map/align"]')).toHaveText("#align");
  const text = await p.locator("article").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(text).toContain("then");
  expect(text).toContain("and");
  await diff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "al-diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const known = new Set(["al-diff", "guards"]);
  const body = [
    "--al-diff", "", "##al-diff", "", "&al-diff", "",
    "a code span holding `node src/cli.ts show #al-diff`", "",
    "see #no-such-card", "", "visit https://example.com/page#al-diff", "",
    "# al-diff", "", "Also #al-diff here.",
  ].join("\n");
  await serve(p, { guards: body }, known);
  await p.goto(`${ORIGIN}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = p.locator("article p", { hasText: t }).first();
    await expect(para).toContainText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = p.locator("article p", { hasText: "visit" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const h = p.locator("article h1");
  await expect(h).toHaveText("al-diff");
  await expect(h.locator("a")).toHaveCount(0);
  const own = p.locator("article p", { hasText: "Also" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const known = new Set(["al-diff", "code-sample"]);
  const long = `${"y".repeat(320)} #al-diff`;
  const body = [
    "```zsh", "echo $HOME | grep -v x", "```", "",
    "```TypeScript", "const n: number = 1", "```", "",
    "```cobol", "DISPLAY 'HELLO'.", "```", "",
    "```", long, "```",
  ].join("\n");
  await serve(p, { "code-sample": body }, known);
  await p.goto(`${ORIGIN}/map/code-sample`);
  const boxes = p.locator("article pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => p.locator("article .codebox").nth(i);
  await expect(p.locator("article .codebox")).toHaveCount(4);
  await expect(box(0)).toContainText("zsh");
  await expect(box(0).locator("code")).toHaveText("echo $HOME | grep -v x");
  const zshColours = await box(0).locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(zshColours).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((e) => getComputedStyle(e).color);
  const nColour = await box(1).locator("code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    }
    return "none";
  });
  expect(nColour).not.toBe("none");
  expect(kwColour).not.toBe(nColour);
  await expect(box(2)).toContainText("cobol");
  await expect(box(2).locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await box(2).locator("code, code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobolColours).toBe(1);
  const pre = box(3).locator("pre");
  const s = await pre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(s.sw).toBeGreaterThan(s.cw);
  expect(["auto", "scroll"]).toContain(s.ox);
  const doc = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  await expect(p.locator("article .codebox a")).toHaveCount(0);
  await expect(box(3).locator("code")).toContainText("#al-diff");
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  await serve(p, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }, new Set(["unsafe"]));
  await p.goto(`${ORIGIN}/map/unsafe`);
  await expect(p.locator("article")).toContainText("<script>window.__pwned = true</script>");
  await expect(p.locator("article script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  const bold = p.locator("article strong, article b", { hasText: "bold" });
  await expect(bold).toHaveCount(1);
  expect(Number(await bold.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  const del = p.locator("article del, article s", { hasText: "gone" });
  await expect(del).toHaveCount(1);
  await expect(del).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile", async ({ page: p }) => {
  const known = new Set(["al-diff", "tile-card"]); // old-idea is removed
  await p.goto("about:blank");
  await p.setContent(page(`<div class="msg user">${renderMarkdown("Compare #al-diff with #old-idea and show code", known)}</div>`));
  await expect(p.locator(".msg.user a")).toHaveCount(1);
  await expect(p.locator(".msg.user a")).toHaveAttribute("href", "/map/al-diff");
  await expect(p.locator(".msg.user")).toContainText("#old-idea");
  const reply = 'Here:\n```json\n{"card": "al-diff", "n": 2, "ok": true}\n```';
  await p.setContent(page(`<div class="msg agent">${renderMarkdown(reply.slice(0, reply.indexOf("2,")), known)}</div>`));
  await expect(p.locator(".msg.agent .codebox")).toContainText("json");
  await expect(p.locator(".msg.agent .codebox code")).toHaveText('{"card": "al-diff", "n": ');
  await p.setContent(page(`<div class="msg agent">${renderMarkdown(reply, known)}</div>`));
  await expect(p.locator(".msg.agent .codebox code")).toHaveText('{"card": "al-diff", "n": 2, "ok": true}');
  const colours = await p.locator(".msg.agent .codebox code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  await serve(p, { "tile-card": "Depends on #al-diff" }, known);
  await p.setContent(page(`<a class="tile" href="${ORIGIN}/map/tile-card"><span>${renderTileInline("Depends on #al-diff", known)}</span></a>`));
  await expect(p.locator("a.tile")).toHaveText("Depends on #al-diff");
  await expect(p.locator("a.tile a")).toHaveCount(0);
  await p.locator("a.tile").click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});
