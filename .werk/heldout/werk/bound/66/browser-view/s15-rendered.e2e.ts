// Held-out steps 15.1–15.5: card references, code fences and safe text in the rendered card.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../../e2e/project.ts";
import { card, heading, style } from "./helpers.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');

test("15.1 every form of a card reference becomes the same link", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "al-diff", { title: "Al diff card" });
    card(d, "align", { title: "Align card" });
    card(d, "notes-test", { title: "Notes test", body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  });
  // When the person opens the card "notes-test" in the map
  await p.goto(`${w.url}/map/notes-test`);
  await expect(heading(p)).toHaveText("Notes test");
  // Then four links that each read "#al-diff" in a monospace face
  const diffLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(diffLinks).toHaveCount(4);
  await expect(diffLinks).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff"]);
  for (let i = 0; i < 4; i++) {
    const inner = diffLinks.nth(i).locator("code");
    const face = (await inner.count()) > 0 ? await style(inner.first(), "font-family") : await style(diffLinks.nth(i), "font-family");
    expect(face).toContain("monospace");
  }
  // And one link that reads "#align"
  const alignLinks = body(p).locator('a[href="/map/align"]');
  await expect(alignLinks).toHaveCount(1);
  await expect(alignLinks).toHaveText("#align");
  await expect(body(p).locator("a")).toHaveCount(5);
  // And "then" and "and" stay ordinary text
  const prose = await body(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
    return copy.textContent ?? "";
  });
  expect(prose).toContain("then");
  expect(prose).toContain("and");
  // When the person clicks the second "#al-diff" link
  await diffLinks.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(heading(p)).toHaveText("Al diff card");
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
    "#al-diff",
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "guards", { title: "Guards", body: lines.join("\n\n") });
  });
  await p.goto(`${w.url}/map/guards`);
  await expect(heading(p)).toHaveText("Guards");
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
  const url = body(p).locator("p").filter({ hasText: "example.com" });
  await expect(url).toContainText("https://example.com/page#al-diff");
  await expect(url.locator('a[href="/map/al-diff"]')).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  // But "#al-diff" on its own still links
  const links = body(p).locator('a[href="/map/al-diff"]');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveText("#al-diff");
});

test("15.3 fenced code is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const fences = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"word ".repeat(120)}#al-diff`, "```"],
  ];
  const w = await project(undefined, (d) => {
    card(d, "al-diff");
    card(d, "code-sample", { body: fences.join("\n\n") });
  });
  await p.goto(`${w.url}/map/code-sample`);
  const pres = body(p).locator("pre");
  await expect(pres).toHaveCount(4);
  // Each fence in its own box
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [0, 1, 2, 3].map((i) => boxes.nth(i));
  await expect(zsh).toContainText("echo $HOME | grep -v x");
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  const shellColours = await zsh
    .locator("code span")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(shellColours).toBeGreaterThanOrEqual(2);
  // TypeScript: "const" differs in colour from "n"
  const constColour = await ts.locator("code span", { hasText: /^const$/ }).first().evaluate((el) => getComputedStyle(el).color);
  const nColour = await ts.locator("code").evaluate((el) => {
    // the colour of the text node "n" is its parent's colour
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/(^|\s)n(:|\s|$)/.test(node.textContent ?? "")) return getComputedStyle(node.parentElement as Element).color;
    }
    return "not found";
  });
  expect(nColour).not.toBe("not found");
  expect(constColour).not.toBe(nColour);
  // cobol: label and one plain colour
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'.");
  const cobolColours = await cobol
    .locator("code, code *")
    .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(cobolColours).toBe(1);
  // long line scrolls sideways, page does not get wider
  const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth, x: getComputedStyle(el).overflowX }));
  expect(scroll.inner).toBeGreaterThan(scroll.outer);
  expect(["auto", "scroll"]).toContain(scroll.x);
  const doc = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(doc.s).toBeLessThanOrEqual(doc.c);
  // A reference inside a fence stays plain code text
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
  const bold = body(p).locator("strong, b");
  await expect(bold).toHaveText("bold");
  expect(Number(await style(bold, "font-weight"))).toBeGreaterThanOrEqual(600);
  const gone = body(p).locator("del, s");
  await expect(gone).toHaveText("gone");
  expect(await style(gone, "text-decoration-line")).toContain("line-through");
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
              stream({ type: "message_start", message: { id: "msg-1" } }),
              stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
              stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
              { pause: 2500 },
              stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
              { event: { type: "assistant", message: { id: "msg-1", content: [{ type: "text", text: head + tail }] } } },
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
  await p.goto(`${w.url}/map/root`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox").first().fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine).toContainText("Compare");
  await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine).toContainText("#old-idea");
  // While streaming: code so far inside a box labelled json
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  // After the reply: complete code with JSON colours
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const colours = await code.locator("span").evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  expect(colours).toBeGreaterThanOrEqual(2);
  // The grid tile
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
  await expect(heading(p)).toHaveText("Tile card");
});
