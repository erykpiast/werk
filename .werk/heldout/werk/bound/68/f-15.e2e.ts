// Held-out steps 15.1–15.5: rendered card text.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: (fields.title as string) ?? id, parent: "root", ...fields });
}

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map`);
  await p.goto(`${w.url}/map/notes-test`);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(4);
  await expect(al).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await al.all()) {
    const font = await link.evaluate((el) => {
      const inner = el.querySelector("code") ?? el;
      return getComputedStyle(inner).fontFamily;
    });
    expect(font.toLowerCase()).toContain("mono");
  }
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await al.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Diff card");
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
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "visit https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const links = body(p).locator('a[href="/map/al-diff"]');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveText("#al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(kw).toHaveText("const");
  const nameColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (/(^|\s)n:/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    }
    return "none";
  });
  expect(nameColour).not.toBe("none");
  expect(await colour(kw)).not.toBe(nameColour);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(plain.locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  expect(
    Number(
      await body(p)
        .locator("strong")
        .evaluate((el) => getComputedStyle(el).fontWeight),
    ),
  ).toBeGreaterThanOrEqual(600);
  await expect(body(p).locator("del, s")).toHaveText("gone");
  await expect(body(p).locator("del, s")).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
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
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = await code
    .locator("span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
});
