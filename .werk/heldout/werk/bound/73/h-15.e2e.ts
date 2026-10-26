import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Al diff card" });
    card(d, "align");
    card(d, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  });
  await p.goto(`${w.url}/map/notes-test`);
  const toAl = body(p).locator('a[href="/map/al-diff"]');
  await expect(toAl).toHaveCount(4);
  for (const a of await toAl.all()) {
    await expect(a).toHaveText("#al-diff");
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toContain("mono");
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await toAl.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
});

test("15.2 text that only looks like a reference stays text", async ({ page: p }) => {
  const lines = [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card",
    "visit https://example.com/page#al-diff",
    "# al-diff",
    "Also #al-diff alone.",
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "guards", { body: lines.join("\n\n") });
  });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const alone = body(p).locator("p").filter({ hasText: "Also" }).locator("a");
  await expect(alone).toHaveAttribute("href", "/map/al-diff");
  await expect(alone).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
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
    `${"y".repeat(400)} #al-diff`,
    "```",
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "code-sample", { body: fences.join("\n") });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator(".codebox").nth(i);
  await expect(body(p).locator(".codebox")).toHaveCount(4);
  await expect(box(0)).toContainText("zsh");
  await expect(box(0).locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await box(0)
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const ts = box(1).locator("code");
  const constSpan = ts.locator("span", { hasText: /^const$/ }).first();
  const nSpan = ts.locator("span", { hasText: /^n$/ });
  const constColour = await colour(constSpan);
  const nColour = (await nSpan.count()) > 0 ? await colour(nSpan.first()) : await colour(ts);
  expect(constColour).not.toBe(nColour);
  await expect(box(2)).toContainText("cobol");
  await expect(box(2).locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await box(2)
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  const s = await box(3)
    .locator("pre")
    .evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(s.inner).toBeGreaterThan(s.outer);
  expect(["auto", "scroll"]).toContain(s.x);
  const pg = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(pg.scroll).toBeLessThanOrEqual(pg.client);
  await expect(body(p).locator("pre a")).toHaveCount(0);
});

test("15.4 a script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    card(d, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }),
  );
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const strong = body(p).locator("strong, b").filter({ hasText: "bold" });
  await expect(strong).toHaveCount(1);
  expect(Number(await strong.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s").filter({ hasText: "gone" });
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "n": ';
  const tail = '2, "ok": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project(
    {
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
    },
    (d) => {
      card(d, "al-diff");
      card(d, "old-idea");
      d.seed("node.removed", { id: "old-idea" });
      card(d, "tile-card", { title: "Tile card", why: "Depends on #al-diff" });
    },
  );
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
