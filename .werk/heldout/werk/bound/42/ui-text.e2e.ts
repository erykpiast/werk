import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Werk, id: string, f: { title?: string; why?: string; body?: string } = {}) {
  w.seed("node.added", { id, kind: "card", title: f.title ?? id, parent: "root", ...f });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("[15.1] every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  const prose = await body(p).locator("p").evaluate((el) => {
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

test("[15.2] text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para.first()).toContainText(t);
    await expect(para.first().locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const nocard = body(p).locator("p", { hasText: "see #no-such-card" });
  await expect(nocard).toHaveText("see #no-such-card");
  await expect(nocard.locator("a")).toHaveCount(0);
  const url = body(p).locator("p", { hasText: "visit https://example.com/page#al-diff" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
});

test("[15.3] fenced code is boxed, labelled and highlighted", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
    ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. al-diff", "```"],
    ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const n = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(n).toBeGreaterThanOrEqual(2);
  const kw = ts.locator(".tok-kw").first();
  await expect(kw).toHaveText("const");
  expect(await colour(kw)).not.toBe(await colour(ts.locator("code")));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const s = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ov: getComputedStyle(el).overflowX }));
  expect(s.inner).toBeGreaterThan(s.outer);
  expect(["auto", "scroll"]).toContain(s.ov);
  const pg = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(pg.scroll).toBeLessThanOrEqual(pg.client);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("[15.4] a script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as any).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("del")).toHaveText("gone");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("[15.5] references link in chat but not in a tile summary", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "msg-1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2500 },
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
            { event: { type: "assistant", message: { id: "msg-1", content: [{ type: "text", text: head + tail }] } } },
          ],
        ],
      },
    },
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
  await expect(reply.locator(".codebox code")).toContainText('{"card": "al-diff", "depth": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = new Set([await colour(reply.locator(".tok-key").first()), await colour(reply.locator(".tok-str").first()), await colour(code)]);
  expect(colours.size).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

test("[71.1] known card ids link, others stay plain", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", { body: "Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and `node src/cli.ts show #al-diff`." });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  const hrefs = await links.evaluateAll((as) => as.map((a) => `${a.getAttribute("href")}|${a.textContent}`));
  console.log("LINKS", hrefs);
  expect(hrefs.filter((h) => h.startsWith("/map/al-diff")).length).toBe(2);
  expect(hrefs.some((h) => h.includes("ghost-card"))).toBe(false);
  expect(hrefs.some((h) => h.startsWith("/map/align"))).toBe(false);
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code.locator("a")).toHaveCount(0);
  await expect(body(p)).toContainText("#ghost-card");
  await expect(body(p)).toContainText("bare word align");
});

test("[71.2] a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Alignment diff", why: "Diff the alignment" });
  card(w, "pr-iface", { title: "Interface", why: "Shares the diff, see #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Alignment diff");
  await expect(p.locator('[data-field="why"]')).toContainText("Diff the alignment");
});

test("[71.3] headings, URL fragments, fences keep their form", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", { body: "# al-diff\n\nSee https://example.com/page#al-diff here.\n\nA span `#al-diff` here.\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const url = body(p).locator("p", { hasText: "example.com" });
  await expect(url.locator("a")).toHaveCount(0);
  const fence = body(p).locator(".codebox");
  await expect(fence).toContainText("#al-diff");
  await expect(fence.locator("a")).toHaveCount(0);
  const span = body(p).locator("p", { hasText: "A span" }).locator("a");
  await expect(span).toHaveCount(1);
  await expect(span).toHaveAttribute("href", "/map/al-diff");
});

test("[71.4] a tile summary holds no link, a thread note does", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { title: "Ref", why: "Follows up on #al-diff" });
  w.seed("note.added", { id: "ref-card", text: "See al-diff first" });
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ref");
  await expect(p.locator('[data-section="thread"] a[href="/map/al-diff"]')).toContainText("al-diff");
});

test("[71.5] fenced json keeps its indentation and scrolls", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": {\n            "c": 1\n        }\n    },\n    "long": "${"y".repeat(300)}"\n}`;
  card(w, "code-card", { body: `Intro text.\n\n\`\`\`json\n${json}\n\`\`\`\n\nOutro text.` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  await expect(box.locator(".tok-key").first()).toBeVisible();
  const text = await box.locator("code").textContent();
  expect(text).toBe(json);
  expect(text).toContain('\n            "c": 1');
  const pre = box.locator("pre");
  const m = await pre.evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ov: getComputedStyle(el).overflowX }));
  expect(m.inner).toBeGreaterThan(m.outer);
  expect(["auto", "scroll"]).toContain(m.ov);
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const art = await p.locator("article").boundingBox();
  const bb = await body(p).boundingBox();
  expect((bb?.x ?? 0) + (bb?.width ?? 0)).toBeLessThanOrEqual((art?.x ?? 0) + (art?.width ?? 0) + 1);
});
