// Held-out steps 15.1-15.5: card references, code fences and unsafe text in the rendered map.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

function card(w: Werk, id: string, fields: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}

const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff card" });
  card(w, "align", { title: "The align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);

  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await diffLinks.all()) {
    const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  const alignLinks = body(p).locator('a[href="/map/align"]');
  await expect(alignLinks).toHaveCount(1);
  await expect(alignLinks).toHaveText("#align");
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
    "#al-diff",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);

  for (const text of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const missing = body(p).locator("p").filter({ hasText: "see #no-such-card" });
  await expect(missing).toHaveText("see #no-such-card");
  await expect(missing.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);

  const cardLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(cardLinks).toHaveCount(1);
  await expect(cardLinks).toHaveText("#al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    "",
    ...["```TypeScript", "const n: number = 1", "```"],
    "",
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    "",
    ...["```", `see #al-diff ${"y".repeat(500)}`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);

  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.filter({ hasText: "echo $HOME" });
  const ts = boxes.filter({ hasText: "const n: number = 1" });
  const cobol = boxes.filter({ hasText: "DISPLAY 'HELLO'." });
  const long = boxes.filter({ hasText: "see #al-diff" });

  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);

  const constColour = await ts
    .locator("code span", { hasText: /^const$/ })
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const nColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (/\bn\b/.test(node.textContent ?? "")) return getComputedStyle(node.parentElement as Element).color;
    }
    return "none";
  });
  expect(nColour).not.toBe("none");
  expect(constColour).not.toBe(nColour);

  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  const cobolColours = await cobol.locator("code").evaluate((el) => {
    const set = new Set<string>([getComputedStyle(el).color]);
    for (const child of Array.from(el.querySelectorAll("*"))) set.add(getComputedStyle(child).color);
    return set.size;
  });
  expect(cobolColours).toBe(1);

  const scroll = await long.locator("pre").evaluate((el) => ({
    inner: el.scrollWidth,
    outer: el.clientWidth,
    overflow: getComputedStyle(el).overflowX,
  }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.overflow);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);

  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(long.locator("code")).toContainText("#al-diff");
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
  const head = 'Here:\n```json\n{"name": "al-diff", "size": ';
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
  card(w, "tile-card", { title: "Tile card", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);

  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine).toContainText("Compare #al-diff with #old-idea and show code");
  const link = mine.locator('a[href="/map/al-diff"]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);

  const reply = pane.locator(".msg.agent");
  const code = reply.locator(".codebox code");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(code).toHaveText('{"name": "al-diff", "size": ');
  await expect(code).toHaveText('{"name": "al-diff", "size": 3, "ok": true}');
  const colours = await code.evaluate((el) => {
    const set = new Set<string>([getComputedStyle(el).color]);
    for (const child of Array.from(el.querySelectorAll("span"))) set.add(getComputedStyle(child).color);
    return set.size;
  });
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
