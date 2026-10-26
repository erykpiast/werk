import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Werk, id: string, fields: { title?: string; why?: string; body?: string; status?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);
const stream = (event: object) => ({ event: { type: "stream_event", event } });

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(4);
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
    "And #al-diff on its own.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("a")).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
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
  expect(await zsh.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size)).toBeGreaterThanOrEqual(2);
  await expect(ts.locator(".tok-kw").first()).toHaveText("const");
  expect(await colour(ts.locator(".tok-kw").first())).not.toBe(await colour(ts.locator("code")));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const page = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(page.s).toBeLessThanOrEqual(page.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 a script tag in card text is shown as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat but not in a tile summary", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "msg-1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2000 },
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
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  expect(await colour(reply.locator(".tok-key").first())).not.toBe(await colour(reply.locator(".codebox code")));
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

// ---- 71 ----
test("71.1 known card ids in a body become links, other text stays plain", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", {
    body: "Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and a code span `node src/cli.ts show #al-diff`",
  });
  await p.goto(`${w.url}/map/notes-card`);
  const b = body(p);
  await expect(b.locator('a[href="/map/al-diff"]').first()).toHaveText("#al-diff");
  expect(await b.locator('a[href="/map/al-diff"]').count()).toBe(2);
  await expect(b.locator('a[href="/map/ghost-card"]')).toHaveCount(0);
  await expect(b.locator('a[href="/map/align"]')).toHaveCount(0);
  await expect(b).toContainText("the bare word align");
  const code = b.locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveCount(1);
  await expect(code.locator("a")).toHaveCount(0);
});

test("71.2 a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff card", why: "Diff the alignment" });
  card(w, "pr-iface", { title: "Interface", why: "Uses #al-diff for changes" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("article")).toContainText("Diff the alignment");
});

test("71.3 headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", {
    body: "# al-diff\n\nSee https://example.com/page#al-diff here\n\nA code span `#al-diff` here\n\n```\n#al-diff\n```",
  });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "example.com" }).locator("a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  const spanLink = body(p).locator("p", { hasText: "A code span" }).locator('a[href="/map/al-diff"]');
  await expect(spanLink).toHaveCount(1);
});

test("71.4 a tile summary holds no link, a note on the open card does", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { why: "Follows up on #al-diff" });
  w.seed("note.added", { id: "ref-card", text: "See al-diff first" });
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(p.locator('[data-section="thread"] a[href="/map/al-diff"]')).toHaveText(/al-diff/);
});

test("71.5 fenced code is boxed, highlighted, and keeps its indentation", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "outer": {\n        "inner": {\n            "deep": true\n        }\n    },\n    "long": "${"x".repeat(500)}"\n}`;
  card(w, "code-card", { body: `Intro text.\n\n\`\`\`json\n${json}\n\`\`\`\n\nOutro text.` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  await expect(box.locator("[class*=tok-]").first()).toBeVisible();
  const text = await box.locator("code").evaluate((el) => (el as HTMLElement).innerText);
  expect(text).toContain('\n    "outer": {');
  expect(text).toContain('\n            "deep": true');
  const sc = await box.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(sc.inner).toBeGreaterThan(sc.outer);
  const bodyBox = await body(p).boundingBox();
  const art = await p.locator("article").boundingBox();
  expect((bodyBox?.width ?? 0) <= (art?.width ?? 0) + 1).toBe(true);
});
