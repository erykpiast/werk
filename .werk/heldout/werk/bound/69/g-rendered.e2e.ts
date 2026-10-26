// Held-out binding of steps 15.1-15.5: rendered card text, references and code fences.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Werk, id: string, fields: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: fields.title ?? id, parent: "root", ...fields });
}

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "AL diff card" });
  card(w, "align", { title: "Align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map`);
  await p.goto(`${w.url}/map/notes-test`);

  const links = body(p).locator("a");
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(4);
  for (const a of await body(p).locator('a[href="/map/al-diff"]').all()) {
    await expect(a).toHaveText("#al-diff");
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/mono/i);
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(links).toHaveCount(5);
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");

  await body(p).locator('a[href="/map/al-diff"]').nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("AL diff card");
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
  const ref = body(p).locator('a[href="/map/al-diff"]');
  await expect(ref).toHaveCount(1);
  await expect(ref).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);

  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];

  await expect(zsh).toContainText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);

  const constTok = ts.locator("code span", { hasText: /^const$/ });
  await expect(constTok).toHaveCount(1);
  const nTok = ts.locator("code span", { hasText: /^n$/ });
  const nColour = (await nTok.count()) > 0 ? await colour(nTok.first()) : await colour(ts.locator("code"));
  expect(await colour(constTok)).not.toBe(nColour);

  await expect(cobol).toContainText("cobol");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");

  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.x);
  const page = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(plain.locator("code")).toContainText("#al-diff");
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat but not in a grid tile summary", async ({ page: p }) => {
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
  await expect(mine).toContainText("#old-idea");
  await expect(mine.locator("a", { hasText: "old-idea" })).toHaveCount(0);

  const reply = pane.locator(".msg.agent");
  const box = reply.locator(".codebox");
  await expect(box).toContainText("json");
  await expect(box.locator("code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(box.locator("code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = await box.locator("code span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);

  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
});
