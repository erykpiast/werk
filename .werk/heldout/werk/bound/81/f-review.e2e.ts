import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const events = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; actor: string; payload: Record<string, unknown> });
const flag = (p: Page) => p.evaluate(() => { (window as unknown as { kept: boolean }).kept = true; });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const accept = (p: Page) => p.getByRole("button", { name: "Accept" });
const NONE = "rgba(0, 0, 0, 0)";

test("18.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "other", "--title", "Other ghost", "--parent", "storage");
  await p.goto(`${w.url}/map/storage`);
  const tile = p.locator('a[data-tile="sqlite"]');
  await expect(tile).toHaveClass(/border-blue-400/);
  await expect(tile).toHaveClass(/bg-blue-50/);
  await expect(tile.locator('[data-tag="proposed"]')).toHaveText("proposed");
  await tile.click();
  const hero = p.locator("article");
  await expect(hero).toHaveAttribute("data-proposed", "true");
  await expect(hero).toHaveClass(/border-blue-400/);
  await expect(hero).toHaveClass(/bg-blue-50/);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  await expect(accept(p)).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flag(p);
  await accept(p).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero).not.toHaveClass(/border-blue-400/);
  expect(await same(p)).toBe(true);
  const ev = events(w).filter((e) => e.type === "change.accepted");
  expect(ev.length).toBe(1);
  expect(ev[0].payload.id).toBe("sqlite");
  expect(ev[0].actor).toBe("you");
  // the same as from the command line
  w.werk("accept", "other", "--actor", "you");
  const cli = events(w).filter((e) => e.type === "change.accepted")[1];
  expect({ type: cli.type, actor: cli.actor }).toEqual({ type: ev[0].type, actor: ev[0].actor });
  expect(Object.keys(cli.payload)).toEqual(Object.keys(ev[0].payload));
});

test("18.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(w.url);
  await p.locator('[data-tile="cache"]').click();
  const hero = p.locator("article");
  await expect(hero).toHaveAttribute("data-pending", "true");
  const look = await hero.evaluate((el) => { const s = getComputedStyle(el); return { b: s.borderTopColor, bg: s.backgroundColor, w: s.borderTopWidth }; });
  expect(look.b).not.toBe("rgb(209, 213, 219)");
  await expect(hero).not.toHaveClass(/bg-blue/);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const ins = hero.locator('ins[data-diff="added"]');
  const del = hero.locator('del[data-diff="removed"]');
  await expect(ins).toHaveText("ten");
  await expect(del).toHaveText("five");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  expect(await ins.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  expect(await del.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  expect(await del.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("line-through");
  await flag(p);
  await accept(p).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "list", { title: "A list", body: `Old paragraph here.\n\n${items}` });
    d.seed("kill.added", { id: "list", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- step 5", "- step 5\n- middle item");
  w.werk("propose", "list", "--ops", JSON.stringify([
    { tag: "removed", old: "Old paragraph here." },
    { tag: "new", new: "- fresh one\n- fresh two" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/list`);
  const body = p.locator('[data-field="body"]');
  const mid = body.locator("li", { hasText: "middle item" });
  await expect(mid).toHaveCount(1);
  const marked = (loc: import("@playwright/test").Locator) =>
    loc.evaluate((el) => !!el.closest("[data-diff]") || !!el.querySelector("[data-diff]"));
  expect(await marked(mid)).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^step ${i}$`) });
    await expect(li).toHaveCount(1);
    expect(await marked(li)).toBe(false);
  }
  const old = body.locator("[data-diff]", { hasText: "Old paragraph here." }).first();
  await expect(old).toBeVisible();
  expect(await old.evaluate((e) => getComputedStyle(e).textDecorationLine)).toContain("line-through");
  expect(await old.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  const fresh = body.locator("li", { hasText: "fresh one" });
  expect(await marked(fresh)).toBe(true);
  expect(await fresh.evaluate((e) => getComputedStyle(e.closest("[data-diff]") ?? e.querySelector("[data-diff]") ?? e).backgroundColor)).not.toBe(NONE);
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
  await expect(dialog.getByRole("button", { name: /Remove the subtree: 3 cards leave/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*move up to #server/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await flag(p);
  const before = events(w).length;
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await same(p)).toBe(true);
  const after = events(w);
  expect(after.length).toBe(before + 1);
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

test("18.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(w.url);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  const red = await tile.evaluate((el) => getComputedStyle(el).borderTopColor);
  await expect(tile).toHaveClass(/border-red-400/);
  expect(red).toContain("22.");
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.locator('[data-tile], h1').first()).toBeVisible();
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  const res = await p.request.post(`${w.url}/api/remove`, { data: { id: "notes" } });
  expect(res.status()).toBe(403);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
});

async function ghosts(w: Werk) {
  w.werk("add", "payments", "--title", "Payments", "--parent", "root");
  w.werk("accept", "payments", "--actor", "you");
}

test("70.1", async ({ page: p }) => {
  const w = await project();
  await ghosts(w);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('a[data-tile="refunds"]');
  await expect(tile).toBeVisible();
  const s = await tile.evaluate((el) => { const c = getComputedStyle(el); return { style: c.borderTopStyle, color: c.borderTopColor }; });
  expect(s.style).toBe("dashed");
  const chroma = Number(s.color.match(/oklch\([\d.]+ ([\d.]+)/)?.[1] ?? "0");
  expect(chroma).toBeLessThan(0.03);
  const hero = await p.locator("article").first().evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(hero).not.toBe("dashed");
  await p.goto(`${w.url}/map/root`);
  const pay = await p.locator('a[data-tile="payments"]').evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(pay).not.toBe("dashed");
});

test("70.2", async ({ page: p }) => {
  const w = await project();
  await ghosts(w);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const before = events(w).length;
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(accept(p)).toHaveCount(0);
  const ev = events(w).slice(before);
  expect(ev.length).toBe(1);
  expect(ev[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await p.goto(`${w.url}/map/payments`);
  const st = await p.locator('a[data-tile="refunds"]').evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(st).not.toBe("dashed");
});

test("70.3", async ({ page: p }) => {
  const w = await project();
  await ghosts(w);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('a[data-tile="partial"]')).toBeVisible();
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toBeVisible();
  await expect(p.locator('a[data-tile="refunds"]')).not.toHaveClass(/border-blue/);
});

test("70.4", async ({ page: p }) => {
  const w = await project();
  await ghosts(w);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Opt", "--why_not", "nope");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "src", "--kind", "source", "--title", "Src", "--finding", "f");
  w.werk("link", "refunds", "src", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
  await accept(p).click();
  await expect(p.locator("article").first()).toHaveAttribute("data-proposed", "false");
  const show = (id: string) => w.werk("show", id);
  expect(show("refunds:opt0")).not.toContain("proposed");
  expect(show("src")).not.toContain("proposed");
  const evs = events(w).filter((e) => e.type === "change.accepted").map((e) => e.payload.id);
  expect(evs).toEqual(expect.arrayContaining(["refunds", "refunds:opt0", "src"]));
  expect(evs).not.toContain("chargebacks");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="chargebacks"]')).toHaveClass(/border-dashed/);
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
});

test("70.5", async ({ browser }) => {
  const w = await project();
  await ghosts(w);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const a = await c1.newPage();
  const b = await c2.newPage();
  await a.goto(`${w.url}/map/refunds`);
  await b.goto(`${w.url}/map/refunds`);
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "true");
  await accept(a).click();
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(accept(b)).toHaveCount(0);
});
