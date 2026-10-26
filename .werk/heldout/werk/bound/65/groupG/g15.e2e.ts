// Held-out steps 15.1–15.5: rendered card text and chat references.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);
const mono = (at: Locator) =>
  at.evaluate((el) => {
    const inner = el.querySelector("code") ?? el;
    return getComputedStyle(inner).fontFamily;
  });

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "AL diff card" });
  card(w, "align", { title: "Align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(4);
  await expect(al).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await al.all()) expect(await mono(a)).toMatch(/mono/i);
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  const linkText = (await body(p).locator("a").allTextContents()).join(" ");
  expect(linkText).not.toMatch(/\bthen\b|\band\b/);
  await expect(body(p)).toContainText("then");
  await al.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("AL diff card");
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
    "#al-diff",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  const none = body(p).locator("p").filter({ hasText: "see #no-such-card" });
  await expect(none).toHaveText("see #no-such-card");
  await expect(none.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = body(p).locator('a[href="/map/al-diff"]');
  await expect(own).toHaveCount(1);
  await expect(own).toHaveText("#al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
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
    `${"y".repeat(500)} #al-diff`,
    "```",
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator(".codebox").nth(i);
  await expect(body(p).locator(".codebox")).toHaveCount(4);
  await expect(box(0).locator(".codebox-tag")).toHaveText("zsh");
  await expect(box(0).locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await box(0)
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const nameColour = await box(1)
    .locator("code")
    .evaluate((code) => {
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/(^|\s)n(\s|:|$)/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
      }
      return `not found: ${code.innerHTML}`;
    });
  expect(nameColour).not.toMatch(/^not found/);
  expect(await colour(kw)).not.toBe(nameColour);
  await expect(box(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(box(2).locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await box(2)
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  const scroll = await box(3).locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.ox);
  const page = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(page.s).toBeLessThanOrEqual(page.c);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  await expect(box(3).locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "n": ';
  const tail = '2, "ok": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "m1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 3000 },
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
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "n": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "n": 2, "ok": true}');
  const colours = await reply
    .locator(".codebox code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
