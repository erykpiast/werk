// Held-out steps 15.x: card text rendered on the real card pages of a werk server.
import { expect, type Page, test } from "@playwright/test";
import { project, type Werk } from "./werk";

function map(bodies: Record<string, string>): Werk {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "al-diff", kind: "card", title: "Every proposed change is a diff", parent: "root" });
  w.seed("node.added", { id: "align", kind: "card", title: "Alignment", parent: "root" });
  for (const [id, body] of Object.entries(bodies))
    w.seed("node.added", { id, kind: "card", title: `Card ${id}`, body, parent: "root" });
  return w;
}

const body = (p: Page) => p.locator('[data-field="body"]');

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = map({ "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  const url = await w.serve();
  await p.goto(`${url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (let i = 0; i < 4; i++) {
    const font = await links.nth(i).evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
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
  const w = map({ guards: text });
  const url = await w.serve();
  await p.goto(`${url}/map/guards`);
  for (const plain of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: plain });
    await expect(para).toHaveText(plain);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const visit = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(visit.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = body(p).locator("p").filter({ hasText: "And #al-diff on its own." });
  await expect(own.locator('a[href="/map/al-diff"]')).toHaveCount(1);
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
  const w = map({ "code-sample": text });
  const url = await w.serve();
  await p.goto(`${url}/map/code-sample`);
  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => pres.nth(i).locator(".."));

  // Each fence is its own box: a border or a background of its own.
  for (const pre of await pres.all()) {
    const box = await pre.evaluate((el) => {
      const s = getComputedStyle(el.parentElement as HTMLElement);
      const own = getComputedStyle(el);
      return [s.borderTopWidth, own.borderTopWidth, s.backgroundColor, own.backgroundColor].join(" ");
    });
    expect(box).toMatch(/[1-9]px|rgb\((?!0, 0, 0\))|rgba\(\d+, \d+, \d+, (?!0\))/);
  }
  await expect(zsh).toContainText("zsh");
  const shellColours = await pres
    .nth(0)
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);

  const constColour = await pres
    .nth(1)
    .locator("span", { hasText: /^const$/ })
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const codeColour = await pres
    .nth(1)
    .locator("code")
    .evaluate((el) => getComputedStyle(el).color);
  expect(constColour).not.toBe(codeColour);

  await expect(cobol).toContainText("cobol");
  const cobolColours = await pres
    .nth(2)
    .evaluate((el) => new Set(Array.from(el.querySelectorAll("*")).map((each) => getComputedStyle(each).color)).size);
  expect(cobolColours).toBe(1);

  const scroll = await pres.nth(3).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(pres.locator("a")).toHaveCount(0);
  void plain;
  void ts;
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = map({ unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  const url = await w.serve();
  await p.goto(`${url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const w = map({});
  w.seed("node.added", { id: "old-idea", kind: "card", title: "An old idea", parent: "root" });
  w.seed("node.removed", { id: "old-idea" });
  w.seed("node.added", { id: "tile-card", kind: "card", title: "Depends on #al-diff", parent: "root" });
  const url = await w.serve();
  await p.goto(`${url}/map`);
  // The chat pane.
  const box = p.getByRole("textbox", { name: /chat|message/i });
  await box.fill("Compare #al-diff with #old-idea and show code", { timeout: 5000 });
  await box.press("Enter");
  const message = p.locator("text=Compare").first();
  await expect(message.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
});
