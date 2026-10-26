/// <reference lib="dom" />
// Held-out steps 15.1-15.5: the rendered card text and chat text in a real browser.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
const body = (p: Page) => p.locator('[data-field="body"]');
const card = (w: Werk, id: string, fields: Record<string, string> = {}) =>
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Al diff card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  const diff = body(p).locator('a[href="/map/al-diff"]');
  await expect(diff).toHaveCount(4);
  await expect(diff).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diff.all()) {
    const font = await a.evaluate((el) => {
      const inner = el.querySelector("code") ?? el;
      return getComputedStyle(inner).fontFamily;
    });
    expect(font).toMatch(/mono/i);
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(links).toHaveCount(5);
  const plain = await body(p)
    .locator("p")
    .evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
      return c.textContent ?? "";
    });
  expect(plain).toContain("then");
  expect(plain).toContain("and");
  await diff.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
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
    "A real one: #al-diff",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6").filter({ hasText: "al-diff" });
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const real = body(p).locator("p").filter({ hasText: "A real one" }).locator("a");
  await expect(real).toHaveAttribute("href", "/map/al-diff");
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"long ".repeat(120)}#al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, long] = [0, 1, 2, 3].map((i) => boxes.nth(i));
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const name = ts.locator("code span", { hasText: /^n$/ });
  const nColour = (await name.count()) > 0 ? await colour(name.first()) : await colour(ts.locator("code"));
  expect(await colour(kw)).not.toBe(nColour);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobolColours).toBe(1);
  const s = await long.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(s.inner).toBeGreaterThan(s.outer);
  expect(["auto", "scroll"]).toContain(s.ox);
  const doc = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(doc[0]).toBeLessThanOrEqual(doc[1] as number);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(long.locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).locator("strong, b");
  await expect(bold).toHaveText("bold");
  expect(Number(await bold.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s");
  await expect(gone).toHaveText("gone");
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const head = 'Sure:\n```json\n{"a": "b", "n": ';
  const tail = '1}\n```';
  const ev = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            ev({ type: "message_start", message: { id: "m1" } }),
            ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2500 },
            ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
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
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine.locator("a")).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"a": "b", "n": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"a": "b", "n": 1}');
  const cols = new Set([
    await colour(reply.locator(".codebox code span").first()),
    ...(await reply.locator(".codebox code span").evaluateAll((els) => els.map((e) => getComputedStyle(e).color))),
  ]);
  expect(cols.size).toBeGreaterThanOrEqual(2);
  const tile = p.locator('[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
