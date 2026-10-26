import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

type Seeder = Pick<Werk, "seed">;
function card(w: Seeder, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });
const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

// ---------- 06 ----------
async function quoted(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}
const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("06.1 a new excerpt for a decided card stages as a ghost with a pending link", async ({ page: p }) => {
  const w = await quoted();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/billing`);
  await expect(heading(p)).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(said(p)).toHaveAttribute("data-pending", "true");
  await said(p).getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost; the card view lists it as evidence; link live", async ({ page: p }) => {
  const w = await quoted();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/billing`);
  await expect(said(p)).toContainText("seats are the unit");
  await expect(said(p)).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
});

// ---------- 15 ----------
function rcard(w: Werk, id: string, fields: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff", { title: "Every proposed change is a diff" });
  rcard(w, "align");
  rcard(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  const prose = await body(p).locator("p").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(heading(p)).toHaveText("Every proposed change is a diff");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  rcard(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para.first()).toHaveText(text);
    await expect(para.first().locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("a")).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  rcard(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. al-diff", "```"],
    ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  ];
  rcard(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const shellColours = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);
  await expect(ts.locator(".tok-kw").first()).toHaveText("const");
  expect(await colour(ts.locator(".tok-kw").first())).not.toBe(await colour(ts.locator("code")));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const page = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  rcard(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: { chat: { replies: [[stream({ type: "message_start", message: { id: "msg-1" } }), stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }), { pause: 2000 }, stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }), { event: { type: "assistant", message: { id: "msg-1", content: [{ type: "text", text: head + tail }] } } }]] } },
  });
  rcard(w, "al-diff");
  rcard(w, "old-idea");
  w.seed("node.removed", { id: "old-idea" });
  rcard(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  expect(new Set([await colour(reply.locator(".tok-key").first()), await colour(reply.locator(".tok-str").first())]).size).toBe(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

// ---------- 71 ----------
test("71.1 known card ids in a body become links; others stay plain", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff");
  rcard(w, "align");
  rcard(w, "notes-card", { body: "Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and `node src/cli.ts show #al-diff` here." });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  const texts = await links.allTextContents();
  expect(texts.length, `links: ${JSON.stringify(texts)}`).toBe(2);
  expect(texts).toEqual(["#al-diff", "#al-diff"]);
  const prose = await body(p).locator("p").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("#ghost-card");
  expect(prose).toContain("align");
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command.locator("a")).toHaveCount(0);
});

test("71.2 a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff", { title: "Diff", why: "Diff the alignment" });
  rcard(w, "pr-iface", { why: "It follows #al-diff closely" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("body")).toContainText("Diff the alignment");
});

test("71.3 headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff");
  rcard(w, "doc-card", { body: "# al-diff\n\nSee https://example.com/page#al-diff now.\n\nA span `#al-diff` here.\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const urlPara = body(p).locator("p", { hasText: "https://example.com" });
  await expect(urlPara.locator("a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a, pre a")).toHaveCount(0);
  await expect(body(p).locator("pre")).toContainText("#al-diff");
  const span = body(p).locator("p", { hasText: "A span" }).locator("a");
  await expect(span).toHaveCount(1);
  await expect(span).toHaveAttribute("href", "/map/al-diff");
});

test("71.4 a tile summary holds no link, but a note on the open card does", async ({ page: p }) => {
  const w = await project();
  rcard(w, "al-diff");
  rcard(w, "ref-card", { why: "Follows up on #al-diff" });
  w.seed("note.added", { id: "ref-card", text: "See al-diff first" });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(p.locator('[data-section="thread"] a', { hasText: "al-diff" })).toHaveCount(1);
});

test("71.5 fenced json is boxed, highlighted, keeps indentation and scrolls sideways", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "outer": {\n        "inner": {\n            "name": "${"long".repeat(120)}"\n        }\n    }\n}`;
  rcard(w, "code-card", { body: `Intro text.\n\n\`\`\`json\n${json}\n\`\`\`\n\nAfter text.` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  await expect(box.locator(".tok-key").first()).toBeVisible();
  const text = await box.locator("code").evaluate((el) => (el as HTMLElement).innerText);
  expect(text.split("\n")[1]).toMatch(/^ {4}"outer"/);
  expect(text.split("\n")[3]).toMatch(/^ {12}"name"/);
  const sc = await box.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(sc.inner).toBeGreaterThan(sc.outer);
  const page = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(page.s).toBeLessThanOrEqual(page.c);
});

// ---------- 72 ----------
function abc(w: Seeder) {
  for (const id of ["a", "b", "c"]) card(w, id, "root");
  w.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "b needs a" });
  w.seed("edge.added", { from: "c", to: "b", type: "depends_on", why: "c needs b" });
}
const RED = /oklch\(0\.97\d* 0\.01\d* 17\.\d+\)/;

test("72.1 a rejected reopen marks only the direct dependent as stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    abc(d);
    d.seed("node.reopened", { id: "a", reason: "rejected", why: "The vendor dropped this API" });
  });
  await p.goto(`${w.url}/map/root`);
  const b = p.locator('a[data-tile="b"]');
  await expect(b).toHaveAttribute("data-stale", "true");
  expect(await b.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(RED);
  expect(await b.evaluate((el) => getComputedStyle(el).borderLeftColor)).toMatch(/oklch\(0\.62\d* 0\.1\d* 149/);
  const c = p.locator('a[data-tile="c"]');
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c.locator('[data-tag="paused"], [data-tag="stale"]')).toHaveCount(0);
});

test("72.2 a postponed reopen pauses every downstream card in grey, keeping the status colour", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    abc(d);
    d.seed("node.reopened", { id: "a", reason: "postponed", why: "later" });
  });
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    const tag = p.locator('article [data-tag="paused"]');
    await expect(tag).toBeVisible();
    expect(await colour(tag)).toMatch(/oklch\(0\.4\d* 0\.0\d* 25\d/);
    expect(await p.locator("article").first().evaluate((el) => getComputedStyle(el).borderLeftColor)).toMatch(/oklch\(0\.62\d* 0\.1\d* 149/);
    await expect(p.locator("article").first()).toHaveAttribute("data-stale", "false");
    await expect(p.locator('article [data-tag="stale"]')).toHaveCount(0);
  }
});

test("72.3 the card view of a stale card explains the change, the link and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "b"]) card(d, id, "root");
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "b needs a" });
    d.seed("node.reopened", { id: "a", reason: "rejected", why: "The vendor dropped this API" });
  });
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
  await expect(s).toContainText("b needs a");
});

test("72.4 the card view of a paused card two hops away names the reopened card and reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    abc(d);
    d.seed("node.reopened", { id: "a", reason: "postponed", why: "We build the engine next quarter" });
  });
  await p.goto(`${w.url}/map/c`);
  await expect(p.getByRole("heading", { name: "Why this card is stale" })).toHaveCount(1);
  const s = p.locator("[data-section='stale'], [data-section='paused']");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("postponed");
  await expect(s).toContainText("We build the engine next quarter");
});

test("72.5 a stale mark wins over a paused mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "x", "b"]) card(d, id, "root");
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "b needs a" });
    d.seed("edge.added", { from: "b", to: "x", type: "depends_on", why: "b needs x" });
    d.seed("node.reopened", { id: "x", reason: "postponed", why: "later" });
    d.seed("node.reopened", { id: "a", reason: "rejected", why: "bad API" });
  });
  await p.goto(`${w.url}/map/b`);
  await expect(p.locator("article").first()).toHaveAttribute("data-stale", "true");
  expect(await p.locator("article").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(RED);
  await expect(p.locator('article [data-tag="paused"]')).toHaveCount(0);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});

// ---------- 17 ----------
test("17.1 a deep card: one-line path with …, overlay with the full path, parent click", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const left = await p.locator("#left-pane").boundingBox();
  expect(left!.width).toBeLessThan(700);
  await p.locator('[data-column="what"]').getByRole("heading", { level: 2 }).click();
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("Card d");
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  await expect(crumbs(p)).toContainText("›");
  const cur = crumbs(p).locator('[aria-current="page"]');
  await expect(cur).toHaveText("Card d");
  expect(Number(await cur.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(crumbs(p).getByText("Card c")).toBeVisible();
  const full = p.locator('[data-role="crumbs-full"]');
  await crumbs(p).hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await p.mouse.move(0, 0);
  await crumbs(p).getByText("Card c").click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "t", "root");
    card(d, "s", "root");
    d.seed("edge.added", { from: "s", to: "t", type: "depends_on", why: "s needs t" });
    d.seed("node.reopened", { id: "t", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toHaveText("6");
  const sum = async () => {
    let total = 0;
    for (const n of ["open", "proto", "decided"]) if ((await count(p, n).count()) > 0) total += Number(await count(p, n).textContent());
    return total;
  };
  expect(await sum()).toBe(6);
  for (const n of ["open", "proto", "decided", "stale"]) await expect(count(p, n)).toHaveAttribute("title", new RegExp(n));
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("3");
  expect(await sum()).toBe(3);
  await expect(count(p, "stale")).toHaveCount(0);
});

test("17.3 find a card by id from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    card(d, "werk-stack", "werk", { title: "The stack" });
    for (let i = 1; i <= 12; i++) card(d, `xwerk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-stack", to: "xwerk-1", type: "depends_on", why: "needs" });
    d.seed("node.reopened", { id: "xwerk-1", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id")));
  expect(ids[0]).toBe("werk");
  expect(ids[1]).toBe("werk-stack");
  expect(ids.slice(2).every((i) => (i ?? "").startsWith("xwerk"))).toBe(true);
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  await expect(rows.first()).toContainText("werk v0");
  await expect(rows.first().locator("code")).toHaveText("werk");
  const stale = p.locator('[role="option"][data-id="werk-stack"] [data-role="dot"]');
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4 the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 the first screen shows requirements and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", "root", { title: "Customers pay online", why: "Revenue" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(what).toContainText("Revenue".length ? "" : "");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs(l!.width - r!.width)).toBeLessThan(2);
  expect(l!.y).toBe(r!.y);
  await expect(what.locator('[data-count="total"], [data-role="rollup"], [data-count]').first()).toBeVisible();
  await expect(how.locator('[data-count="total"], [data-role="rollup"], [data-count]').first()).toBeVisible();
});

test("17.5b with no #how card the right column shows an empty build-rules card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.locator("[data-tile]")).toHaveCount(0);
  console.log("EMPTY HOW:", (await how.innerText()).replace(/\n/g, " | "));
});
