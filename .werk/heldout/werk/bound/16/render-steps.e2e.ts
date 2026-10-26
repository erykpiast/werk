// Held-out steps 15.1 to 15.5: card references, code fences and safe text in the rendered map.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Werk, id: string, fields: Record<string, string> = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? `Card ${id}`, parent: "root", ...fields });
}

test("15.1 every form of a card reference in a card body becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff card" });
  card(w, "align", { title: "Align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);

  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await diffLinks.all()) {
    const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const plain = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(plain).toContain("then");
  expect(plain).toContain("and");

  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Diff card");
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
    "Here #al-diff stands on its own.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);

  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toContainText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("a")).toHaveCount(0);

  const own = body(p).locator("p").filter({ hasText: "stands on its own" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fence = (tag: string, text: string) => [`\`\`\`${tag}`, text, "```"].join("\n");
  const long = `${"wide ".repeat(120)}#al-diff`;
  card(w, "code-sample", {
    body: [
      fence("zsh", "echo $HOME | grep -v x #al-diff"),
      fence("TypeScript", "const n: number = 1 // #al-diff"),
      fence("cobol", "DISPLAY 'HELLO'. #al-diff"),
      fence("", long),
    ].join("\n\n"),
  });
  await p.goto(`${w.url}/map/code-sample`);

  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => body(p).locator(".codebox").nth(i));
  await expect(body(p).locator(".codebox")).toHaveCount(4);

  await expect(zsh).toContainText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x #al-diff");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);

  const constWord = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(constWord).toHaveText("const");
  const nColour = await ts.locator("code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/(^|\s)n:/.test(node.textContent ?? "")) return getComputedStyle(node.parentElement as Element).color;
    }
    return "not found";
  });
  expect(nColour).not.toBe("not found");
  expect(await colour(constWord)).not.toBe(nColour);

  await expect(cobol).toContainText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'. #al-diff");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);

  const scroll = await plain.locator("pre").evaluate((el) => ({
    inner: el.scrollWidth,
    outer: el.clientWidth,
    overflow: getComputedStyle(el).overflowX,
  }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.overflow);
  const pageWidth = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);

  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);

  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).locator("strong, b").filter({ hasText: "bold" });
  await expect(bold).toHaveCount(1);
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s").filter({ hasText: "gone" });
  await expect(gone).toHaveCount(1);
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "n": ';
  const tail = '3, "ok": true}\n```';
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
  w.seed("node.removed", { id: "old-idea" });
  // The tile's summary line is the card's why.
  card(w, "tile-card", { title: "Tile card", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);

  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine).toContainText("Compare");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");

  const reply = pane.locator(".msg.agent");
  const box = reply.locator(".codebox");
  await expect(box).toContainText("json");
  await expect(box.locator("code")).toHaveText('{"card": "al-diff", "n": ');
  await expect(box.locator("code")).toHaveText('{"card": "al-diff", "n": 3, "ok": true}');
  const colours = await box
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
