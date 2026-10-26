// Held-out: rendered card text (steps 15.x and 71.x).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Pick<Werk, "seed">, id: string, f: { title?: string; why?: string; body?: string } = {}) {
  w.seed("node.added", { id, kind: "card", title: f.title ?? id, parent: "root", ...f });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diffLinks.all()) {
    const fam = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(fam).toContain("monospace");
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll("a").forEach((a) => a.remove());
    return c.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator('article[data-card="al-diff"]')).toBeVisible();
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t }).first();
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toBeVisible();
  await expect(code.locator("a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "see #no-such-card" })).toHaveText("see #no-such-card");
  await expect(body(p).locator("p", { hasText: "see #no-such-card" }).locator("a")).toHaveCount(0);
  const url = body(p).locator("p", { hasText: "https://example.com" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(1);
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted", async ({ page: p }) => {
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
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => boxes.nth(i));
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const n = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(n).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  const name = ts.locator("code span", { hasText: /^n$/ });
  const kwC = await colour(kw);
  const nameC = (await name.count()) > 0 ? await colour(name.first()) : await colour(ts.locator("code"));
  expect(kwC).not.toBe(nameC);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const sc = await plain.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(sc.i).toBeGreaterThan(sc.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveText("gone");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat but not in a grid tile", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const ev = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: { chat: { replies: [[
      ev({ type: "message_start", message: { id: "m1" } }),
      ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
      { pause: 2000 },
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
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
  const n = await reply.locator(".codebox code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(n).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

test("71.1 known ids become links, other text stays plain", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", { body: 'Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and `node src/cli.ts show #al-diff`.' });
  await p.goto(`${w.url}/map/notes-card`);
  const prose = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll("code").forEach((x) => x.remove());
    return c.innerHTML;
  });
  const diffLinks = body(p).locator('p a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(2);
  await expect(body(p).locator('a[href="/map/ghost-card"]')).toHaveCount(0);
  expect(prose).toContain("#ghost-card");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toBeVisible();
  await expect(code.locator("a")).toHaveCount(0);
});

test("71.2 a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { why: "Diff the alignment" });
  card(w, "pr-iface", { why: "Builds on #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p.locator('article[data-card="al-diff"]')).toBeVisible();
  await expect(p.locator('article[data-card="al-diff"]')).toContainText("Diff the alignment");
});

test("71.3 headings, URL fragments, fences keep their form", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", { body: "# al-diff\n\nsee https://example.com/page#al-diff\n\nspan `#al-diff` here\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "example.com" }).locator("a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  await expect(body(p).locator(".codebox")).toContainText("#al-diff");
  const span = body(p).locator('p a[href="/map/al-diff"]');
  await expect(span).toHaveCount(1);
  await expect(span).toHaveText("#al-diff");
});

test("71.4 grid tile summary holds no link, but a note does", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p.locator('article[data-card="ref-card"]')).toBeVisible();
  await expect(p.locator('[data-section="thread"] a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5 json fence is boxed, highlighted, keeps indentation, scrolls", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 700 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": {\n            "c": 1\n        }\n    },\n    "long": "${"y".repeat(300)}"\n}`;
  card(w, "code-card", { body: `Intro\n\n\`\`\`json\n${json}\n\`\`\`` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  const n = await box.locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(await box.locator("code").evaluate((el) => (el as HTMLElement).textContent)).toBe(json);
  const sc = await box.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(sc.i).toBeGreaterThan(sc.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  const bw = await body(p).evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(bw).toBe(true);
});
