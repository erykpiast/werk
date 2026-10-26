// Held-out steps 15.1-15.5 and 19.2, in a real browser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const card = (w: Werk, id: string, fields: Record<string, string> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Al diff card" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const diff = body(p).locator('a[href="/map/al-diff"]');
  await expect(diff).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const a of await diff.all()) {
    expect(await a.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toContain(
      "monospace",
    );
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  const prose = await body(p).evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
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
    "#al-diff",
  ];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const text of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card"]) {
    const para = body(p).locator("p").filter({ hasText: text });
    await expect(para).toHaveText(text);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const code = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(code).toHaveText("node src/cli.ts show #al-diff");
  await expect(code.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  const lone = body(p).locator('a[href="/map/al-diff"]');
  await expect(lone).toHaveCount(1);
  await expect(lone).toHaveText("#al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1024, height: 700 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"y".repeat(500)} #al-diff`, "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => boxes.nth(i)) as Locator[];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const shell = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const constEl = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(constEl).toHaveText("const");
  const nColour = await ts.locator("code").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const i = (t.textContent ?? "").indexOf(" n");
      if (i >= 0 || t.textContent?.trim() === "n") return getComputedStyle(t.parentElement as Element).color;
    }
    return "";
  });
  expect(await colour(constEl)).not.toBe(nColour);
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const s = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
  expect(s.inner).toBeGreaterThan(s.outer);
  const doc = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  await expect(body(p).locator("script")).toHaveCount(0);
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  const bold = body(p).locator("strong, b");
  await expect(bold).toHaveText("bold");
  expect(Number(await bold.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s");
  await expect(gone).toHaveText("gone");
  await expect(gone).toHaveCSS("text-decoration-line", "line-through");
});

test("15.5", async ({ page: p }) => {
  const head = 'Sure:\n```json\n{"a": "x", "n": ';
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
            { pause: 2000 },
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
  // A grid tile shows the card's why as its summary.
  card(w, "tile-card", { title: "Tile card", why: "Depends on #al-diff" });
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
  await expect(reply.locator(".codebox code")).toHaveText('{"a": "x", "n": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"a": "x", "n": 3, "ok": true}');
  const spans = await reply
    .locator(".codebox code span")
    .evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(spans).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});

test("19.2", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            {
              event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello back" }] } },
            },
          ],
        ],
      },
    },
  });
  w.seed("node.added", { id: "how", kind: "card", title: "How it is built", parent: "root" });
  w.seed("node.added", { id: "rule-a", kind: "card", title: "Rule A is a rule", parent: "how" });
  w.seed("node.decided", { id: "rule-a" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Hi");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toContainText("Hello back");
  const launches = readFileSync(join(dirname(w.dir), "fake", "launches.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "launch");
  const chat = launches.find((l) => l.role === "chat");
  const chatPrompt = chat.args[chat.args.indexOf("--append-system-prompt") + 1] as string;
  expect(chatPrompt).toContain("how to work with the decision map");
  expect(chatPrompt).toContain("Rule A is a rule");
  // The step's sample half: the person samples options for an open card. No control or verb for it exists.
  w.seed("node.added", { id: "open-one", kind: "card", title: "Open one", parent: "root" });
  await p.goto(`${w.url}/map/open-one`);
  const sample = p.getByRole("button", { name: /sample/i });
  await expect(sample).toHaveCount(1, { timeout: 3000 });
});
