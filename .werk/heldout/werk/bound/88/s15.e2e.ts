import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
function card(w: Werk, id: string, f: { title?: string; why?: string; body?: string } = {}): void {
  w.seed("node.added", { id, kind: "card", title: f.title ?? id, parent: "root", ...f });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diffLinks.all()) {
    expect(await a.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  }
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  const prose = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
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
    "And #al-diff on its own.",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveCount(1);
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const links = body(p).locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
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
  const n = await zsh.locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(n).toBeGreaterThanOrEqual(2);
  await expect(ts.locator(".tok-kw").first()).toHaveText("const");
  expect(await colour(ts.locator(".tok-kw").first())).not.toBe(await colour(ts.locator("code")));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const sc = await plain.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(sc.i).toBeGreaterThan(sc.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
  await expect(zsh.locator("code")).toContainText("#al-diff");
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveText("gone");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
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
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine.locator("a")).toHaveText("#al-diff");
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const cols = new Set([
    await colour(reply.locator(".tok-key").first()),
    await colour(reply.locator(".tok-str").first()),
    await colour(code),
  ]);
  expect(cols.size).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});
