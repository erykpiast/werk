// Held-out steps 15.1–15.5: card references, code fences and safe text.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Werk, id: string, fields: Record<string, string> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Al diff card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map`);
  await p.goto(`${w.url}/map/notes-test`);

  const al = body(p).locator("a", { hasText: /^#al-diff$/ });
  await expect(al).toHaveCount(4);
  for (const link of await al.all()) {
    const font = await link.evaluate((el) => {
      const inner = el.querySelector("code") ?? el;
      return getComputedStyle(inner).fontFamily;
    });
    expect(font).toMatch(/mono/i);
  }
  const align = body(p).locator("a", { hasText: /^#align$/ });
  await expect(align).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveCount(5);
  const plain = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(plain).toContain("then");
  expect(plain).toContain("and");
  await expect(body(p).locator("a", { hasText: /then|and/ })).toHaveCount(0);

  await al.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
    "# al-diff",
    "Then #al-diff on its own.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);

  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveCount(1);
    await expect(para).toContainText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);

  const own = body(p).locator('a[href="/map/al-diff"]');
  await expect(own).toHaveCount(1);
  await expect(own).toHaveText("#al-diff");
  await expect(body(p).locator("p").filter({ hasText: "on its own" }).locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1024, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
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
    `${"word ".repeat(120)}#al-diff`,
    "```",
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);

  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const box = (text: string) => body(p).locator(".codebox").filter({ hasText: text });
  for (const text of ["echo $HOME", "const n", "DISPLAY", "word word"]) await expect(box(text)).toHaveCount(1);

  const zsh = box("echo $HOME");
  await expect(zsh).toContainText("zsh");
  const shellColours = await zsh
    .locator("pre span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);

  const ts = box("const n");
  const kw = ts.locator("pre span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const name = await ts.locator("pre").evaluate((pre) => {
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? "").search(/\bn\b/);
      if (i >= 0 && !/const|number/.test(n.textContent ?? "".slice(0, 0))) return getComputedStyle(n.parentElement as Element).color;
      if (i >= 0) return getComputedStyle(n.parentElement as Element).color;
    }
    return "";
  });
  expect(name).not.toBe("");
  expect(await colour(kw)).not.toBe(name);

  const cobol = box("DISPLAY");
  await expect(cobol).toContainText("cobol");
  const cobolColours = await cobol
    .locator("pre, pre *")
    .evaluateAll((els) => new Set(els.filter((el) => (el.textContent ?? "") !== "").map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);

  const long = box("word word").locator("pre");
  const scroll = await long.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.x);
  const page = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);

  await expect(body(p).locator("pre a")).toHaveCount(0);
  await expect(box("word word")).toContainText("#al-diff");
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "m1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2500 },
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
            { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: head + tail }] } } },
          ],
        ],
      },
    },
  });
  card(w, "al-diff");
  card(w, "old-idea");
  w.werk("remove", "old-idea", "--actor", "you");
  card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);

  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");

  const reply = pane.locator(".msg.agent");
  const box = reply.locator(".codebox");
  await expect(box).toContainText("json");
  await expect(box.locator("pre")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(box.locator("pre")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = await box
    .locator("pre span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
});
