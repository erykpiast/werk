// Held-out: steps 15.1–15.5 (card references, guards, code fences, unsafe text, chat and tiles).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: (fields.title as string) ?? id, parent: "root", ...fields });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  const diff = body(p).locator('a[href="/map/al-diff"]');
  await expect(diff).toHaveCount(4);
  for (const a of await diff.all()) {
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every change is a diff");
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
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "https://example.com/page#al-diff" });
  await expect(url).toContainText("visit https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = body(p).locator('a[href="/map/al-diff"]');
  await expect(own).toHaveCount(1);
  await expect(own).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    "```zsh", "echo $HOME | grep -v x", "```", "",
    "```TypeScript", "const n: number = 1", "```", "",
    "```cobol", "DISPLAY 'HELLO'.", "```", "",
    "```", `${"wide ".repeat(100)}#al-diff`, "```",
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator(".codebox").nth(i);
  await expect(body(p).locator(".codebox")).toHaveCount(4);
  await expect(box(0)).toContainText("zsh");
  await expect(box(0).locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await box(0).locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const ts = box(1).locator("code");
  const kw = ts.locator("span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  const name = await ts.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (/\bn\b/.test(n.textContent ?? "") && !/number/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) return "";
    return getComputedStyle(el).color;
  });
  expect(await colour(kw)).not.toBe(name);
  await expect(box(2)).toContainText("cobol");
  const cobolColours = await box(2).locator("code, code *").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(cobolColours).toBe(1);
  const scroll = await box(3).locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.x);
  const doc = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(doc.s).toBeLessThanOrEqual(doc.c);
  await expect(box(3).locator("code")).toContainText("#al-diff");
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            stream({ type: "message_start", message: { id: "m1" } }),
            stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
            stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
            { pause: 2000 },
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
  card(w, "tile-card", { title: "Tile card", body: "Depends on #al-diff", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox")).toContainText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = await reply.locator(".codebox code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
