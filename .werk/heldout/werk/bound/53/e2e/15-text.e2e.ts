// 15.1 - 15.5: card text rendered in the real map page served by `werk serve`.
import { expect, type Page, test } from "@playwright/test";
import { cleanup, project, type Werk } from "./harness";

test.afterEach(cleanup);

async function mapWith(cards: Record<string, string>): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Align the columns", parent: "root" });
  for (const [id, body] of Object.entries(cards))
    w.seed("node.added", { id, kind: "card", title: `Card ${id}`, body, parent: "root" });
  return w;
}

const body = (p: Page) => p.locator('[data-field="body"]');

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await mapWith({
    "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
  });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (let i = 0; i < 4; i++) {
    const font = await links.nth(i).evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect.soft(font).toMatch(/mono/i);
  }
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toBe("See , then , then , then , and  too.");
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
    "And #al-diff on its own.",
  ].join("\n");
  const w = await mapWith({ guards: text });
  await p.goto(`${w.url}/map/guards`);
  const paras = body(p).locator("p");
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = paras.filter({ hasText: t });
    await expect.soft(para).toHaveText(t);
    await expect.soft(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect.soft(command).toHaveText("node src/cli.ts show #al-diff");
  await expect.soft(command.locator("a")).toHaveCount(0);
  const missing = paras.filter({ hasText: "see #no-such-card" });
  await expect.soft(missing).toHaveText("see #no-such-card");
  await expect.soft(missing.locator("a")).toHaveCount(0);
  const url = paras.filter({ hasText: "visit" });
  await expect.soft(url).toContainText("https://example.com/page#al-diff");
  await expect.soft(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6");
  await expect.soft(heading).toHaveText("al-diff");
  await expect.soft(heading.locator("a")).toHaveCount(0);
  const own = paras.filter({ hasText: "on its own" }).locator("a");
  await expect.soft(own).toHaveAttribute("href", "/map/al-diff");
  await expect.soft(body(p).locator("a")).toHaveCount(1);
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const text = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. #al-diff", "```"],
    ...["```", `${"y".repeat(400)} #al-diff`, "```"],
  ].join("\n");
  const w = await mapWith({ "code-sample": text });
  await p.goto(`${w.url}/map/code-sample`);
  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const boxes = body(p).locator(".codebox");
  await expect.soft(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect.soft(zsh).toContainText("zsh");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect.soft(shellColours).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect.soft(kw).toHaveText("const");
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nameColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    return "";
  });
  expect.soft(kwColour).not.toBe(nameColour);
  await expect.soft(cobol).toContainText("cobol");
  await expect.soft(cobol.locator("code span")).toHaveCount(0);
  await expect.soft(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'. #al-diff");
  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ov: getComputedStyle(el).overflowX }));
  expect.soft(scroll.inner).toBeGreaterThan(scroll.outer);
  expect.soft(scroll.ov).toMatch(/auto|scroll/);
  const page = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect.soft(page.s).toBeLessThanOrEqual(page.c);
  await expect.soft(pres.locator("a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await mapWith({ unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong, b")).toHaveText("bold");
  expect(Number(await body(p).locator("strong, b").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await mapWith({});
  w.seed("node.added", { id: "old-idea", kind: "card", title: "An old idea", parent: "root" });
  w.seed("node.removed", { id: "old-idea" });
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", why: "Depends on #al-diff", parent: "root" });
  await p.goto(`${w.url}/map`);
  // When the person sends the chat message ... in the pane
  const chat = p.getByRole("textbox", { name: /chat|message/i });
  await chat.fill("Compare #al-diff with #old-idea and show code", { timeout: 5000 });
  await chat.press("Enter");
});
