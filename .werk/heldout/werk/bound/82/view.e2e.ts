import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function card(w: Pick<Werk, "seed">, id: string, parent = "root", f: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...f });
}
const body = (p: Page) => p.locator('[data-field="body"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);
/** The rgb of a computed colour of any syntax, read through a canvas. */
const rgb = (at: Locator, prop: "backgroundColor" | "borderTopColor" | "borderLeftColor") =>
  at.evaluate((el, name) => {
    const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = getComputedStyle(el)[name];
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]] as number[];
  }, prop);

// ---------- 14
test("[14.1] a person moves between cards by address and sees a not-found page for an unknown card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", "root", { title: "Child" }));
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-such-card-id`);
  await expect(p.locator("#view")).toContainText(/no card .* is in the map/i);
  await expect(heading(p)).toHaveCount(0);
  await expect(p.getByText("Child", { exact: true })).toHaveCount(0);
});

test("[14.2] a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const box = p.getByRole("textbox", { name: "Message" });
  await box.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(box).toHaveValue("half a thought");
});

// ---------- 15
test("[15.1] every form of a card reference in a card body becomes the same link", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "root", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", "root", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(heading(p)).toHaveText("Every proposed change is a diff");
});

test("[15.2] text that only looks like a reference stays text", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", "root", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("a")).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("[15.3] fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const f = [
    ...["```zsh", "echo $HOME | grep -v x", "```"],
    ...["```TypeScript", "const n: number = 1", "```"],
    ...["```cobol", "DISPLAY 'HELLO'.", "```"],
    ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  ];
  card(w, "code-sample", "root", { body: f.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
  const sc = await boxes.nth(0).locator("code span").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).color)).size);
  expect(sc).toBeGreaterThanOrEqual(2);
  await expect(boxes.nth(1).locator("code").getByText("const", { exact: true })).toBeVisible();
  const kw = boxes.nth(1).locator("code").getByText("const", { exact: true });
  expect(await colour(kw)).not.toBe(await colour(boxes.nth(1).locator("code")));
  await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const s = await boxes.nth(3).locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(s.i).toBeGreaterThan(s.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("[15.4] card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", "root", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p)).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveText("bold");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

test("[15.5] references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({
    roles: {
      chat: {
        replies: [[
          stream({ type: "message_start", message: { id: "m1" } }),
          stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
          stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
          { pause: 2000 },
          stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
          { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: head + tail }] } } },
        ]],
      },
    },
  });
  card(w, "al-diff");
  card(w, "old-idea");
  w.seed("node.removed", { id: "old-idea" });
  card(w, "tile-card", "root", { title: "A tile", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator("a")).toHaveCount(1);
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine).toContainText("#old-idea");
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  expect(await reply.locator(".codebox code span").count()).toBeGreaterThan(0);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

// ---------- 71 (same area, other wording)
test("[71.1] known card ids in a body become links, other text stays plain", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "align");
  card(w, "notes-card", "root", { body: "Mentions #al-diff, #ghost-card, the bare word al-diff, the bare word align, and `node src/cli.ts show #al-diff`" });
  await p.goto(`${w.url}/map/notes-card`);
  const a = body(p).locator("a");
  await expect(a.filter({ hasText: "#al-diff" })).toHaveCount(2);
  expect(await a.count()).toBe(2);
  await expect(body(p)).toContainText("#ghost-card");
  await expect(a.filter({ hasText: "ghost" })).toHaveCount(0);
  await expect(a.filter({ hasText: "align" })).toHaveCount(0);
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd.locator("a")).toHaveCount(0);
});

test("[71.2] a click on a card link in a why line opens that card", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", "root", { title: "Alignment", why: "Diff the alignment" });
  card(w, "pr-iface", "root", { why: "It follows #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("#view")).toContainText("Diff the alignment");
});

test("[71.3] headings, URL fragments and fenced blocks keep their own form", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", "root", { body: "# al-diff\n\nSee https://example.com/page#al-diff\n\nA span `#al-diff` here.\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "example.com" }).locator("a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  await expect(body(p).locator('p a[href="/map/al-diff"]')).toHaveText("#al-diff");
});

test("[71.4] a grid tile summary holds no link, but a note on the open card does", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", "root", { title: "Reference", why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(heading(p)).toHaveText("Reference");
  await expect(p.locator('[data-section="thread"] a[href="/map/al-diff"]')).toContainText("al-diff");
});

test("[71.5] fenced code shows boxed, highlighted, with its own indentation and sideways scroll", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": 1,\n        "long": "${"y".repeat(500)}"\n    }\n}`;
  card(w, "code-card", "root", { body: `Text before.\n\n\`\`\`json\n${json}\n\`\`\`\n\nText after.` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  expect(await box.locator("code span").count()).toBeGreaterThan(0);
  const text = await box.locator("code").textContent();
  expect(text).toContain('\n    "a": {\n        "b": 1,');
  const s = await box.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(s.i).toBeGreaterThan(s.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
});

// ---------- 17
test("[17.1] a person opens a deep card and follows the breadcrumbs back", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  await p.goto(`${w.url}/map/d`);
  await expect(heading(p)).toHaveText("Card d");
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card d");
  await expect(crumbs(p)).toContainText("›");
  const w700 = await p.locator("#view").boundingBox();
  expect(w700?.width ?? 0).toBeLessThan(700);
  const bold = await crumbs(p).locator('[aria-current="page"]').evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(bold).toBeGreaterThanOrEqual(600);
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeHidden();
  await crumbs(p).hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await p.mouse.move(0, 0);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("[17.2] the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root", { status: "open" });
    card(d, "base", "root");
    card(d, "st", "root", { status: "open" });
    d.seed("edge.added", { from: "st", to: "base", type: "depends_on", why: "needs it" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  const total = Number(await count(p, "total").textContent());
  let sum = 0;
  for (const n of ["open", "proto", "decided"]) {
    const at = count(p, n);
    if ((await at.count()) > 0) {
      sum += Number(await at.textContent());
      await expect(at).toHaveAttribute("title", new RegExp(n));
    }
  }
  expect(sum).toBe(total);
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
});

test("[17.3] a person finds a card by id and opens it from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "vi-werk", "root", { title: "Notes on werk" });
    card(d, "werk", "root", { title: "werk v0" });
    card(d, "werk-stack", "werk", { title: "The stack" });
    for (let i = 0; i < 14; i++) card(d, `werk-extra-${i}`, "root", { title: `Extra ${i}` });
    d.seed("edge.added", { from: "vi-werk", to: "werk", type: "depends_on", why: "reads" });
    d.seed("node.reopened", { id: "werk", reason: "invalidated", why: "scope" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id")));
  expect(ids[0]).toBe("werk");
  const lastStarts = ids.map((i) => (i ?? "").startsWith("werk"));
  expect(lastStarts.lastIndexOf(true)).toBeLessThan(lastStarts.length);
  const firstContain = ids.findIndex((i) => !(i ?? "").startsWith("werk"));
  if (firstContain >= 0) expect(lastStarts.slice(firstContain).every((x) => !x)).toBe(true);
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  await expect(rows.first().locator("code")).toHaveText("werk");
  await expect(rows.first()).toContainText("werk v0");
  await search(p).fill("#werk-stack");
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  const stale = p.locator('[role="option"][data-id="werk-stack"] [data-role="dot"]');
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).fill("#werk");
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("[17.4] a person switches between the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (n: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name: n });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("[17.5] the first screen shows the requirements and the build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", "root", { title: "Customers pay online" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  expect(l?.y).toBe(r?.y);
});

test("[17.5b] with no #how card the right column is an empty build-rules card", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how).toContainText(/build rules/i);
});
