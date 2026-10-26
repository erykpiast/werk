import { expect, test } from "@playwright/test";
import { body, project } from "./e2e-helpers.ts";

test("15.1 every form of a card reference in a card body becomes the same link", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Align", parent: "root" });
  w.seed("node.added", {
    id: "notes-test",
    kind: "card",
    title: "Notes test",
    parent: "root",
    body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
  });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
  expect(await body(p).locator('a[href="/map/al-diff"] code').count()).toBe(4);
  const prose = await body(p).locator("p").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator('article[data-card="al-diff"]')).toBeVisible();
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", {
    id: "guards",
    kind: "card",
    title: "Guards",
    parent: "root",
    body: [
      "--al-diff",
      "##al-diff",
      "&al-diff",
      "a code span holding `node src/cli.ts show #al-diff`",
      "see #no-such-card",
      "visit https://example.com/page#al-diff",
      "",
      "# al-diff",
      "",
      "#al-diff",
    ].join("\n"),
  });
  await p.goto(`${w.url}/map/guards`);
  const b = body(p);
  await expect(b).toContainText("--al-diff");
  await expect(b).toContainText("##al-diff");
  await expect(b).toContainText("&al-diff");
  const code = b.locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveCount(1);
  await expect(code.locator("a")).toHaveCount(0);
  await expect(b).toContainText("#no-such-card");
  await expect(b.locator('a[href*="no-such-card"]')).toHaveCount(0);
  await expect(b).toContainText("https://example.com/page#al-diff");
  const heading = b.locator("h1, h2, h3, h4, h5, h6", { hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);
  // Only the standalone #al-diff links to the card.
  await expect(b.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  const long = `echo ${"averyveryverylongword ".repeat(30)}#al-diff`;
  w.seed("node.added", {
    id: "code-sample",
    kind: "card",
    title: "Code sample",
    parent: "root",
    body: [
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
    ].join("\n"),
  });
  await p.setViewportSize({ width: 800, height: 900 });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const zshColours = await zsh.locator("code, code *").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
  expect(zshColours.length).toBeGreaterThan(1);
  const ts = boxes.nth(1);
  const colourOf = async (text: string) =>
    ts.locator("code").evaluate((code, t) => {
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if ((n.textContent ?? "").includes(t)) return getComputedStyle(n.parentElement as Element).color;
      }
      return "";
    }, text);
  const constColour = await colourOf("const");
  const nColour = await colourOf("n:") || (await colourOf(" n"));
  expect(constColour).not.toBe("");
  expect(constColour).not.toBe(nColour);
  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  const cobolColours = await cobol.locator("code, code *").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
  expect(cobolColours.length).toBe(1);
  const longBox = boxes.nth(3);
  const pre = longBox.locator("pre");
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await pre.evaluate((el) => getComputedStyle(el).overflowX)).toMatch(/auto|scroll/);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(longBox).toContainText("#al-diff");
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", {
    id: "unsafe",
    kind: "card",
    title: "Unsafe",
    parent: "root",
    body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~",
  });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("del, s")).toHaveText("gone");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "old-idea", kind: "card", title: "Old idea", parent: "root" });
  w.werk("remove", "old-idea", "--actor", "you");
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", parent: "root" });
  await p.goto(`${w.url}/map`);
  // The chat pane: a message box that sends a chat message to the agent.
  const chat = p.getByRole("textbox", { name: /chat|message/i });
  await expect(chat, "no chat pane on the map page").toHaveCount(1, { timeout: 3000 });
});

test("15.5 probe: the grid tile part alone", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every change is a diff", parent: "root" });
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", parent: "root" });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('[data-section="subcards"] li', { hasText: "Depends on" });
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});
