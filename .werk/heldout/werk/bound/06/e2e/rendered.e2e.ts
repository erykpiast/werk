/// <reference lib="dom" />
// Held-out steps 15.1 to 15.5. werk has no verb that serves the map, so each test first checks the
// product's own map, then mounts the HTML of werk's card renderer at a test origin to record what
// the renderer alone does.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { renderMarkdown, renderTileInline } from "../../web/md";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ORIGIN = "http://werk.test";
const CSS = readFileSync(join(ROOT, "web/md.css"), "utf8");
const KNOWN = new Set(["al-diff", "align", "notes-test", "guards", "code-sample", "unsafe", "tile-card"]);

/** The person opens the map: werk must have a verb that serves it. */
function mapServerVerb(): string | undefined {
  const run = spawnSync("bun", [join(ROOT, "src/cli.ts"), "help"], { encoding: "utf8" });
  return /^\s{2}(serve|map|ui)\b/m.exec(run.stdout)?.[1];
}

const html = (body: string, head = "") =>
  `<!doctype html><html><head><style>${CSS}</style></head><body>${head}<article>${body}</article></body></html>`;

async function serveCards(p: Page, bodies: Record<string, string>): Promise<void> {
  await p.route(`${ORIGIN}/**`, async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/map\//, ""));
    const body = bodies[id];
    if (body === undefined) return route.fulfill({ status: 404, body: "no card" });
    return route.fulfill({
      contentType: "text/html",
      body: html(renderMarkdown(body, KNOWN), `<h1 data-card="${id}">${id}</h1>`),
    });
  });
}

const colourOf = (p: Page, sel: string) =>
  p
    .locator(sel)
    .first()
    .evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  await serveCards(p, {
    "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
    "al-diff": "A diff card.",
    align: "An align card.",
  });
  await p.goto(`${ORIGIN}/map/notes-test`);
  const diffLinks = p.locator('article a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  for (const link of await diffLinks.all()) {
    await expect(link).toHaveText("#al-diff");
    expect(await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toMatch(/mono/i);
  }
  await expect(p.locator('article a[href="/map/align"]')).toHaveCount(1);
  await expect(p.locator('article a[href="/map/align"]')).toHaveText("#align");
  const rest = await p.locator("article p").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(rest).toContain("then");
  expect(rest).toContain("and");
  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("h1[data-card]")).toHaveAttribute("data-card", "al-diff");
  expect(mapServerVerb(), "werk serves the map").toBeDefined();
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const body = [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
    "# al-diff",
    "And #al-diff on its own.",
  ].join("\n\n");
  await serveCards(p, { guards: body });
  await p.goto(`${ORIGIN}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = p.locator("article p").filter({ hasText: text });
    await expect(para).toHaveCount(1);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = p.locator("article code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = p.locator("article p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(p.locator("article h1")).toHaveText("al-diff");
  await expect(p.locator("article h1 a")).toHaveCount(0);
  const own = p.locator("article p").filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
  expect(mapServerVerb(), "werk serves the map").toBeDefined();
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const body = [
    ...["```zsh", "echo $HOME | grep -v x", "#al-diff", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"y".repeat(400)} #al-diff`, "```"],
  ].join("\n");
  await serveCards(p, { "code-sample": body });
  await p.goto(`${ORIGIN}/map/code-sample`);
  const pres = p.locator("article pre");
  await expect(pres).toHaveCount(4);
  const boxText = (i: number) => pres.nth(i).locator("xpath=..");
  await expect(boxText(0)).toContainText("zsh");
  const zshColours = await pres
    .nth(0)
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(zshColours).toBeGreaterThanOrEqual(2);
  const kw = pres.nth(1).locator("span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nColour = await pres.nth(1).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    }
    return "";
  });
  expect(nColour).not.toBe("");
  expect(kwColour).not.toBe(nColour);
  await expect(boxText(2)).toContainText("cobol");
  const cobolColours = await pres
    .nth(2)
    .evaluate(
      (el) => new Set([el, ...Array.from(el.querySelectorAll("*"))].map((e) => getComputedStyle(e).color)).size,
    );
  expect(cobolColours).toBe(1);
  const wide = await pres
    .nth(3)
    .evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, o: getComputedStyle(el).overflowX }));
  expect(wide.s).toBeGreaterThan(wide.c);
  expect(["auto", "scroll"]).toContain(wide.o);
  const pageWide = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(pageWide).toBe(true);
  await expect(p.locator("article pre a")).toHaveCount(0);
  expect(mapServerVerb(), "werk serves the map").toBeDefined();
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  await serveCards(p, { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${ORIGIN}/map/unsafe`);
  await expect(p.locator("article")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = p.locator("article").getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = p.locator("article").getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  expect(mapServerVerb(), "werk serves the map").toBeDefined();
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  await p.goto("about:blank");
  await p.setContent(
    html(`<div class="msg">${renderMarkdown("Compare #al-diff with #old-idea and show code", KNOWN)}</div>`),
  );
  await expect(p.locator(".msg a")).toHaveCount(1);
  await expect(p.locator(".msg a")).toHaveAttribute("href", "/map/al-diff");
  await expect(p.locator(".msg")).toContainText("#old-idea");
  const reply = 'Here:\n```json\n{"card": "al-diff", "n": 2}\n```';
  await p.setContent(html(`<div class="msg">${renderMarkdown(reply.slice(0, reply.indexOf("2}")), KNOWN)}</div>`));
  await expect(p.locator(".msg pre")).toHaveCount(1);
  await expect(p.locator(".msg pre").locator("xpath=..")).toContainText("json");
  await p.setContent(html(`<div class="msg">${renderMarkdown(reply, KNOWN)}</div>`));
  await expect(p.locator(".msg pre")).toContainText('{"card": "al-diff", "n": 2}');
  const colours = await p
    .locator(".msg pre span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  await serveCards(p, { "tile-card": "Depends on #al-diff" });
  await p.setContent(
    html(`<a class="tile" href="${ORIGIN}/map/tile-card">${renderTileInline("Depends on #al-diff", KNOWN)}</a>`),
  );
  await expect(p.locator("a.tile")).toHaveText("Depends on #al-diff");
  await expect(p.locator("a.tile a")).toHaveCount(0);
  await p.locator("a.tile").click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  // The chat pane, the agent's streamed reply and the grid tile are werk's own map.
  expect(mapServerVerb(), "werk serves the map with a chat pane").toBeDefined();
});
