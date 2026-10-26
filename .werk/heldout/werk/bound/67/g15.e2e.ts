// Held-out steps 15.1-15.5: card references, code fences and safe text in the browser.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const card = (w: Werk, id: string, fields: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
const colour = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff rendering card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(4);
  await expect(al).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await al.all()) {
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const plain = await body(p).evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(plain).toContain("then");
  expect(plain).toContain("and");
  await al.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Diff rendering card");
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
    "Also #al-diff here.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "#no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: t }).first();
    await expect(para).toContainText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = body(p).locator("p").filter({ hasText: "Also" }).locator("a");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
  await expect(own).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
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
    `${"word ".repeat(120)}#al-diff`,
    "```",
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (text: string) => body(p).locator(".codebox").filter({ hasText: text });
  const zsh = box("echo $HOME");
  await expect(zsh).toContainText("zsh");
  const zshColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(zshColours).toBeGreaterThanOrEqual(2);
  const ts = box("const n");
  const kw = ts.locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const name = ts.locator("code span", { hasText: /^n$/ });
  const nameColour = (await name.count()) > 0 ? await colour(name.first()) : await colour(ts.locator("code"));
  expect(await colour(kw)).not.toBe(nameColour);
  const cobol = box("DISPLAY");
  await expect(cobol).toContainText("cobol");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobolColours).toBe(1);
  const long = box("word word");
  const s = await long.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(s.inner).toBeGreaterThan(s.outer);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(body(p).locator("pre a")).toHaveCount(0);
  await expect(long.locator("code")).toContainText("#al-diff");
});

test("15.4 a script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Sure:\n```json\n{"name": "werk", "count": ';
  const tail = '3, "ok": true}\n```';
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
  await p.goto(`${w.url}/map/root`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);

  const reply = pane.locator(".msg.agent");
  const label = reply.locator(".codebox .codebox-tag");
  await expect(label).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"name": "werk", "count": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"name": "werk", "count": 3, "ok": true}');
  const colours = await reply
    .locator(".codebox code span")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
