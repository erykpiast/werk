import { expect, type Page, test } from "@playwright/test";
import { project, type Werk } from "./werk-server";

const body = (p: Page) => p.locator('#card [data-field="body"]');
const card = (w: Werk, id: string, text: string, extra: object = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", body: text, ...extra });

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "Every proposed change is a diff.");
  card(w, "align", "Alignment.");
  card(w, "notes-test", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.");
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const i of [0, 1, 2, 3]) {
    const font = await links.nth(i).evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const prose = await body(p)
    .locator("p")
    .evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
      return copy.textContent ?? "";
    });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("#card article")).toHaveAttribute("data-card", "al-diff");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "Every proposed change is a diff.");
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
  card(w, "guards", text);
  await p.goto(`${w.url}/map/guards`);
  const paras = body(p).locator("p");
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = paras.filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const missing = paras.filter({ hasText: "see #no-such-card" });
  await expect(missing).toHaveText("see #no-such-card");
  await expect(missing.locator("a")).toHaveCount(0);
  const url = paras.filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  const own = paras.filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const w = await project();
  card(w, "al-diff", "Diff.");
  const wide = `${"x".repeat(300)} #al-diff`;
  card(
    w,
    "code-sample",
    [
      ...["```zsh", "echo $HOME | grep -v x", "```"],
      ...["```TypeScript", "const n: number = 1", "```"],
      ...["```cobol", "DISPLAY 'HELLO'.", "```"],
      ...["```", wide, "```"],
    ].join("\n"),
  );
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => boxes.nth(i).locator("xpath=..");
  await expect(box(0)).toContainText("zsh");
  const shell = await boxes
    .nth(0)
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const ts = boxes.nth(1);
  const kw = ts.locator("span", { hasText: /^const$/ }).first();
  await expect(kw).toHaveText("const");
  const kwColour = await kw.evaluate((el) => getComputedStyle(el).color);
  const nameColour = await ts.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (/\bn\b/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    return "";
  });
  expect(kwColour).not.toBe(nameColour);
  await expect(box(2)).toContainText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const scroll = await boxes.nth(3).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~");
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong, b")).toHaveText("bold");
  await expect(body(p).locator("strong, b")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "Diff.");
  card(w, "old-idea", "Old.");
  w.werk("remove", "old-idea", "--actor", "you");
  card(w, "tile-card", "Depends on #al-diff");
  await p.goto(`${w.url}/map`);
  // The chat pane: a box to type a chat message in and a control to send it.
  const pane = p.getByRole("textbox", { name: /chat|message/i });
  await pane.fill("Compare #al-diff with #old-idea and show code", { timeout: 5000 });
  await p.getByRole("button", { name: /send/i }).click();
  const mine = p.locator(".msg.user, [data-role='user']").last();
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator('a[href="/map/old-idea"]')).toHaveCount(0);
});
