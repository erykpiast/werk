import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const body = (p: Page) => p.locator('[data-field="body"]');
type S = Pick<Werk, "seed">;
function card(w: S, id: string, f: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
}
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  const alLinks = body(p).locator('a[href="/map/al-diff"]');
  await expect(alLinks).toHaveCount(4);
  for (const a of await alLinks.all()) {
    expect(await a.locator("code").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  }
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  const prose = await body(p).locator("p").evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    for (const a of Array.from(c.querySelectorAll("a"))) a.remove();
    return c.textContent ?? "";
  });
  expect(prose).toBe("See , then , then , then , and  too.");
  await links.nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(heading(p)).toHaveText("Every proposed change is a diff");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`",
    "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para).toHaveText(t);
    await expect(para.locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveText("node src/cli.ts show #al-diff");
  await expect(cmd.locator("a")).toHaveCount(0);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("a")).toHaveCount(1);
  await expect(body(p).locator("a")).toHaveAttribute("href", "/map/al-diff");
});

test("15.3", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  card(w, "al-diff");
  const f = [...["```zsh", "echo $HOME | grep -v x #al-diff", "```"], ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
    ...["```cobol", "DISPLAY 'HELLO'. al-diff", "```"], ...["```", `${"x".repeat(400)} #al-diff`, "```"]];
  card(w, "code-sample", { body: f.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  expect(await zsh.locator("code span").evaluateAll((e) => new Set(e.map((x) => getComputedStyle(x).color)).size)).toBeGreaterThanOrEqual(2);
  const kw = ts.locator("code span", { hasText: /^const$/ }).first();
  const name = ts.locator("code span", { hasText: /^n$/ });
  expect(await colour(kw)).not.toBe(await colour(ts.locator("code")));
  if ((await name.count()) > 0) expect(await colour(kw)).not.toBe(await colour(name.first()));
  await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  await expect(cobol.locator("code span")).toHaveCount(0);
  const s = await plain.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(s.i).toBeGreaterThan(s.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
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
  const st = (event: object) => ({ event: { type: "stream_event", event } });
  const w = await project({ roles: { chat: { replies: [[
    st({ type: "message_start", message: { id: "msg-1" } }),
    st({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    st({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
    { pause: 2500 },
    st({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
    { event: { type: "assistant", message: { id: "msg-1", content: [{ type: "text", text: head + tail }] } } },
  ]] } } });
  card(w, "al-diff");
  card(w, "old-idea");
  w.werk("remove", "old-idea", "--actor", "you");
  card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
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
  const code = reply.locator(".codebox code");
  await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  const cs = new Set([await colour(reply.locator(".tok-key").first()), await colour(reply.locator(".tok-str").first()), await colour(code)]);
  expect(cs.size).toBeGreaterThanOrEqual(2);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

test("17.1", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 700 });
  const w = await project(undefined, (d) => {
    card(d, "a", { parent: "root" }); card(d, "b", { parent: "a" }); card(d, "c", { parent: "b" }); card(d, "d", { parent: "c" });
  });
  await p.goto(`${w.url}/`);
  const nav = p.getByRole("navigation", { name: "Breadcrumbs" });
  const nb = await nav.boundingBox();
  expect(nb?.width ?? 9999).toBeLessThan(700);
  await p.locator('[data-column="what"]').getByRole("heading", { level: 2 }).click();
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("d");
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  expect(await crumbs(p).locator("[data-crumb]").allTextContents()).toEqual(["c", "d"]);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveCSS("font-weight", "600");
  expect((await crumbs(p).innerText()).replace(/\s+/g, "")).toBe("…›c›d");
  const line = await crumbs(p).boundingBox();
  const seg = await crumbs(p).locator('[aria-current="page"]').boundingBox();
  expect(line?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);
  const full = p.locator('[data-role="crumbs-full"]');
  await crumbs(p).hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "a", "b", "c", "d"]);
  await full.getByRole("button", { name: "c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { parent: "root" }); card(d, "b", { parent: "a", status: "open" }); card(d, "c", { parent: "a", status: "proto" });
    card(d, "e", { parent: "root", status: "open" }); card(d, "base", { parent: "root" }); card(d, "dep", { parent: "root" });
    d.seed("edge.added", { from: "dep", to: "base", type: "depends_on", why: "needs" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  const sum = async () => {
    let t = 0;
    for (const n of ["open", "proto", "decided"]) { const at = count(p, n); if ((await at.count()) > 0) t += Number(await at.textContent()); }
    return t;
  };
  const total = Number(await count(p, "total").textContent());
  expect(total).toBeGreaterThan(0);
  expect(await sum()).toBe(total);
  await expect(count(p, "stale")).toHaveCount(1);
  for (const n of ["open", "proto", "decided"]) {
    const t = await count(p, n).getAttribute("title");
    expect(t?.toLowerCase()).toContain(n);
  }
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(p.locator('#header [data-count="stale"]')).toHaveCount(0);
  await expect(count(p, "stale")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", { title: "werk v0" });
    for (let i = 0; i < 8; i++) card(d, `werk-s${i}`, { title: `Starts ${i}` });
    for (let i = 0; i < 8; i++) card(d, `pre-werk-${i}`, { title: `Contains ${i}` });
    d.seed("edge.added", { from: "pre-werk-0", to: "werk", type: "depends_on", why: "x" });
    d.seed("node.reopened", { id: "werk", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContain = ids.findIndex((i) => !i.startsWith("werk"));
  expect(ids.slice(firstContain).every((i) => !i.startsWith("werk"))).toBe(true);
  expect(ids.slice(0, firstContain).length).toBe(9);
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  await expect(rows.first()).toContainText("werk v0");
  await expect(rows.first()).toContainText("werk");
  const dotColour = (id: string) => p.locator(`[role="option"][data-id="${id}"] [data-role="dot"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await dotColour("werk-s0")).not.toBe("rgb(220, 38, 38)");
  // stale card: pre-werk-0's basis is werk; werk-s0 etc are fine. dependents of reopened werk are stale
  expect(await dotColour("pre-werk-0")).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveCSS("font-weight", "600");
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (n: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name: n });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", { title: "Customers pay online" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", { parent: "how", title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(what.locator(`[data-count="decided"]`)).toBeVisible();
  await expect(how.locator(`[data-count="decided"]`)).toBeVisible();
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const l = await what.boundingBox(); const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  expect(l?.y).toBe(r?.y);
});

test("17.5 no how", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.locator("a[data-tile]")).toHaveCount(0);
  console.log("HOWTEXT", JSON.stringify(await how.innerText()));
  await p.screenshot({ path: "test-results/g7-17-5-nohow.png" });
});

test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff"); card(w, "align");
  card(w, "notes-card", { body: 'Mentions #al-diff, #ghost-card, the word al-diff, the word align, and `node src/cli.ts show #al-diff`.' });
  await p.goto(`${w.url}/map/notes-card`);
  const links = body(p).locator("a");
  await expect(links).toHaveText(["#al-diff", "#al-diff"]);
  await expect(links.first()).toHaveAttribute("href", "/map/al-diff");
  await expect(body(p)).toContainText("#ghost-card");
  await expect(body(p)).toContainText("the word align,");
  await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(0);
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  await expect(cmd).toHaveCount(1);
  await expect(cmd.locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "al-diff title", why: "Diff the alignment" });
  card(w, "pr-iface", { why: "It follows #al-diff closely" });
  await p.goto(`${w.url}/map/pr-iface`);
  const link = p.locator('[data-field="why"] a', { hasText: "#al-diff" });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.getByText("Diff the alignment").first()).toBeVisible();
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", { body: "# al-diff\n\nSee https://example.com/page#al-diff here.\n\nCode `#al-diff` span.\n\n```\n#al-diff\n```" });
  await p.goto(`${w.url}/map/doc-card`);
  await expect(body(p).locator("h1")).toHaveText("al-diff");
  await expect(body(p).locator("h1 a")).toHaveCount(0);
  await expect(body(p).locator("p", { hasText: "example.com" }).locator("a")).toHaveCount(0);
  await expect(body(p).locator(".codebox a")).toHaveCount(0);
  await expect(body(p).locator(".codebox")).toContainText("#al-diff");
  const links = body(p).locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/map/al-diff");
});

test("71.4", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "ref-card", { why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map/root`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  const note = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "See" });
  await expect(note.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": {\n            "c": 1\n        }\n    },\n    "long": "${"y".repeat(500)}"\n}`;
  card(w, "code-card", { body: `Intro text.\n\n\`\`\`json\n${json}\n\`\`\`\n\nOutro.` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box).toHaveCount(1);
  expect(await box.locator("code span").count()).toBeGreaterThan(0);
  expect(await box.locator("code").evaluate((el) => el.textContent)).toBe(json);
  const s = await box.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth, ws: getComputedStyle(el).whiteSpace }));
  expect(s.i).toBeGreaterThan(s.o);
  expect(s.ws).toContain("pre");
  await box.locator("pre").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  expect(await box.locator("pre").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const b = await body(p).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
  expect(b.s).toBeLessThanOrEqual(b.c);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
});
