// Held-out browser tests: cards, ghosts, notes, rendered text (steps 06, 10, 15, 18, 70, 71, 72).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const card = (w: Pick<Werk, "seed">, id: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
const flag = (p: Page) => p.evaluate(() => ((window as any).kept = true));
const same = (p: Page) => p.evaluate(() => (window as any).kept === true);
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const style = (at: Locator, prop: string) => at.evaluate((el, n) => (getComputedStyle(el) as any)[n], prop);
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');
async function quoted(): Promise<Werk> {
  const w = await project();
  card(w, "billing", { title: "We bill per seat" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

test("06.2", async ({ page: p }) => {
  const w = await quoted();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/billing`);
  await expect(said(p)).toContainText("seats are the unit");
  await expect(said(p)).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
  // exactly one accept event, no second one for the link
  expect(logLines(w).filter((e) => e.type === "change.accepted").length).toBe(1);
});

test("10.1", async ({ page: p }) => {
  const w = await project();
  card(w, "auth-login", { title: "Login uses magic links" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2 (person types notes in the map)", async ({ page: p }) => {
  const w = await project();
  card(w, "auth-login", { title: "Login" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.werk("inbox");
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)\s.*\n\s+(\S+)$/gm)];
  expect(entries.map((m) => m[3])).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((m) => m[2] === "auth-login")).toBe(true);
  const first = entries[0]![1]!;
  const s = w.werk("inbox", "--since", first);
  expect(s).not.toContain("first");
  expect(s).toContain("second");
  const c = w.werk("inbox", "--since", first, "-n", "2");
  expect(c).toContain("third");
  expect(c).not.toContain("fourth");
});

test("10.3", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(h1(p)).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "TTL 60", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "TTL 30", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
});

test("10.5", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749" });
  w.seed("excerpt.quoted", { id: "src-rfc-quote", title: "The client MAY retry the request.", card: "root", conversation: "oauth", session: "s1", message: 0, start: 0, end: 33, speaker: "person", said_at: "t0" });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

const body = (p: Page) => p.locator('[data-field="body"]');
const bcolour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).color);

test("15.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  await p.goto(`${w.url}/map/notes-test`);
  await expect(body(p).locator("a")).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  for (const code of await body(p).locator('a[href="/map/al-diff"] code').all())
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  const text = await body(p).locator("p").innerText();
  expect(text).toContain("then");
  await body(p).locator("a").nth(1).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(h1(p)).toHaveText("Every proposed change is a diff");
});

test("15.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  const lines = ["--al-diff", "##al-diff", "&al-diff", "a code span holding `node src/cli.ts show #al-diff`", "see #no-such-card", "visit https://example.com/page#al-diff", "# al-diff", "And #al-diff on its own."];
  card(w, "guards", { body: lines.join("\n\n") });
  await p.goto(`${w.url}/map/guards`);
  for (const t of ["--al-diff", "##al-diff", "&al-diff", "see #no-such-card", "visit https://example.com/page#al-diff"]) {
    const para = body(p).locator("p").filter({ hasText: t });
    await expect(para.first()).toHaveText(t);
    await expect(para.first().locator("a")).toHaveCount(0);
  }
  const cmd = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
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
  const fences = [...["```zsh", "echo $HOME | grep -v x", "```"], ...["```TypeScript", "const n: number = 1", "```"], ...["```cobol", "DISPLAY 'HELLO'.", "```"], ...["```", `${"x".repeat(400)} #al-diff`, "```"]];
  card(w, "code-sample", { body: fences.join("\n") });
  await p.goto(`${w.url}/map/code-sample`);
  const boxes = body(p).locator(".codebox");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
  expect(await boxes.nth(0).locator("code span").evaluateAll((e) => new Set(e.map((x) => getComputedStyle(x).color)).size)).toBeGreaterThanOrEqual(2);
  await expect(boxes.nth(1).locator(".tok-kw").first()).toHaveText("const");
  expect(await bcolour(boxes.nth(1).locator(".tok-kw").first())).not.toBe(await bcolour(boxes.nth(1).locator("code")));
  await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
  await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
  const sc = await boxes.nth(3).locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(sc.i).toBeGreaterThan(sc.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
  await expect(boxes.locator("a")).toHaveCount(0);
});

test("15.4", async ({ page: p }) => {
  const w = await project();
  card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  await p.goto(`${w.url}/map/unsafe`);
  await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  expect(await p.evaluate(() => (globalThis as any).__pwned)).toBeUndefined();
  await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
});

const stream = (event: object) => ({ event: { type: "stream_event", event } });
test("15.5", async ({ page: p }) => {
  const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  const tail = '2, "open": true}\n```';
  const w = await project({ roles: { chat: { replies: [[
    stream({ type: "message_start", message: { id: "m1" } }),
    stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
    { pause: 2000 },
    stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: head + tail }] } } },
  ]] } } });
  card(w, "al-diff");
  card(w, "old-idea");
  w.seed("node.removed", { id: "old-idea" });
  card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
  await p.goto(`${w.url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  await pane.getByRole("button", { name: "Send" }).click();
  const mine = pane.locator(".msg.user");
  await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  await expect(mine.locator("a")).toHaveCount(1);
  const reply = pane.locator(".msg.agent");
  await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  expect(await reply.locator(".tok-key").count()).toBeGreaterThan(0);
  const tile = p.locator('a[data-tile="tile-card"]');
  await expect(tile).toContainText("Depends on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/tile-card$/);
});

// ---- 18 / 70: review paths
const BLUE = (c: string) => {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(c);
  if (m) return Number(m[3]) > 190 && Number(m[3]) < 290 && Number(m[2]) > 0.01;
  const r = /rgb\((\d+), (\d+), (\d+)/.exec(c);
  return r ? Number(r[3]) > Number(r[1]) + 10 : false;
};

test("18.1", async ({ page: p }) => {
  const w = await project();
  card(w, "storage", { title: "Storage" });
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/storage`);
  const tile = p.locator('a[data-tile="sqlite"]');
  await expect(tile).toContainText("Use SQLite");
  await p.goto(`${w.url}/map/sqlite`);
  const art = p.locator("article");
  expect(BLUE(await style(art, "borderTopColor"))).toBe(true);
  expect(BLUE(await style(art, "backgroundColor"))).toBe(true);
  await expect(art.locator('[data-tag="proposed"]')).toHaveText(/proposed/);
  const accept = art.getByRole("button", { name: "Accept" });
  await expect(accept).toBeVisible();
  await expect(accept).toHaveText(/✓/);
  await expect(art.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flag(p);
  await accept.click();
  await expect(art).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await same(p)).toBe(true);
  const last = logLines(w).at(-1);
  expect(last.type).toBe("change.accepted");
  expect(last.actor).toBe("you");
  expect(last.payload.id).toBe("sqlite");
});

test("18.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const art = p.locator("article");
  expect(BLUE(await style(art, "borderTopColor"))).toBe(true);
  expect(BLUE(await style(art, "backgroundColor"))).toBe(false);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(art.locator('ins[data-diff="added"]')).toHaveText("ten");
  await expect(art.locator('del[data-diff="removed"]')).toHaveText("five");
  expect(await style(art.locator('del[data-diff="removed"]'), "textDecorationLine")).toBe("line-through");
  expect(await style(art.locator('ins[data-diff="added"]'), "backgroundColor")).not.toBe("rgba(0, 0, 0, 0)");
  await expect(art.locator("[data-diff]")).toHaveCount(2);
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "list", { title: "List", body: `An old paragraph.\n\n${items}` });
    d.seed("kill.added", { id: "list", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item 5", "- item 5\n- the new item");
  w.werk("propose", "list", "--ops", JSON.stringify([
    { tag: "removed", old: "An old paragraph." },
    { tag: "new", new: "- fresh one\n- fresh two" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/list`);
  const b = body(p);
  const added = b.locator('[data-diff="added"]');
  const removed = b.locator('[data-diff="removed"]');
  console.log("18.3 added", await added.allTextContents(), "removed", await removed.allTextContents());
  await expect(removed.filter({ hasText: "An old paragraph." })).toHaveCount(1);
  expect(await removed.first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  await expect(added.filter({ hasText: "the new item" })).toHaveCount(1);
  await expect(added.filter({ hasText: "fresh one" }).or(b.locator('li:has-text("fresh one") [data-diff="added"], [data-diff="added"]:has-text("fresh one")'))).not.toHaveCount(0);
  for (let i = 1; i <= 10; i++) await expect(b.locator("li", { hasText: new RegExp(`^item ${i}$`) }).locator("[data-diff]")).toHaveCount(0);
});

test("18.4", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  const buttons = dialog.getByRole("button");
  const names = await buttons.allTextContents();
  console.log("18.4 dialog buttons:", names);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /1 card leaves.*server/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const before = logLines(w).length;
  await flag(p);
  await dialog.getByRole("button", { name: /1 card leaves.*server/i }).click();
  await expect.poll(() => logLines(w).length).toBe(before + 1);
  await p.waitForTimeout(500);
  console.log("18.4 after removal url:", p.url(), "same page:", await same(p));
  expect(await same(p)).toBe(true);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-missing="auth"]')).toBeVisible();
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('a[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('a[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('a[data-tile="sessions"]')).toBeVisible();
  w.werk("restore", "auth", "--actor", "you");
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('a[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('a[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('a[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('a[data-tile="sessions"]')).toBeVisible();
});

test("18.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  expect(await style(tile, "borderTopColor")).toMatch(/rgb\(2[0-9]{2}, 1[0-9]{2}, 1[0-9]{2}\)|oklch\(0\.7/);
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  await flag(p);
  const status = await p.evaluate(async () => (await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) })).status);
  expect(status).toBe(403);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
  expect(await same(p)).toBe(true);
});

// ---- 70 ghosts in the map
test("70.1", async ({ page: p }) => {
  const w = await project();
  card(w, "payments", { title: "Payments" });
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('a[data-tile="refunds"]');
  await expect(tile).toBeVisible();
  expect(await style(tile, "borderTopStyle")).toBe("dashed");
  await p.goto(`${w.url}/map/root`);
  const real = p.locator('a[data-tile="payments"]');
  expect(await style(real, "borderTopStyle")).toBe("solid");
});

test("70.2", async ({ page: p }) => {
  const w = await project();
  card(w, "payments", { title: "Payments" });
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  const last = logLines(w).at(-1);
  expect(last.type).toBe("change.accepted");
  expect(last.actor).toBe("you");
  await p.goto(`${w.url}/map/payments`);
  expect(await style(p.locator('a[data-tile="refunds"]'), "borderTopStyle")).toBe("solid");
});

test("70.3", async ({ page: p }) => {
  const w = await project();
  card(w, "payments", { title: "Payments" });
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('a[data-tile="partial"]')).toBeVisible();
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toBeVisible();
});

test("70.4", async ({ page: p }) => {
  const w = await project();
  card(w, "payments", { title: "Payments" });
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "r-opt", "--kind", "option", "--title", "Opt", "--why_not", "no");
  w.werk("link", "r-opt", "refunds", "--type", "alternative_to");
  w.werk("add", "r-src", "--kind", "source", "--title", "Src");
  w.werk("link", "refunds", "r-src", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: /accept (all|both|every)/i })).toHaveCount(0);
  expect(w.werk("show", "r-opt")).not.toContain("proposed");
  expect(w.werk("show", "r-src")).not.toContain("proposed");
  await p.goto(`${w.url}/map/payments`);
  expect(await style(p.locator('a[data-tile="chargebacks"]'), "borderTopStyle")).toBe("dashed");
  expect(await style(p.locator('a[data-tile="refunds"]'), "borderTopStyle")).toBe("solid");
});

test("70.5", async ({ browser }) => {
  const w = await project();
  card(w, "payments", { title: "Payments" });
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const a = await c1.newPage();
  const b = await c2.newPage();
  await a.goto(`${w.url}/map/refunds`);
  await b.goto(`${w.url}/map/refunds`);
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "true");
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "false");
  await c1.close();
  await c2.close();
});

// ---- 71 refs
test("71.1", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Every proposed change is a diff" });
  card(w, "align");
  card(w, "notes-card", { body: "Ref #al-diff and #ghost-card and bare al-diff and bare align and `node src/cli.ts show #al-diff`." });
  await p.goto(`${w.url}/map/notes-card`);
  const b = body(p);
  const links = b.locator("a");
  expect(await links.allTextContents()).toEqual(["#al-diff", "#al-diff"]);
  await expect(b).toContainText("#ghost-card");
  await expect(b).toContainText("bare align");
  await expect(b.locator("code", { hasText: "node src/cli.ts show #al-diff" }).locator("a")).toHaveCount(0);
});

test("71.2", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff", why: "Diff the alignment" });
  card(w, "pr-iface", { title: "Iface", why: "Built on #al-diff" });
  await p.goto(`${w.url}/map/pr-iface`);
  await p.locator('[data-field="why"] a', { hasText: "#al-diff" }).click();
  await expect(p).toHaveURL(/\/map\/al-diff$/);
  await expect(p.locator("article")).toContainText("Diff the alignment");
});

test("71.3", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff");
  card(w, "doc-card", { body: ["# al-diff", "visit https://example.com/page#al-diff", "a span `#al-diff` here", "```", "#al-diff", "```"].join("\n\n").replace("\n\n```\n\n#al-diff\n\n```", "\n\n```\n#al-diff\n```") });
  await p.goto(`${w.url}/map/doc-card`);
  const b = body(p);
  await expect(b.locator("h1")).toHaveText("al-diff");
  await expect(b.locator("h1 a")).toHaveCount(0);
  await expect(b.locator("p", { hasText: "visit https://example.com" }).locator("a")).toHaveCount(0);
  await expect(b.locator(".codebox a")).toHaveCount(0);
  await expect(b.locator('p a[href="/map/al-diff"]')).toHaveCount(1);
});

test("71.4", async ({ page: p }) => {
  const w = await project();
  card(w, "al-diff", { title: "Diff" });
  card(w, "ref-card", { title: "Ref", why: "Follows up on #al-diff" });
  w.werk("say", "ref-card", "See al-diff first");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="ref-card"]');
  await expect(tile).toContainText("Follows up on #al-diff");
  await expect(tile.locator("a")).toHaveCount(0);
  await tile.click();
  await expect(p).toHaveURL(/\/map\/ref-card$/);
  await expect(thread(p).locator("a", { hasText: "al-diff" })).toHaveCount(1);
});

test("71.5", async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  const w = await project();
  const json = `{\n    "a": {\n        "b": 1,\n        "long": "${"x".repeat(300)}"\n    }\n}`;
  card(w, "code-card", { body: `Text\n\n\`\`\`json\n${json}\n\`\`\`` });
  await p.goto(`${w.url}/map/code-card`);
  const box = body(p).locator(".codebox");
  await expect(box.locator(".tok-key").first()).toBeVisible();
  const text = await box.locator("code").textContent();
  expect(text).toContain('\n        "b": 1,');
  expect(text).toContain('\n    "a"');
  const sc = await box.locator("pre").evaluate((el) => ({ i: el.scrollWidth, o: el.clientWidth }));
  expect(sc.i).toBeGreaterThan(sc.o);
  const pg = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(pg.s).toBeLessThanOrEqual(pg.c);
});

// ---- 72 stale marks
function abc(w: Pick<Werk, "seed">) {
  card(w, "a", { title: "Card A" });
  card(w, "b", { title: "Card B" });
  card(w, "c", { title: "Card C" });
  w.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "needs a" });
  w.seed("edge.added", { from: "c", to: "b", type: "depends_on", why: "needs b" });
}
test("72.1", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "rejected", "--why", "wrong");
  await p.goto(`${w.url}/map/root`);
  const b = p.locator('a[data-tile="b"]');
  await expect(b).toHaveAttribute("data-stale", "true");
  await expect(b).toHaveAttribute("data-status", "decided");
  expect(await style(b, "backgroundColor")).toMatch(/oklch\(0\.97\d* 0\.01\d* 1[5-9]|rgb\(254, 242, 242\)/);
  const c = p.locator('a[data-tile="c"]');
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c).toHaveAttribute("data-postponed", "false");
});

test("72.2", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "later");
  // The grid tile of a downstream card carries no paused mark; the card page does.
  await p.goto(`${w.url}/map/root`);
  console.log("72.2 tile b tags:", await p.locator('a[data-tile="b"] [data-tag]').allTextContents());
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    const art = p.locator("article");
    await expect(art.locator('[data-tag="paused"]')).toBeVisible();
    await expect(art).toHaveAttribute("data-status", "decided");
    await expect(art).toHaveAttribute("data-stale", "false");
    await expect(art.locator('[data-tag="stale"]')).toHaveCount(0);
    expect(await style(art, "borderLeftColor")).toMatch(/oklch\(0\.62\d* 0\.1\d* 149/);
  }
});

test("72.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Card A" });
    card(d, "b", { title: "Card B" });
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "needs a" });
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("reopened".length ? "#a" : "");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
  await expect(s).toContainText("depends_on");
});

test("72.4", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const h2 = p.locator("article ~ * h2, #view h2").filter({ hasText: /Why this card is/ });
  console.log("72.4 headings:", await h2.allTextContents());
  await expect(p.locator("#view h2", { hasText: "Why this card is stale" })).toHaveCount(1);
  await expect(p.locator("#view")).toContainText("We build the engine next quarter");
  await expect(p.locator("#view")).toContainText("postponed");
});

test("72.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Card A" });
    card(d, "x", { title: "Card X" });
    card(d, "b", { title: "Card B" });
    d.seed("edge.added", { from: "b", to: "a", type: "depends_on", why: "needs a" });
    d.seed("edge.added", { from: "b", to: "x", type: "depends_on", why: "needs x" });
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "wrong");
  await p.goto(`${w.url}/map/root`);
  const t = p.locator('a[data-tile="b"]');
  await expect(t).toHaveAttribute("data-stale", "true");
  expect(await style(t, "backgroundImage")).not.toContain("repeating-linear-gradient");
  await p.goto(`${w.url}/map/b`);
  await expect(p.locator('[data-section="stale"]')).toContainText("#a");
  await expect(p.locator('[data-section="stale"]')).toContainText("rejected");
});
