// Held-out steps 15.x, 71.x, 72.x: card text rendering, references, code boxes, stale and paused marks.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

type Seed = Pick<Werk, "seed">;
function card(w: Seed, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const dep = (w: Seed, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} takes from ${to}` });

const body = (p: Page) => p.locator('article [data-field="body"]');
const color = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);
const font = (at: Locator) => at.evaluate((el) => getComputedStyle(el).fontFamily);

// ---------- 15.1 ----------
test("15.1 every form of a reference becomes the same link", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "align", { title: "Alignment" });
    card(d, "notes-test", {
      title: "Notes test",
      body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.",
    });
  });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator('a[href="/map/al-diff"]');
  await expect(links).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(links.nth(i)).toHaveText("#al-diff");
    expect(await font(links.nth(i).locator("code"))).toMatch(/mono|Menlo|Consolas/i);
  }
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  // "then" and "and" are not inside any link.
  const linkTexts = await body(p).locator("a").allTextContents();
  for (const t of linkTexts) expect(t).not.toMatch(/\bthen\b|\band\b/);
  await expect(body(p)).toContainText("then");
  await expect(body(p)).toContainText("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator('article[data-card="al-diff"]')).toBeVisible();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Alignment diff");
});

// ---------- 15.2 ----------
test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "guards", {
      title: "Guards",
      body: [
        "# al-diff",
        "",
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
        "#al-diff",
      ].join("\n"),
    });
  });
  await p.goto(`${w.url}/map/guards`);
  const para = (text: string) => body(p).locator("p").filter({ hasText: text });
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) {
    await expect(para(t)).toHaveCount(1);
    await expect(para(t)).toHaveText(t);
    await expect(para(t).locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  expect(await code.evaluate((el) => el.closest("a") === null)).toBe(true);
  await expect(para("see #no-such-card")).toHaveText("see #no-such-card");
  await expect(para("see #no-such-card").locator("a")).toHaveCount(0);
  const url = para("visit https://example.com/page#al-diff");
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(url.locator("a.ref")).toHaveCount(0);
  const heading = body(p).locator("h1");
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const alone = body(p).locator("p").filter({ hasText: /^#al-diff$/ });
  await expect(alone.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

// ---------- 15.3 ----------
const LONG = `echo ${"wide-text-".repeat(40)} #al-diff end`;
test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "code-sample", {
      title: "Code sample",
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
        LONG,
        "```",
      ].join("\n"),
    });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const zsh = boxes.nth(0);
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const zshCode = zsh.locator("code");
  const plain = await color(zshCode);
  const tokens = zsh.locator("code span");
  expect(await tokens.count()).toBeGreaterThan(0);
  const tokColors = await tokens.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  expect(tokColors.some((c) => c !== plain)).toBe(true);
  const ts = boxes.nth(1);
  await expect(ts.locator("code")).toHaveText("const n: number = 1");
  const kw = ts.locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  // "n" is plain text inside the code element: its colour is the code element's colour.
  const nColor = await ts.locator("code").evaluate((el) => {
    for (const node of el.childNodes)
      if (node.nodeType === 3 && /\bn\b/.test(node.textContent ?? "")) return getComputedStyle(el).color;
    const span = [...el.querySelectorAll("span")].find((s) => s.textContent === "n");
    return span ? getComputedStyle(span).color : "missing";
  });
  expect(nColor).not.toBe("missing");
  expect(await color(kw)).not.toBe(nColor);
  const cobol = boxes.nth(2);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const long = boxes.nth(3);
  const pre = long.locator("pre");
  const sizes = await pre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(sizes.sw).toBeGreaterThan(sizes.cw);
  expect(["auto", "scroll"]).toContain(sizes.ox);
  const page = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(page.sw).toBeLessThanOrEqual(page.w);
  await expect(long.locator("code")).toContainText("#al-diff");
  await expect(boxes.locator("a")).toHaveCount(0);
});

// ---------- 15.4 ----------
test("15.4 a script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    card(d, "unsafe", {
      title: "Unsafe",
      body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~",
    }),
  );
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(body(p).locator("script")).toHaveCount(0);
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("del")).toHaveText("gone");
  expect(await body(p).locator("strong").evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  expect(await body(p).locator("del").evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

// ---------- 15.5 ----------
const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });

test("15.5 references link in chat but not in a tile summary", async ({ page: p }) => {
  const first = 'Here it is:\n\n```json\n{"name": "al-diff",';
  const rest = ' "count": 2}\n```\n';
  const w = await project(
    { roles: { chat: { replies: [[start("m1"), open(first), { pause: 3000 }, more(rest), done("m1", first + rest)]] } } },
    (d) => {
      card(d, "al-diff", { title: "Alignment diff" });
      card(d, "old-idea", { title: "Old idea" });
      card(d, "tile-card", { title: "Tile card", why: "Depends on #al-diff" });
      d.werk("remove", "old-idea", "--actor", "you");
    },
  );
  await p.goto(`${w.url}/map`);
  await pane(p).getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane(p).getByRole("button", { name: "Send" }).click();
  const user = pane(p).locator(".msg.user");
  await expect(user).toContainText("Compare");
  await expect(user.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(user).toContainText("#old-idea");
  await expect(user.locator("a", { hasText: "old-idea" })).toHaveCount(0);
  await expect(user.locator('a[href*="old-idea"]')).toHaveCount(0);

  const agent = pane(p).locator(".msg.agent");
  const box = agent.locator(".codebox");
  await expect(box.locator(".codebox-tag")).toHaveText("json");
  await expect(box.locator("code")).toHaveText('{"name": "al-diff",');
  await expect(box.locator("code")).toHaveText('{"name": "al-diff", "count": 2}', { timeout: 10000 });
  await expect(box.locator(".codebox-tag")).toHaveText("json");
  const keys = box.locator("code .tok-key");
  await expect(keys).toHaveCount(2);
  expect(await color(keys.first())).not.toBe(await color(box.locator("code")));

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});

// ---------- 71.1 ----------
test("71.1 known ids link, other text stays plain", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "align", { title: "Alignment" });
    card(d, "notes-card", {
      title: "Notes card",
      body: "Read #al-diff and #ghost-card. The bare al-diff and the bare align. Run `node src/cli.ts show #al-diff`.",
    });
  });
  await p.goto(`${w.url}/map/notes-card`);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(2);
  await expect(body(p).locator("a", { hasText: "ghost-card" })).toHaveCount(0);
  await expect(body(p)).toContainText("#ghost-card");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  await expect(body(p)).toContainText("the bare align");
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  expect(await code.evaluate((el) => el.closest("a") === null)).toBe(true);
});

// ---------- 71.2 ----------
test("71.2 a click on a link in a why line opens that card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
    card(d, "pr-iface", { title: "PR interface", why: "It builds on #al-diff" });
  });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('article [data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator('article[data-card="al-diff"]')).toBeVisible();
  await expect(p.locator('article [data-field="why"]')).toHaveText("Diff the alignment");
});

// ---------- 71.3 ----------
test("71.3 headings, URL fragments and fences keep their form", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "doc-card", {
      title: "Doc card",
      body: ["# al-diff", "", "https://example.com/page#al-diff", "", "`#al-diff`", "", "```", "#al-diff", "```"].join("\n"),
    });
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p", { hasText: "https://example.com/page#al-diff" });
  await expect(url).toHaveCount(1);
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(url.locator("a.ref")).toHaveCount(0);
  const fence = body(p).locator(".codebox");
  await expect(fence.locator("code")).toHaveText("#al-diff");
  await expect(fence.locator("a")).toHaveCount(0);
  const span = body(p).locator("p").filter({ hasText: /^#al-diff$/ });
  await expect(span.locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

// ---------- 71.4 ----------
test("71.4 a tile summary holds no link, a note on the open card does", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff" });
    card(d, "ref-card", { title: "Ref card", why: "Follows up on #al-diff" });
    d.werk("say", "ref-card", "See al-diff first");
  });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(p.locator('article[data-card="ref-card"]')).toBeVisible();
  const thread = p.locator('[data-section="thread"]');
  await expect(thread).toContainText("See");
  await expect(thread.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

// ---------- 71.5 ----------
const JSON_CODE = [
  "{",
  '    "outer": {',
  '        "inner": {',
  '            "value": 1',
  "        },",
  `        "long": "${"x".repeat(400)}-end"`,
  "    }",
  "}",
].join("\n");
test("71.5 fenced json is boxed, highlighted, indented and scrolls", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    card(d, "code-card", { title: "Code card", body: `Before the code.\n\n\`\`\`json\n${JSON_CODE}\n\`\`\`\n\nAfter the code.` }),
  );
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  expect(await box.locator("code span[class^='tok-']").count()).toBeGreaterThan(0);
  expect(await box.locator("code").evaluate((el) => el.textContent)).toBe(JSON_CODE);
  expect(await box.locator("code").evaluate((el) => (el as HTMLElement).innerText)).toBe(JSON_CODE);
  const pre = box.locator("pre");
  const s = await pre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(s.sw).toBeGreaterThan(s.cw);
  await pre.hover();
  await p.mouse.wheel(5000, 0);
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)).toBe(true);
  const article = p.locator('article[data-card="code-card"]');
  const a = await article.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, w: el.getBoundingClientRect().width }));
  expect(a.sw).toBeLessThanOrEqual(a.cw);
  const bw = await body(p).evaluate((el) => el.getBoundingClientRect().width);
  expect(bw).toBeLessThanOrEqual(a.w);
});

// ---------- 72.x ----------
const tile = (p: Page, id: string) => p.locator(`a[data-tile="${id}"]`);
const bg = (at: Locator) => at.evaluate((el) => getComputedStyle(el).backgroundColor);
const edge = (at: Locator) => at.evaluate((el) => getComputedStyle(el).borderLeftColor);
const RED_TINT = /oklch\(0\.97\d* 0\.01\d* 17\.\d+\)/;
const GREEN_EDGE = /oklch\(0\.62\d* 0\.1\d* 149/;

async function openCard(p: Page, id: string): Promise<Locator> {
  await tile(p, id).click();
  await expect(p).toHaveURL(new RegExp(`/map/${id}$`));
  const box = p.locator(`article[data-card="${id}"]`);
  await expect(box).toBeVisible();
  return box;
}

test("72.1 a rejected reopen marks only the direct dependent stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "card-a", { title: "Card A" });
    card(d, "card-b", { title: "Card B" });
    card(d, "card-c", { title: "Card C" });
    dep(d, "card-b", "card-a");
    dep(d, "card-c", "card-b");
    d.werk("reopen", "card-a", "--reason", "rejected", "--why", "The vendor dropped this API");
  });
  await p.goto(`${w.url}/map`);
  await expect(tile(p, "card-b")).toHaveAttribute("data-stale", "true");
  expect(await bg(tile(p, "card-b"))).toMatch(RED_TINT);
  expect(await edge(tile(p, "card-b"))).toMatch(GREEN_EDGE);
  await expect(tile(p, "card-c")).toHaveAttribute("data-stale", "false");
  expect(await bg(tile(p, "card-c"))).not.toMatch(RED_TINT);
  const b = await openCard(p, "card-b");
  await expect(b.locator('[data-tag="stale"]')).toBeVisible();
  expect(await color(b.locator('[data-tag="stale"]'))).toMatch(/oklch\(0\.5\d* 0\.\d+ 2\d\.\d+\)|rgb\(1\d\d, \d\d?, \d\d?\)/);
  await expect(b.locator('[data-tag="status"]')).toHaveText("decided");
  expect(await edge(b)).toMatch(GREEN_EDGE);
  await p.goBack();
  const c = await openCard(p, "card-c");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c.locator('[data-tag="stale"]')).toHaveCount(0);
  await expect(c.locator('[data-tag="paused"]')).toHaveCount(0);
});

test("72.2 a postponed reopen marks every downstream card paused, in grey", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "card-a", { title: "Card A" });
    card(d, "card-b", { title: "Card B" });
    card(d, "card-c", { title: "Card C" });
    dep(d, "card-b", "card-a");
    dep(d, "card-c", "card-b");
    d.werk("reopen", "card-a", "--reason", "postponed", "--why", "We build the engine next quarter");
  });
  await p.goto(`${w.url}/map`);
  for (const id of ["card-b", "card-c"]) {
    await expect(tile(p, id)).toHaveAttribute("data-stale", "false");
    expect(await bg(tile(p, id))).not.toMatch(RED_TINT);
  }
  for (const id of ["card-b", "card-c"]) {
    const box = await openCard(p, id);
    const tag = box.locator('[data-tag="paused"]');
    await expect(tag).toBeVisible();
    const c = await color(tag);
    // grey: low chroma
    expect(c).toMatch(/oklch\(0\.\d+ 0\.0[0-4]\d* \d+|rgb\((\d+), \1, \1\)|oklch\(0\.\d+ 0 /);
    await expect(box.locator('[data-tag="stale"]')).toHaveCount(0);
    await expect(box).toHaveAttribute("data-stale", "false");
    await expect(box.locator('[data-tag="status"]')).toHaveText("decided");
    expect(await edge(box)).toMatch(GREEN_EDGE);
    await p.goBack();
  }
});

test("72.3 the card view of a stale card explains change, link and reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "card-a", { title: "Card A" });
    card(d, "card-b", { title: "Card B" });
    dep(d, "card-b", "card-a");
    d.werk("reopen", "card-a", "--reason", "rejected", "--why", "The vendor dropped this API");
  });
  await p.goto(`${w.url}/map`);
  await openCard(p, "card-b");
  const stale = p.locator('[data-section="stale"]');
  await expect(stale.locator("h2")).toHaveText("Why this card is stale");
  const trace = stale.locator('[data-trace="stale"]');
  await expect(trace.locator('[data-role="head"]')).toContainText("#card-a");
  await expect(trace.locator('[data-role="link"]')).toContainText("#card-b");
  await expect(trace.locator('[data-role="link"]')).toContainText("#card-a");
  await expect(trace.locator('[data-role="link"]')).toContainText("depends_on");
  await expect(trace).toContainText("rejected");
  await expect(trace).toContainText("The vendor dropped this API");
});

test("72.4 the card view of a paused card two hops away names the reopened card and reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "card-a", { title: "Card A" });
    card(d, "card-b", { title: "Card B" });
    card(d, "card-c", { title: "Card C" });
    dep(d, "card-b", "card-a");
    dep(d, "card-c", "card-b");
    d.werk("reopen", "card-a", "--reason", "postponed", "--why", "We build the engine next quarter");
  });
  await p.goto(`${w.url}/map`);
  await openCard(p, "card-c");
  await expect.soft(p.locator("main, body").getByRole("heading", { name: "Why this card is stale" })).toBeVisible();
  const section = p.locator('[data-section="stale"], [data-section="paused"]');
  await expect(section).toContainText("#card-a");
  await expect(section).toContainText("postponed");
  await expect(section).toContainText("We build the engine next quarter");
});

test("72.5 a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "card-a", { title: "Card A" });
    card(d, "card-x", { title: "Card X" });
    card(d, "card-b", { title: "Card B" });
    dep(d, "card-b", "card-a");
    dep(d, "card-b", "card-x");
    d.werk("reopen", "card-x", "--reason", "postponed", "--why", "Later");
    d.werk("reopen", "card-a", "--reason", "rejected", "--why", "Wrong vendor");
  });
  await p.goto(`${w.url}/map`);
  await expect(tile(p, "card-b")).toHaveAttribute("data-stale", "true");
  expect(await bg(tile(p, "card-b"))).toMatch(RED_TINT);
  const b = await openCard(p, "card-b");
  await expect(b.locator('[data-tag="stale"]')).toBeVisible();
  await expect.soft(b.locator('[data-tag="paused"]')).toHaveCount(0);
  const stale = p.locator('[data-section="stale"]');
  await expect(stale).toContainText("#card-a");
  await expect(stale).toContainText("rejected");
});
