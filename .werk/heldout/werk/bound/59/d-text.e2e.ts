// Held-out steps 15.1-15.5 (rendered card text) and 06.1-06.2 (an excerpt ghost and its ✓).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Werk, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("15.1 every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every change is a diff" });
  card(w, "align", { title: "The align card" });
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await diffLinks.all()) {
    expect(await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily)).toMatch(
      /mono/i,
    );
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
  await diffLinks.nth(1).click();
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
    "And #al-diff alone.",
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
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).locator("h1, h2, h3, h4, h5, h6");
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const cardLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(cardLinks).toHaveCount(1);
  await expect(cardLinks).toHaveText("#al-diff");
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "#al-diff", "```"],
    ...["```TypeScript", "const n: number = 1", "// #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"y".repeat(500)}`, "see #al-diff", "```"],
  ];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator("pre");
  await expect(boxes).toHaveCount(4);
  const box = (i: number) => body(p).locator(".codebox").nth(i);
  await expect(body(p).locator(".codebox")).toHaveCount(4);
  await expect(box(0)).toContainText("echo $HOME | grep -v x");
  await expect(box(0).locator(".codebox-tag")).toHaveText("zsh");
  const shell = await box(0)
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);
  const kw = box(1).locator("code span", { hasText: /^const$/ }).first();
  await expect(kw).toHaveText("const");
  const nameColour = await box(1)
    .locator("code")
    .evaluate((code) => {
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if (/\bn\b/.test(n.textContent ?? "") && n.parentElement !== null) return getComputedStyle(n.parentElement).color;
      }
      return "";
    });
  expect(await colour(kw)).not.toBe(nameColour);
  await expect(box(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(box(2).locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await box(2)
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  const scroll = await box(3)
    .locator("pre")
    .evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.x);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  await expect(body(p).locator(".codebox")).toContainText(["#al-diff", "#al-diff", "DISPLAY", "#al-diff"]);
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
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

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
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
            { pause: 2500 },
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
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "n": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "n": 2, "ok": true}');
  const colours = await reply
    .locator(".codebox code, .codebox code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});

async function quoted(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", why: "Seats scale", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}
const said = (p: Page) => p.locator('[data-link="supported_by"]');

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await quoted();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-field="why"]')).toContainText("Seats scale");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("pending");
  await row.getByRole("link").first().click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
  expect(w.werk("show", "billing")).toContain("[decided]");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await quoted();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/billing`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  expect(w.werk("show", "billing")).not.toContain("held");
});
