import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
const body = (p: Page) => p.locator('[data-field="body"]');
const card = (w: Werk, id: string, f: { title?: string; why?: string; body?: string } = {}) =>
  w.seed("node.added", { id, kind: "card", title: f.title ?? id, parent: "root", ...f });
const colour = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);

test("15.1 / 71.1 forms of reference become links", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const c of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await c.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  const prose = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll("a").forEach((a) => a.remove());
    return c.textContent;
  });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
});

test("15.2 look-alike text stays text", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("a")).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code boxed, labelled, highlighted", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const f = ["```zsh", "echo $HOME | grep -v x #al-diff", "```", "```TypeScript", "const n: number = 1 // #al-diff", "```", "```cobol", "DISPLAY 'HELLO'. al-diff", "```", "```", `${"x".repeat(400)} #al-diff`, "```"];
  card(w, "code-sample", { body: f.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
  expect(await boxes.nth(0).locator("code span").evaluateAll((e) => new Set(e.map((x) => getComputedStyle(x).color)).size)).toBeGreaterThanOrEqual(2);
  const kw = boxes.nth(1).locator(".tok-kw").first();
  await expect(kw).toHaveText("const");
  const n = boxes.nth(1).locator("code span", { hasText: /^n$/ });
  const plainN = n.count() ? undefined : undefined;
  void plainN;
  expect(await colour(kw)).not.toBe(await colour(boxes.nth(1).locator("code")));
  await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const s = await boxes.nth(3).locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(s.i).toBeGreaterThan(s.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 script tag is text", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as any).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 chat refs link, tile does not", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: { chat: { replies: [[
      stream({ type: "message_start", message: { id: "m1" } }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
      { pause: 2000 },
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
      { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: head + tail }] } } },
    ]] } },
  });
  card(w, "al-diff");
  card(w, "old-idea");
  w.seed("node.removed", { id: "old-idea" });
  card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
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
  expect(await reply.locator(".codebox code span").count()).toBeGreaterThan(0);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

test("71.1b bare words and ghost id", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", { body: "Mentions #al-diff, #ghost-card, bare al-diff, bare align, and `node src/cli.ts show #al-diff`" });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff"]);
  await expect(links).toHaveCount(2);
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("p")).toContainText("#ghost-card");
  await expect(body(p).locator("p")).toContainText("bare align");
  await expect(body(p).locator("a", { hasText: "ghost" })).toHaveCount(0);
  await expect(body(p).locator("a", { hasText: "align" })).toHaveCount(0);
});

test("71.2 why-line link opens card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { why: "Diff the alignment" });
  card(w, "pr-iface", { why: "Builds on #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator('[data-field="why"]')).toContainText("Diff the alignment");
});

test("71.3 heading url fence code span", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", { body: "# al-diff\n\nhttps://example.com/page#al-diff\n\n`#al-diff`\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a, pre a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "https://example.com" }).locator("a")).toHaveCount(0);
  const links = body(p).locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
  await expect(links).toHaveText("#al-diff");
});

test("71.4 tile no link, thread link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const note = p.locator('[data-section="thread"] [data-entry="note"]');
  await expect(note.locator("a")).toHaveText(/al-diff/);
  await expect(note.locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("71.5 json fence indentation and scroll", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 700 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": {\n            "c": 1\n        }\n    },\n    "long": "${"y".repeat(500)}"\n}`;
  card(w, "code-card", { body: "```json\n" + json + "\n```\n\nAfter." });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  expect(await box.locator("code span").count()).toBeGreaterThan(0);
  const text = await box.locator("code").evaluate((el) => (el as HTMLElement).innerText);
  expect(text).toContain('\n            "c": 1\n');
  expect(text).toContain('\n    "a"');
  const pre = box.locator("pre");
  const r = await pre.evaluate((el) => { el.scrollLeft = 100000; return { sl: el.scrollLeft, i: el.scrollWidth, o: el.clientWidth }; });
  expect(r.i).toBeGreaterThan(r.o);
  expect(r.sl).toBeGreaterThan(0);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  const art = await body(p).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(art.s).toBeLessThanOrEqual(art.c);
});
