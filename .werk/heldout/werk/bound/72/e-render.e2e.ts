// Held-out steps 15.x and 71.x: card references and code in rendered card text, chat and tiles.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

/** The colour of the element that holds the first text node matching the pattern. */
function colourOfText(at: Locator, pattern: string): Promise<string | null> {
  return at.evaluate((el, source) => {
    const re = new RegExp(source);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (re.test(n.textContent ?? "") && n.parentElement !== null) return getComputedStyle(n.parentElement).color;
    }
    return null;
  }, pattern);
}

const textColours = (at: Locator) =>
  at.evaluate((el) => {
    const out = new Set<string>();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if ((n.textContent ?? "").trim() !== "" && n.parentElement !== null)
        out.add(getComputedStyle(n.parentElement).color);
    }
    return [...out];
  });

/** The text of an element with every link taken out. */
const textOutsideLinks = (at: Locator) =>
  at.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });

const deepFont = (link: Locator) =>
  link.evaluate((el) => {
    let at: Element = el;
    while (at.firstElementChild !== null) at = at.firstElementChild;
    return getComputedStyle(at).fontFamily;
  });

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Al diff card" });
    card(d, "align");
    card(d, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  });
  await p.goto(`${w.url}/map/notes-test`);
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await diffLinks.all()) expect(await deepFont(link)).toContain("monospace");
  const alignLinks = body(p).locator('a[href="/map/align"]');
  await expect(alignLinks).toHaveCount(1);
  await expect(alignLinks).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const plain = await textOutsideLinks(body(p));
  expect(plain).toContain("then");
  expect(plain).toContain("and");
  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
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
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "guards", { body: lines.join("\n\n") });
  });
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
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const own = body(p).locator("p").filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"word ".repeat(120)}#al-diff`, "```"],
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "code-sample", { body: fences.join("\n") });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator("pre").nth(i).locator("xpath=..");
  // zsh
  await expect(box(0)).toContainText("zsh");
  await expect(box(0)).toContainText("echo $HOME | grep -v x");
  expect((await textColours(boxes.nth(0))).length).toBeGreaterThanOrEqual(2);
  // TypeScript
  const kw = await colourOfText(boxes.nth(1), "^\\s*const\\s*$");
  const name = await colourOfText(boxes.nth(1), "(^|\\s)n(\\s|:|$)");
  expect(kw).not.toBeNull();
  expect(kw).not.toBe(name);
  // cobol
  await expect(box(2)).toContainText("cobol");
  expect((await textColours(boxes.nth(2))).length).toBe(1);
  // long line
  const scroll = await boxes.nth(3).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const doc = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client);
  await expect(boxes.nth(3)).toContainText("#al-diff");
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    card(d, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }),
  );
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project(
    {
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
    },
    (d) => {
      card(d, "al-diff");
      card(d, "old-idea");
      d.seed("node.removed", { id: "old-idea" });
      card(d, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
    },
  );
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine.locator("a")).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");

  const reply = pane.locator(".msg.agent");
  const code = reply.locator("pre code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator("pre").locator("xpath=..")).toContainText("json");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  expect((await textColours(code)).length).toBeGreaterThanOrEqual(2);

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
});

test("71.1 known card ids in a body link, other text stays plain", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "align");
    card(d, "notes-card", {
      body: "Read #al-diff and #ghost-card. Also al-diff and align. Run `node src/cli.ts show #al-diff`.",
    });
  });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  // "#al-diff" and bare "al-diff" link; nothing else.
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(2);
  await expect(body(p).locator('a[href="/map/ghost-card"]')).toHaveCount(0);
  expect(await textOutsideLinks(body(p))).toContain("#ghost-card");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  expect(await textOutsideLinks(body(p))).toContain("align");
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  await expect(links).toHaveCount(2);
});

test("71.2 a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Diff the alignment" });
    card(d, "pr-iface", { why: "It builds on #al-diff" });
  });
  await p.goto(`${w.url}/map/pr-iface`);
  await p
    .locator('[data-field="why"], article [data-role="why"]')
    .first()
    .getByRole("link", { name: "#al-diff" })
    .click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByText("Diff the alignment").first()).toBeVisible();
});

test("71.3 headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const text = [
    "# al-diff",
    "See https://example.com/page#al-diff for it.",
    "A span `#al-diff` here.",
    "```",
    "#al-diff",
    "```",
  ].join("\n\n");
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "doc-card", { body: text });
  });
  await p.goto(`${w.url}/map/doc-card`);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  await expect(body(p).locator("p").filter({ hasText: "example.com" }).locator('a[href="/map/al-diff"]')).toHaveCount(
    0,
  );
  await expect(body(p).locator("pre")).toContainText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "A span" }).locator('a[href="/map/al-diff"]');
  await expect(span).toHaveCount(1);
  await expect(span).toHaveText("#al-diff");
});

test("71.4 a tile summary holds no link, but a note on the open card does", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "ref-card", { title: "Ref card", why: "Follows up on #al-diff" });
  });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const note = p.locator('[data-section="thread"]').getByText("first").locator("xpath=..");
  await expect(p.locator('[data-section="thread"] a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(note).toBeVisible();
});

test("71.5 fenced json keeps indentation, highlights, and scrolls sideways", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const json = [
    "{",
    '    "outer": {',
    '        "inner": {',
    `            "long": "${"y".repeat(300)}"`,
    "        }",
    "    }",
    "}",
  ];
  const w = await project(undefined, (d) => card(d, "code-card", { body: ["```json", ...json, "```"].join("\n") }));
  await p.goto(`${w.url}/map/code-card`);
  const pre = body(p).locator("pre");
  await expect(pre).toHaveCount(1);
  expect((await textColours(pre)).length).toBeGreaterThanOrEqual(2);
  const shown = await pre.evaluate((el) => el.textContent ?? "");
  expect(shown.replace(/\n$/, "")).toBe(json.join("\n"));
  const ws = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(ws).toMatch(/pre/);
  const scroll = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const widths = await body(p).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(widths.inner).toBeLessThanOrEqual(widths.outer);
  const art = await p
    .locator("article")
    .first()
    .evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(art.inner).toBeLessThanOrEqual(art.outer);
});
