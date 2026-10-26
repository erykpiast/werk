// Scenarios 15.x: card text as the person sees it on the card page of a real werk server.
import { expect, type Page, test } from "@playwright/test";
import { cleanup, type Proj, project } from "./e2e-harness.ts";

test.afterEach(cleanup);

function withCards(cards: Record<string, string>, extra: (w: Proj) => void = () => {}): Proj {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Columns align", parent: "root" });
  for (const [id, body] of Object.entries(cards)) w.seed("node.added", { id, kind: "card", title: `Card ${id}`, body, parent: "root" });
  extra(w);
  return w;
}

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (p: Page, sel: string) =>
  p.locator(sel).first().evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = withCards({ "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  const s = await w.serve();
  await p.goto(`${s.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (let i = 0; i < 4; i++) {
    const font = await links.nth(i).evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|menlo|consolas/);
  }
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every change is a diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const text = [
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
    "On its own: #al-diff",
  ].join("\n");
  const w = withCards({ guards: text });
  const s = await w.serve();
  await p.goto(`${s.url}/map/guards`);
  const b = body(p);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "#no-such-card"]) await expect(b).toContainText(t);
  await expect(b.locator("code", { hasText: "node src/cli.ts show #al-diff" })).toHaveCount(1);
  await expect(b.locator("code", { hasText: "node src/cli.ts show #al-diff" }).locator("a")).toHaveCount(0);
  await expect(b).toContainText("https://example.com/page#al-diff");
  const heading = b.locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  const cardLinks = b.locator('a[href="/map/al-diff"]');
  await expect(cardLinks).toHaveCount(1);
  await expect(cardLinks).toHaveText("#al-diff");
  await expect(b.locator('a[href*="no-such-card"]')).toHaveCount(0);
  const all = await b.locator("a").allTextContents();
  expect(all.filter((t) => t !== "#al-diff" && !t.startsWith("https://"))).toEqual([]);
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  const long = `echo ${"x".repeat(400)} #al-diff`;
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
  const w = withCards({ "code-sample": text });
  const s = await w.serve();
  await p.setViewportSize({ width: 800, height: 900 });
  await p.goto(`${s.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  expect(await zsh.locator('[class*="tok-"]').count()).toBeGreaterThan(0);
  const ts = boxes.nth(1);
  const kw = await ts.locator("span", { hasText: /^const$/ }).evaluate((el) => getComputedStyle(el).color);
  const nColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    }
    return "";
  });
  expect(nColour).not.toBe("");
  expect(kw).not.toBe(nColour);
  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  const colours = await cobol.locator("code").evaluate((el) => {
    const set = new Set<string>();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      if ((n.textContent ?? "").trim() !== "") set.add(getComputedStyle(n.parentElement as Element).color);
    return [...set];
  });
  expect(colours).toHaveLength(1);
  const plainBox = boxes.nth(3);
  const scroll = await plainBox.locator("pre").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(scroll.sw).toBeGreaterThan(scroll.cw);
  expect(["auto", "scroll"]).toContain(scroll.ox);
  const page = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(page.sw).toBeLessThanOrEqual(page.iw);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(plainBox).toContainText("#al-diff");
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = withCards({ unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  const s = await w.serve();
  await p.goto(`${s.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).locator("strong, b").filter({ hasText: "bold" });
  await expect(bold).toHaveCount(1);
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s").filter({ hasText: "gone" });
  await expect(gone).toHaveCount(1);
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = withCards({}, (w) => {
    w.seed("node.added", { id: "old-idea", kind: "card", title: "An old idea", parent: "root" });
    w.seed("node.removed", { id: "old-idea" });
    w.seed("node.added", { id: "tile-card", kind: "card", title: "Tile card", body: "Depends on #al-diff", parent: "root" });
  });
  const s = await w.serve();
  await p.goto(`${s.url}/map`);
  // The chat pane: a message box beside the map.
  const chat = p.getByRole("textbox", { name: /message|chat/i });
  await expect(chat).toHaveCount(1, { timeout: 5000 });
  await chat.fill("Compare #al-diff with #old-idea and show code");
  await chat.press("Enter");
  const mine = p.locator("text=Compare").first();
  await expect(mine.locator("xpath=..").locator('a[href="/map/al-diff"]')).toHaveCount(1);
});
