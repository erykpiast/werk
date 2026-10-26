import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

type Seeder = Pick<Werk, "seed">;
function card(w: Seeder, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const flag = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const heading = (p: Page) => p.getByRole("heading", { level: 1 });

// ---------- 10.x notes in the browser ----------
test("10.1 an agent's note appears on the card's thread, marked as the agent's", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "auth-login", { title: "Login uses magic links" }));
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="auth-login"]').click();
  await expect(heading(p)).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2 person-typed notes are read from the inbox in order, since a position and capped", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "auth-login", { title: "Login" }));
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.werk("inbox");
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)/gm)];
  expect(entries.length).toBe(4);
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(entries.every((m) => m[2] === "auth-login")).toBe(true);
  const first = entries[0]![1]!;
  const since = w.werk("inbox", "--since", first);
  expect(since).not.toContain("first");
  expect(since).toContain("fourth");
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
});

test("10.3 a corrected ghost keeps earlier notes with one marker", async ({ page: p }) => {
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
  await expect(entries.nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(heading(p)).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
});

test("10.5 an agent's note on an excerpt shows on its thread", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749" });
  w.seed("excerpt.quoted", { id: "src-rfc-quote", title: "The client MAY retry.", card: "root", conversation: "oauth", session: "s1", message: 0, start: 0, end: 21, speaker: "person", said_at: "t0" });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---------- 70.x ghosts in the map ----------
test("70.1 a proposed card shows as a ghost under its proposed parent: grey and dashed", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = p.locator('a[data-tile="refunds"]');
  await expect(ghost).toBeVisible();
  const g = await ghost.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.borderTopStyle, color: s.borderTopColor, bg: s.backgroundColor };
  });
  expect(g.style).toBe("dashed");
  // grey: equal red/green/blue channels or an oklch with near-zero chroma
  const grey = (c: string) => {
    const m = /oklch\(([\d.]+) ([\d.]+)/.exec(c);
    if (m) return Number(m[2]) < 0.03;
    const r = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
    return r !== null && Math.abs(Number(r[1]) - Number(r[2])) < 12 && Math.abs(Number(r[2]) - Number(r[3])) < 12;
  };
  expect(grey(g.color), `ghost border colour is ${g.color}`).toBe(true);
  await p.goto(`${w.url}/map/root`);
  const real = await p.locator('a[data-tile="payments"]').evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(real).toBe("solid");
});

test("70.2 the ✓ on a ghost makes it real, one accept event", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const n = logLines(w).length;
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  const added = logLines(w).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('a[data-tile="partial"]')).toBeVisible();
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the branch of the card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Opt", "--why_not", "no");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "src1", "--kind", "source", "--title", "Src", "--finding", "f");
  w.werk("link", "refunds", "src1", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(1);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article").first()).toHaveAttribute("data-proposed", "false");
  const show = w.werk("show", "refunds");
  expect(show).not.toContain("proposed");
  await p.goto(`${w.url}/map/payments`);
  const cb = p.locator('a[data-tile="chargebacks"]');
  await expect(cb).toHaveAttribute("data-proposed", "true");
  expect(await cb.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  const c = await cb.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(c, "chargebacks ghost border should be grey").not.toMatch(/254|blue/);
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
});

test("70.5 a second window sees the accept", async ({ browser }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
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

// ---------- 18.x review in the browser ----------
test("18.1 the ✓ on a proposed card makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/sqlite`);
  const art = p.locator("article");
  const look = await art.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });
  expect(look.border).toMatch(/254|blue|rgb\(\d+, \d+, 2\d\d\)/);
  expect(look.bg).toMatch(/254/);
  await expect(art.locator('[data-tag="proposed"]')).toHaveText("proposed");
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(art).toHaveAttribute("data-proposed", "false");
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await same(p)).toBe(true);
  const last = logLines(w).at(-1);
  expect(last).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "sqlite" } });
  // same as the CLI accept
  w.werk("add", "other", "--title", "Other", "--parent", "storage");
  w.werk("accept", "other", "--actor", "you");
  const cli = logLines(w).at(-1);
  expect({ type: cli.type, actor: cli.actor }).toEqual({ type: last.type, actor: last.actor });
});

test("18.2 a pending edit shows as a diff, accept amends", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const art = p.locator("article");
  const look = await art.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });
  expect(look.border).toMatch(/254|blue|rgb\(\d+, \d+, 2\d\d\)|oklch/);
  expect(look.bg).not.toMatch(/254/);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  const added = art.locator('ins[data-diff="added"]');
  const removed = art.locator('del[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  await expect(art.locator("[data-diff]")).toHaveCount(2);
  expect(await added.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "plan", { title: "Plan", body: `This is the old paragraph.\n\n${items}` });
    d.seed("kill.added", { id: "plan", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- step 5", "- step 5\n- a new step");
  w.werk("propose", "plan", "--ops", JSON.stringify([
    { tag: "elaborated", old: "This is the old paragraph.", new: "- brand one\n- brand two" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/plan`);
  const body = p.locator('[data-field="body"]');
  await expect(body.locator("li", { hasText: "a new step" }).locator("ins, [data-diff]").first()).toBeVisible();
  const oldItems = body.locator("li").filter({ hasText: /^step \d+$/ });
  await expect(oldItems).toHaveCount(10);
  await expect(oldItems.locator("[data-diff]")).toHaveCount(0);
  const removed = body.locator('[data-diff="removed"]');
  await expect(removed.first()).toContainText("old paragraph");
  expect(await removed.first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(await removed.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  const added = body.locator('[data-diff="added"]', { has: p.locator("li", { hasText: "brand one" }) });
  await expect(added).toHaveCount(1);
  expect(await added.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("18.4 removing a card with two children offers subtree or reparent with counts", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /Remove the subtree: 3 cards leave/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await flag(p);
  const n = logLines(w).length;
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p).toHaveURL(/\/map\/server$/);
  expect(await same(p)).toBe(true);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  const added = logLines(w).slice(n);
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("node.removed");
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

test("18.5 proposed removal in red; cancel changes nothing; write without token refused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  await expect(tile).toHaveClass(/border-red/);
  const bg = await tile.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toMatch(/oklch\(0\.9\d* 0\.0\d* (1\d|2\d|[0-9])\.|rgb\(25\d, 2\d\d, 2\d\d\)/);
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(heading(p)).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);
  const status = await p.evaluate(async () => (await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) })).status);
  expect(status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(heading(p)).toHaveText("Old notes");
});

// ---------- 13.x / 14.1-14.2 / 69.x ----------
function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token === undefined ? {} : { "x-werk-token": o.token }) } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

test("13.3 a page stays in step when a card is added on the command line (two tabs)", async ({ browser }) => {
  const w = await project(undefined, (d) => card(d, "one", { title: "Card one" }));
  const ctx = await browser.newContext();
  const pages = [await ctx.newPage(), await ctx.newPage()];
  for (const p of pages) {
    await p.goto(`${w.url}/map`);
    await expect(p.locator('a[data-tile="one"]')).toBeVisible();
    await flag(p);
    await p.evaluate(() => {
      const w = window as unknown as { signals: string[] };
      w.signals = [];
      const es = new EventSource("/api/events");
      es.addEventListener("changed", (e) => w.signals.push((e as MessageEvent).data));
    });
  }
  await pages[0]!.waitForTimeout(300);
  w.werk("add", "two", "--title", "Second distinct card", "--why", "SECRETWHY", "--parent", "root");
  for (const p of pages) {
    await expect(p.locator('a[data-tile="two"]')).toBeVisible();
    await expect(p.locator('a[data-tile="one"]')).toBeVisible();
    expect(await same(p)).toBe(true);
    const sig = await p.evaluate(() => (window as unknown as { signals: string[] }).signals);
    expect(sig.length).toBe(1);
    expect(sig[0]).not.toContain("Second distinct");
    expect(sig[0]).not.toContain("SECRETWHY");
  }
  await ctx.close();
});

test("13.4 a card added while the server was down shows on first load; overview holds no body", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "one", { title: "Card one" });
    down.werk("add", "invoice", "--title", "The invoice shows the seat count", "--why", "A customer checks the bill", "--body", "Each line names the seats billed", "--parent", "one");
  });
  await p.goto(`${w.url}/map/one`);
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  await p.goto(`${w.url}/map`);
  await expect(p.locator('a[data-tile="one"]')).toBeVisible();
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  await p.goto(`${w.url}/map/one`);
  await p.locator('a[data-tile="invoice"]').click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Each line names the seats billed");
  await expect(p.locator('[data-field="why"]')).toContainText("A customer checks the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="one"]')).toContainText("Card one");
});

test("13.5 only the person's own page can write", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBe(403);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "retry" });
});

test("14.1 addresses, back and forward, unknown card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", { title: "Child" }));
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/nobody-has-this`);
  await expect(p.locator("#view")).toContainText(/not (found|in the map)|does not hold|no card/i);
  await expect(heading(p).filter({ hasText: /^(Root|Child)$/ })).toHaveCount(0);
});

test("14.2 a card added from the command line appears on the open page, composer kept", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await flag(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator('a[data-tile="fresh"]')).toBeVisible();
  expect(await same(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("69.1 the map shows the fixture as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "c1", { title: "Child one" });
    card(d, "c2", { title: "Child two" });
    card(d, "g1", { title: "Grandchild", parent: "c1" });
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="c1"]')).toBeVisible();
  await expect(p.locator('a[data-tile="c2"]')).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p.locator('a[data-tile="g1"]')).toBeVisible();
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await flag(p);
  w.werk("add", "use-log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "use-log", "--actor", "you");
  await expect(p.locator('a[data-tile="use-log"]')).toBeVisible({ timeout: 5000 });
  await expect(p.locator('a[data-tile="use-log"]')).toHaveAttribute("data-proposed", "false");
  expect(await same(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", { title: "Child", why: "because", body: "the body" }));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="child"]').click();
  await expect(p).toHaveURL(/\/map\/child$/);
  await expect(heading(p)).toHaveText("Child");
  await expect(p.getByRole("textbox", { name: /title|body|why/i })).toHaveCount(0);
  await expect(p.getByRole("button", { name: /edit|save|rename|retitle/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/child$/);
  await expect(heading(p)).toHaveText("Child");
});
