// Held-out binder F: browser rendering steps 15.x and 71.x.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const why = (p: Page) => p.locator('[data-field="why"]');

function card(w: Pick<Werk, "seed">, id: string, fields: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}

const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

/** The text of an element with every link inside it taken out. */
const textWithoutLinks = (at: Locator) =>
  at.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every change is a diff" });
  card(w, "align", { title: "The align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);

  const alDiff = body(p).locator("a").filter({ hasText: "#al-diff" });
  await expect(alDiff).toHaveCount(4);
  await expect(alDiff).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await alDiff.all()) {
    const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono/);
  }
  const align = body(p)
    .locator("a")
    .filter({ hasText: /^#align$/ });
  await expect(align).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await textWithoutLinks(body(p));
  expect(prose).toContain("then");
  expect(prose).toContain("and");

  await alDiff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every change is a diff");
});

test("15.2", async ({ page: p }) => {
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
    "Here #al-diff stands alone.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);

  for (const text of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveCount(1);
    await expect(para).toContainText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const ghost = body(p).locator("p").filter({ hasText: "#no-such-card" });
  await expect(ghost).toContainText("see #no-such-card");
  await expect(ghost.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const alone = body(p).locator("p").filter({ hasText: "stands alone" }).locator("a");
  await expect(alone).toHaveCount(1);
  await expect(alone).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```", ""],
    ...["```TypeScript", "const n: number = 1", "```", ""],
    ...["```cobol", "DISPLAY 'HELLO'.", "```", ""],
    ...["```", `${"word ".repeat(120)}#al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);

  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const codeboxes = body(p).locator(".codebox");
  await expect(codeboxes).toHaveCount(4);
  const [zsh, ts, cobol, long] = [0, 1, 2, 3].map((i) => codeboxes.nth(i)) as [Locator, Locator, Locator, Locator];

  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);

  const constWord = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(constWord).toHaveText("const");
  const nColour = await ts.locator("code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? "").search(/\bn\b/);
      if (at >= 0) return getComputedStyle(node.parentElement as Element).color;
    }
    return "missing";
  });
  expect(await colour(constWord)).not.toBe(nColour);

  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
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

  await expect(long.locator("code")).toContainText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);

  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  const weight = await bold.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(weight).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const head = 'Sure:\n```json\n{"name": "al-diff", "count": ';
  const tail = '3, "ok": true}\n```\nDone.';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "m-1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2500 },
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
            { event: { type: "assistant", message: { id: "m-1", content: [{ type: "text", text: head + tail }] } } },
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
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);

  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"name": "al-diff", "count": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"name": "al-diff", "count": 3, "ok": true}');
  const colours = await code
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});

test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", {
    body: "First #al-diff. Then #ghost-card. Then al-diff alone. Then align alone. Run `node src/cli.ts show #al-diff`.",
  });
  await p.goto(`${w.url}/map/notes-card`);

  const links = body(p).locator('a[href="/map/al-diff"]');
  await expect(links).toHaveCount(2);
  await expect(body(p).locator("a")).toHaveCount(2);
  const prose = await textWithoutLinks(body(p));
  expect(prose).toContain("#ghost-card");
  expect(prose).toContain("align alone");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  await expect(body(p).locator('a[href*="ghost-card"]')).toHaveCount(0);
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
  card(w, "pr-iface", { title: "PR interface", why: "It builds on #al-diff." });
  await p.goto(`${w.url}/map/pr-iface`);

  const link = why(p).locator("a", { hasText: "#al-diff" });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Alignment diff");
  await expect(p.getByText("Diff the alignment").first()).toBeVisible();
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", {
    body: [
      "# al-diff",
      "",
      "See https://example.com/page#al-diff for more.",
      "",
      "The span `#al-diff` names it.",
      "",
      "```",
      "#al-diff",
      "```",
    ].join("\n"),
  });
  await p.goto(`${w.url}/map/doc-card`);

  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("pre code")).toHaveText("#al-diff");
  await expect(body(p).locator("pre a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: "names it" }).locator("a");
  await expect(span).toHaveCount(1);
  await expect(span).toHaveAttribute("href", "/map/al-diff");
});

test("71.4", async ({ page: p }) => {
  const w = await project({ roles: {} }, (b) => {
    card(b, "al-diff");
    card(b, "ref-card", { title: "Ref card", why: "Follows up on #al-diff" });
    b.werk("say", "ref-card", "See al-diff first");
  });
  await p.goto(`${w.url}/map`);

  const tile = p.locator('[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ref card");
  const note = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "first" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const lines = [
    "{",
    '    "outer": {',
    '        "inner": {',
    '            "value": 1',
    "        },",
    `        "long": "${"abcdefghij".repeat(40)}END"`,
    "    }",
    "}",
  ];
  card(w, "code-card", {
    body: ["Before the code.", "", "```json", ...lines, "```", "", "After the code."].join("\n"),
  });
  await p.goto(`${w.url}/map/code-card`);

  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const colours = await box
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const text = await box.locator("code").evaluate((el) => el.textContent ?? "");
  expect(text.replace(/\n$/, "").split("\n")).toEqual(lines);
  const ws = await box.locator("pre").evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(ws).toMatch(/^pre/);

  const pre = box.locator("pre");
  const scroll = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

  const field = await body(p).evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(field.inner).toBeLessThanOrEqual(field.outer);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
});
