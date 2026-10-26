// Held-out steps 15.1-15.5: card references, code fences, escaping, chat and tiles.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

test("15.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Al diff card" });
    card(d, "align");
    card(d, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  });
  await p.goto(`${w.url}/map/notes-test`);
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (const link of await diffLinks.all()) {
    const font = await link.evaluate((el) => {
      const inner = el.querySelector("code") ?? el;
      return getComputedStyle(inner).fontFamily;
    });
    expect(font.toLowerCase()).toMatch(/mono/);
  }
  const align = body(p).locator('a[href="/map/align"]');
  await expect(align).toHaveCount(1);
  await expect(align).toHaveText("#align");
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  await expect(body(p).locator("a", { hasText: /^then$|^and$/ })).toHaveCount(0);

  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Al diff card");
});

test("15.2", async ({ page: p }) => {
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
  const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(command).toHaveText("node src/cli.ts show #al-diff");
  await expect(command.locator("a")).toHaveCount(0);
  const missing = body(p).locator("p").filter({ hasText: "see #no-such-card" });
  await expect(missing).toHaveText("see #no-such-card");
  await expect(missing.locator("a")).toHaveCount(0);
  const url = body(p).locator("p").filter({ hasText: "https://example.com/page#al-diff" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  const heading = body(p).getByRole("heading", { name: "al-diff" });
  await expect(heading).toHaveText("al-diff");
  await expect(heading.locator("a")).toHaveCount(0);
  const own = body(p).locator("p").filter({ hasText: "on its own" }).locator("a");
  await expect(own).toHaveText("#al-diff");
  await expect(own).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"wide ".repeat(120)}#al-diff`, "```"],
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "code-sample", { body: fences.join("\n") });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];

  const corner = async (box: Locator, label: string) => {
    const tag = box.getByText(label, { exact: true });
    await expect(tag).toBeVisible();
    const b = await box.boundingBox();
    const t = await tag.boundingBox();
    expect(b && t).toBeTruthy();
    if (b && t) {
      expect(t.y - b.y).toBeLessThan(30);
      expect(b.x + b.width - (t.x + t.width)).toBeLessThan(40);
    }
  };
  await corner(zsh, "zsh");
  await expect(zsh.locator("code")).toHaveText("echo $HOME | grep -v x");
  const shell = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shell).toBeGreaterThanOrEqual(2);

  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  await expect(kw).toBeVisible();
  const nameColour = await ts.locator("code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (/(^|\s)n:/.test(n.textContent ?? "")) return getComputedStyle(n.parentElement as Element).color;
    }
    return "none";
  });
  expect(nameColour).not.toBe("none");
  expect(await colour(kw)).not.toBe(nameColour);

  await corner(cobol, "cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);

  const scroll = await plain.locator("pre").evaluate((el) => ({
    inner: el.scrollWidth,
    outer: el.clientWidth,
    overflow: getComputedStyle(el).overflowX,
  }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.overflow);
  const page = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(page.scroll).toBeLessThanOrEqual(page.client);
  await expect(plain.locator("code")).toContainText("#al-diff");
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
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

test("15.5", async ({ page: p }) => {
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
  await expect(reply.locator(".codebox")).toContainText("json");
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
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Tile card");
});
