import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Alignment diff card" });
    card(d, "align");
    card(d, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  });
  await p.goto(`${w.url}/map/notes-test`);
  const al = body(p).locator('a[href="/map/al-diff"]');
  await expect(al).toHaveCount(4);
  await expect(al).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await al.all()) {
    const font = await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
    expect(font).toMatch(/monospace/);
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await body(p)
    .locator("p")
    .evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
      return c.textContent ?? "";
    });
  expect(prose).toBe("See , then , then , then , and  too.");
  await al.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(h1(p)).toHaveText("Alignment diff card");
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
    "Then #al-diff on its own.",
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "guards", { body: lines.join("\n\n") });
  });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("a code", { hasText: "node src" })).toHaveCount(0);
  const ghost = body(p).locator("p").filter({ hasText: "see #no-such-card" });
  await expect(ghost).toHaveText("see #no-such-card");
  await expect(ghost.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "https://example.com/page#al-diff" });
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const own = body(p).locator("p").filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
  await expect(body(p).locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 800 });
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"long ".repeat(200)}#al-diff`, "```"],
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "code-sample", { body: fences.join("\n") });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => boxes.nth(i)) as [Locator, Locator, Locator, Locator];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await zsh
    .locator("code, code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(3);
  const kw = ts.locator("code span", { hasText: /^const$/ });
  await expect(kw).toHaveCount(1);
  // "n" is not wrapped in a token span, so it takes the colour of the code element.
  expect(await ts.locator("code span", { hasText: /^n$/ }).count()).toBe(0);
  expect(await colour(kw)).not.toBe(await colour(ts.locator("code")));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const sc = await plain.locator("pre").evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  expect(sc.s).toBeGreaterThan(sc.c);
  expect(["auto", "scroll"]).toContain(sc.ox);
  const doc = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(doc.s).toBeLessThanOrEqual(doc.c);
  await expect(plain.locator("code")).toContainText("#al-diff");
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4 a script tag shows as text and runs nothing", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    card(d, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }),
  );
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).getByText("bold", { exact: true });
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).getByText("gone", { exact: true });
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
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
              { pause: 2500 },
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
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = new Set([
    await colour(reply.locator(".tok-key").first()),
    await colour(reply.locator(".tok-lit, .tok-num").first()),
    await colour(code),
  ]);
  expect(colours.size).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(h1(p)).toHaveText("Tile card");
});
