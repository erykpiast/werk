import { expect, type Page, test } from "@playwright/test";
import { served, stop, type Werk } from "./e2e-project.ts";

test.afterEach(stop);

async function withCards(cards: Record<string, { title: string; body?: string; summary?: string }>): Promise<Werk> {
  const w = await served();
  for (const [id, fields] of Object.entries(cards))
    w.seed("node.added", { id, kind: "card", parent: "root", ...fields });
  return w;
}

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (p: Page, selector: string) =>
  p
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = await withCards({
    "al-diff": { title: "Every change is a diff" },
    align: { title: "Align the columns" },
    "notes-test": {
      title: "Notes test",
      body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
    },
  });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const link of await body(p).locator('a[href="/map/al-diff"]').all()) {
    const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(4);
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  expect(prose).not.toContain("al-diff");

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
  const w = await withCards({
    "al-diff": { title: "Every change is a diff" },
    guards: { title: "Guards", body: text },
  });
  await p.goto(`${w.url}/map/guards`);

  for (const plain of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: plain });
    await expect(para).toHaveCount(1);
    await expect(para).toHaveText(plain);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);

  const own = body(p).locator("p").filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
  await expect(own).toHaveText("#al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 800, height: 600 });
  const wide = `${"x".repeat(300)} #al-diff`;
  const text = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    "",
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    "",
    ...["```cobol", "DISPLAY 'HELLO'. #al-diff", "```"],
    "",
    ...["```", wide, "```"],
  ].join("\n");
  const w = await withCards({
    "al-diff": { title: "Every change is a diff" },
    "code-sample": { title: "Code", body: text },
  });
  await p.goto(`${w.url}/map/code-sample`);

  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  await expect(body(p).locator("pre")).toHaveCount(4);

  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toContainText("echo $HOME | grep -v x");
  const zshColours = await zsh
    .locator("code *")
    .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).color))]);
  expect(zshColours.length).toBeGreaterThan(0);
  const zshPlain = await zsh.locator("code").evaluate((el) => getComputedStyle(el).color);
  expect(zshColours.some((c) => c !== zshPlain)).toBe(true);

  const ts = boxes.nth(1);
  const constEl = ts.locator("code span", { hasText: /^const$/ });
  await expect(constEl).toHaveCount(1);
  const constColour = await constEl.evaluate((el) => getComputedStyle(el).color);
  const nColour = await ts.locator("code").evaluate((el) => {
    // The colour of the text "n": its own span, or the code element when it is bare text.
    const span = Array.from(el.querySelectorAll("span")).find((s) => s.textContent?.trim() === "n");
    return getComputedStyle(span ?? el).color;
  });
  expect(constColour).not.toBe(nColour);

  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toContainText("DISPLAY 'HELLO'.");
  await expect(cobol.locator("code span")).toHaveCount(0);

  const long = boxes.nth(3);
  const scroll = await long
    .locator("pre")
    .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(scroll.sw).toBeGreaterThan(scroll.cw);
  expect(["auto", "scroll"]).toContain(scroll.ox);
  const pageWide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(pageWide).toBe(true);

  await expect(boxes.locator("a")).toHaveCount(0);
  expect(colour).toBeDefined();
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await withCards({
    unsafe: { title: "Unsafe", body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" },
  });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(body(p).locator("script")).toHaveCount(0);
  const bold = body(p).locator("strong, b").filter({ hasText: "bold" });
  await expect(bold).toHaveCount(1);
  const struck = body(p).locator("del, s, strike").filter({ hasText: "gone" });
  await expect(struck).toHaveCount(1);
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = await withCards({
    "al-diff": { title: "Every change is a diff" },
    "old-idea": { title: "An old idea" },
    "tile-card": { title: "Tile card", summary: "Depends on #al-diff" },
  });
  w.seed("node.removed", { id: "old-idea" });
  await p.goto(`${w.url}/map`);
  // The chat pane: a box to type a message to the agent.
  const message = p.getByRole("textbox", { name: /message|chat/i });
  await expect(message).toBeVisible({ timeout: 5000 });
  await message.fill("Compare #al-diff with #old-idea and show code");
  await message.press("Enter");
  const sent = p.locator("[data-message]").filter({ hasText: "Compare" });
  await expect(sent.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(sent.locator("a", { hasText: "#old-idea" })).toHaveCount(0);
});
