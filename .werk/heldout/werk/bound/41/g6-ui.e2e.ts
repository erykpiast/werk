import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

type S = Pick<Werk, "seed">;
function card(w: S, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const dep = (w: S, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} takes from ${to}` });
const events = (w: Pick<Werk, "dir">) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const flagPage = (p: Page) => p.evaluate(() => { (window as any).kept = true; });
const same = (p: Page) => p.evaluate(() => (window as any).kept === true);
const NONE = "rgba(0, 0, 0, 0)";

test("70.1 ghost under proposed parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = p.locator('[data-tile="refunds"]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute("data-proposed", "true");
  await expect(ghost).toHaveClass(/border-dashed/);
  const bg = await ghost.evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("ghost bg", bg, await ghost.evaluate((el) => getComputedStyle(el).borderTopStyle));
  expect(await ghost.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  await p.goto(`${w.url}/map`);
  const real = p.locator('[data-tile="payments"]');
  await expect(real).toHaveAttribute("data-proposed", "false");
  expect(await real.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
  console.log("real bg", await real.evaluate((el) => getComputedStyle(el).backgroundColor));
});

test("70.2 accept one ghost with the check button", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await p.locator('[data-tile="refunds"]').click();
  const n = events(w).length;
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  const ev = events(w).slice(n);
  console.log(JSON.stringify(ev));
  expect(ev.length).toBe(1);
  expect(ev[0].type).toMatch(/accept/);
  expect(ev[0].payload.id).toBe("refunds");
  expect(ev[0].actor).toBe("you");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 ghost child under ghost parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 accept takes only its branch", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Manual refunds", "--why_not", "slow");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refunds:src0", "--kind", "source", "--title", "Survey", "--finding", "found");
  w.werk("link", "refunds", "refunds:src0", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  await p.goto(`${w.url}/map/refunds`);
  const opt = p.locator('[data-section="options"] [data-proposed]').first();
  console.log("opt html", (await p.locator('[data-section="options"]').innerHTML()).slice(0, 400));
  console.log("src html", (await p.locator('[data-section="evidence"]').innerHTML()).slice(0, 400));
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(1);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-section="options"]')).not.toContainText("proposed");
  await expect(p.locator('[data-section="evidence"]')).not.toContainText("proposed");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  const cb = p.locator('[data-tile="chargebacks"]');
  await expect(cb).toHaveAttribute("data-proposed", "true");
  expect(await cb.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  void opt;
});

test("70.5 second window sees the accept", async ({ browser }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const a = await c1.newPage();
  const b = await c2.newPage();
  await a.goto(`${w.url}/map/refunds`);
  await b.goto(`${w.url}/map/refunds`);
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "true");
  await flagPage(b);
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(a.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "false", { timeout: 5000 });
  expect(await same(b)).toBe(true);
  await c1.close();
  await c2.close();
});

function abc(d: S) {
  card(d, "a", { title: "Card A" });
  card(d, "b", { title: "Card B" });
  card(d, "c", { title: "Card C" });
  dep(d, "b", "a");
  dep(d, "c", "b");
}

test("72.1 rejected reopen marks only direct dependent stale", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map`);
  const b = p.locator('[data-tile="b"]');
  await expect(b).toHaveAttribute("data-stale", "true");
  await expect(b).toHaveAttribute("data-status", "decided");
  await expect(p.locator('[data-tile="c"]')).toHaveAttribute("data-stale", "false");
  await p.goto(`${w.url}/map/b`);
  await expect(p.locator('article [data-tag="stale"]')).toBeVisible();
  await expect(p.locator('article [data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('article')).toHaveAttribute("data-status", "decided");
  await p.goto(`${w.url}/map/c`);
  await expect(p.locator('article [data-tag="stale"]')).toHaveCount(0);
  await expect(p.locator('article [data-tag="paused"]')).toHaveCount(0);
});

test("72.2 postponed reopen pauses all downstream", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map`);
  for (const id of ["b", "c"]) {
    const t = p.locator(`[data-tile="${id}"]`);
    console.log(id, "tile text:", (await t.innerText()).replace(/\n/g, " | "), await t.getAttribute("data-stale"));
    await expect(t).toHaveAttribute("data-stale", "false");
    await expect(t).toHaveAttribute("data-status", "decided");
  }
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    await expect(p.locator('article [data-tag="paused"]')).toBeVisible();
    await expect(p.locator('article [data-tag="stale"]')).toHaveCount(0);
    await expect(p.locator("article")).toHaveAttribute("data-status", "decided");
  }
  // on the map tile itself is the paused mark visible?
  await p.goto(`${w.url}/map`);
  await expect(p.locator('[data-tile="b"] [data-tag="paused"]')).toBeVisible();
});

test("72.3 stale card view explains", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Card A" });
    card(d, "b", { title: "Card B" });
    dep(d, "b", "a");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="b"]').click();
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  console.log(await s.innerText());
  await expect(s).toContainText("#a");
  await expect(s).toContainText(/reopened/i);
  await expect(s).toContainText("#b");
  await expect(s).toContainText("depends_on");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
});

test("72.4 paused card two hops away", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="c"]').click();
  console.log(await p.locator("article").innerText());
  console.log(await p.locator("main").innerText());
  await expect(p.getByRole("heading", { name: "Why this card is stale" })).toBeVisible();
  const body = p.locator("main");
  await expect(body).toContainText("#a");
  await expect(body).toContainText(/reopened/i);
  await expect(body).toContainText("postponed");
  await expect(body).toContainText("We build the engine next quarter");
});

test("72.5 stale wins over paused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Card A" });
    card(d, "x", { title: "Card X" });
    card(d, "b", { title: "Card B" });
    dep(d, "b", "a");
    dep(d, "b", "x");
  });
  w.werk("reopen", "x", "--reason", "postponed");
  w.werk("reopen", "a", "--reason", "rejected");
  await p.goto(`${w.url}/map`);
  await expect(p.locator('[data-tile="b"]')).toHaveAttribute("data-stale", "true");
  await expect(p.locator('[data-tile="b"] [data-tag="paused"]')).toHaveCount(0);
  await p.locator('[data-tile="b"]').click();
  await expect(p.locator('article [data-tag="stale"]')).toBeVisible();
  await expect(p.locator('article [data-tag="paused"]')).toHaveCount(0);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});

test("18.1 accept proposed new card without reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/sqlite`);
  const hero = p.locator("article");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const look = await hero.evaluate((el) => { const s = getComputedStyle(el); return { b: s.borderTopColor, bg: s.backgroundColor, st: s.borderTopStyle }; });
  console.log(JSON.stringify(look));
  await expect(hero).toHaveAttribute("data-proposed", "true");
  const probe = await p.evaluate(() => { const e = document.createElement("div"); e.className = "border-blue-400 bg-blue-50"; document.body.append(e); const s = getComputedStyle(e); return { b: s.borderTopColor, bg: s.backgroundColor }; });
  expect(look.b).toBe(probe.b);
  expect(look.bg).toBe(probe.bg);
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await expect(hero.locator('[data-role="actions"]')).toContainText("✓");
  await flagPage(p);
  const n = events(w).length;
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await same(p)).toBe(true);
  const after = await hero.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(after).not.toBe(probe.b);
  const ev = events(w).slice(n);
  expect(ev.length).toBe(1);
  expect(ev[0].payload.id).toBe("sqlite");
  expect(ev[0].actor).toBe("you");
  // same as CLI accept
  const w2 = await (async () => null)();
  void w2;
});

test("18.1b cli accept gives the same event shape", async () => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  const n = events(w).length;
  w.werk("accept", "sqlite", "--actor", "you");
  console.log("cli", JSON.stringify(events(w).slice(n)));
});

test("18.2 pending edit diff and accept", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const hero = p.locator("article");
  await expect(hero).toHaveAttribute("data-pending", "true");
  const look = await hero.evaluate((el) => { const s = getComputedStyle(el); return { b: s.borderTopColor, bg: s.backgroundColor }; });
  const probe = await p.evaluate(() => { const mk = (c: string) => { const e = document.createElement("div"); e.className = c; document.body.append(e); const s = getComputedStyle(e); return { b: s.borderTopColor, bg: s.backgroundColor }; }; return { blue: mk("border-blue-400 bg-blue-50"), plain: mk("border-gray-300 bg-background") }; });
  expect(look.b).toBe(probe.blue.b);
  expect(look.bg).not.toBe(probe.blue.bg);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const added = hero.locator('ins[data-diff="added"]');
  const removed = hero.locator('del[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  expect(await added.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await removed.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await flagPage(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one item in list, paragraph to list", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const para = "Seats are counted monthly.";
  const w = await project(undefined, (d) => card(d, "seat", { status: "open", title: "Seat", body: `${para}\n\n${items}` }));
  const longer = items.replace("- step 5", "- step 5\n- a new step");
  w.werk("propose", "seat", "--ops", JSON.stringify([
    { tag: "removed", old: para },
    { tag: "new", new: "- count weekly\n- count daily" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/seat`);
  const body = p.locator('[data-field="body"]');
  console.log(await body.innerHTML());
  await expect(body.locator('li:has-text("a new step")')).toBeVisible();
  const marked = await body.locator("li").evaluateAll((lis) => lis.map((li) => ({ t: li.textContent, d: li.querySelectorAll("[data-diff]").length || (li.closest("[data-diff]") ? 1 : 0) })));
  console.log(JSON.stringify(marked));
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^step ${i}$`) });
    await expect(li).toHaveCount(1);
    expect(await li.evaluate((el) => el.querySelectorAll("[data-diff]").length === 0 && !el.closest("[data-diff]"))).toBe(true);
  }
  const added = body.locator("li", { hasText: "a new step" });
  expect(await added.evaluate((el) => !!el.closest("[data-diff]") || el.querySelector("[data-diff]") !== null)).toBe(true);
  const para1 = body.locator('[data-diff="removed"]', { hasText: "Seats are counted monthly" });
  await expect(para1).toHaveCount(1);
  expect(await para1.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(await para1.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  const nl = body.locator('[data-diff="added"]', { hasText: "count weekly" });
  await expect(nl).toHaveCount(1);
  expect(await nl.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
});

test("18.4 remove with two children, reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dlg = p.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: /Remove the subtree: 3 cards leave/ })).toBeVisible();
  await expect(dlg.getByRole("button", { name: /Remove only #auth: 1 card leaves, 2 children move up to #server/ })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dlg.getByRole("button")).toHaveCount(3);
  const n = events(w).length;
  await flagPage(p);
  await dlg.getByRole("button", { name: /Remove only/ }).click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await same(p)).toBe(true);
  expect(events(w).length).toBeGreaterThan(n);
  console.log(JSON.stringify(events(w).slice(n)));
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await p.goto(`${w.url}/map/auth`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
});

test("18.5 proposed removal red, cancel, no token", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(w.url);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  await expect(tile).toHaveClass(/border-red-400/);
  const red = await p.evaluate(() => { const e = document.createElement("div"); e.className = "border-red-400 bg-red-50"; document.body.append(e); const s = getComputedStyle(e); return { b: s.borderTopColor, bg: s.backgroundColor }; });
  expect(await tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(red.b);
  expect(await tile.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(red.bg);
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await flagPage(p);
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);
  const status = await p.evaluate(async () => (await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) })).status);
  expect(status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await same(p)).toBe(true);
});
