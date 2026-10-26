import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const real = (w: Pick<Werk, "seed">, id: string, title: string, parent = "root", extra: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title, parent, why: `why ${id}`, ...extra });
const logEvents = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: any });
const css = (at: Locator, prop: string) => at.evaluate((el, p) => (getComputedStyle(el) as any)[p] as string, prop);
/** The rgb of any CSS colour, read through a canvas pixel. */
const rgb = (p: Page, color: string) =>
  p.evaluate((c) => {
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a };
  }, color);
const bluish = (c: { r: number; g: number; b: number; a: number }) => c.a > 0 && c.b > c.r + 15 && c.b >= c.g;
const greyish = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 20;
const flag = (p: Page) => p.evaluate(() => ((window as any).kept = true));
const kept = (p: Page) => p.evaluate(() => (window as any).kept === true);
const card = (p: Page, id: string) => p.locator(`article[data-card="${id}"]`);

test("[18.1] accept a proposed card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    real(d, "storage", "Storage");
    d.seed("node.decided", { id: "storage" });
    d.seed("node.proposed", { id: "sqlite", kind: "card", title: "Use SQLite", parent: "storage" }, undefined as never);
  });
  await p.goto(`${w.url}/map/storage`);
  const tile = p.locator('a[data-tile="sqlite"]');
  await expect(tile).toBeVisible();
  await p.goto(`${w.url}/map/sqlite`);
  const art = card(p, "sqlite");
  await expect(art.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  expect(bluish(await rgb(p, await css(art, "borderTopColor")))).toBe(true);
  expect(bluish(await rgb(p, await css(art, "backgroundColor")))).toBe(true);
  const ok = art.locator('[data-role="actions"] button[data-action="accept"]');
  await expect(ok).toContainText("✓");
  await expect(art.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flag(p);
  const n = logEvents(w).length;
  await ok.click();
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(art).toHaveAttribute("data-proposed", "false");
  expect(await kept(p)).toBe(true);
  expect(bluish(await rgb(p, await css(art, "borderTopColor")))).toBe(false);
  const ev = logEvents(w);
  expect(ev.length).toBe(n + 1);
  expect(ev.at(-1)?.type).toBe("change.accepted");
  expect(ev.at(-1)?.payload.id).toBe("sqlite");
  expect(ev.at(-1)?.actor).toBe("you");
});

function pendingCard(d: Pick<Werk, "seed">, body: string, extra: Record<string, unknown> = {}) {
  d.seed("node.decided", { id: "root" });
  real(d, "cache", "Cache layer", "root", { why: "Reads repeat.", body, status: "decided", who: "me", ...extra });
  d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
}

test("[18.2] a pending edit shows as a diff; accept amends", async ({ page: p }) => {
  const w = await project(undefined, (d) => pendingCard(d, "Entries expire after five minutes."));
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const art = card(p, "cache");
  expect(bluish(await rgb(p, await css(art, "borderTopColor")))).toBe(true);
  expect(bluish(await rgb(p, await css(art, "backgroundColor")))).toBe(false);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(art.locator("ins[data-diff]")).toHaveText("ten");
  await expect(art.locator("del[data-diff]")).toHaveText("five");
  await expect(art.locator("[data-diff]")).toHaveCount(2);
  expect(bluish(await rgb(p, await css(art.locator("ins"), "backgroundColor")))).toBe(true);
  expect(bluish(await rgb(p, await css(art.locator("del"), "backgroundColor")))).toBe(true);
  expect(await css(art.locator("del"), "textDecorationLine")).toContain("line-through");
  await flag(p);
  await art.locator('button[data-action="accept"]').click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await kept(p)).toBe(true);
});

test("[18.3] one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => pendingCard(d, `The old paragraph here.\n\n${items}`));
  const longer = items.replace("- item 5", "- item 5\n- the new item");
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "The old paragraph here.", new: "- first of the new list\n- second of the new list" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/cache`);
  const body = p.locator('[data-field="body"]');
  const newItem = body.locator("li", { hasText: "the new item" });
  await expect(newItem.locator("ins[data-diff]")).toHaveCount(1);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("[data-diff]")).toHaveCount(0);
  }
  const gone = body.locator("[data-diff=removed]", { hasText: "The old paragraph here." });
  await expect(gone).toHaveCount(1);
  expect(await css(gone, "textDecorationLine")).toContain("line-through");
  expect(bluish(await rgb(p, await css(gone, "backgroundColor")))).toBe(true);
  const added = body.locator("[data-diff=added]", { hasText: "first of the new list" });
  await expect(added).toHaveCount(1);
  expect(bluish(await rgb(p, await css(added, "backgroundColor")))).toBe(true);
});

test("[18.4] remove with two children: subtree or reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    real(d, "server", "Server", "root", { status: "decided" });
    real(d, "auth", "Auth", "server", { status: "decided" });
    real(d, "tokens", "Tokens", "auth");
    real(d, "sessions", "Sessions", "auth");
  });
  await p.goto(`${w.url}/map/auth`);
  const before = w.werk("show", "auth");
  await flag(p);
  await card(p, "auth").locator('button[data-action="remove"]').click();
  const dlg = p.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const text = (await dlg.textContent()) ?? "";
  console.log("DIALOG:", text);
  await expect(dlg.getByRole("button")).toHaveCount(3);
  await expect(dlg.getByRole("button", { name: /subtree/i })).toContainText("3 cards leave");
  await expect(dlg.getByRole("button", { name: /Remove only/ })).toContainText("1 card leaves");
  await expect(dlg.getByRole("button", { name: /Remove only/ })).toContainText("Server");
  await expect(dlg.getByRole("button", { name: "Cancel" })).toBeVisible();
  const n = logEvents(w).length;
  await dlg.getByRole("button", { name: /Remove only/ }).click();
  await expect(p.locator("#view a[data-tile]").first()).toBeVisible();
  await expect(p.locator('a[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('a[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('a[data-tile="auth"]')).toHaveCount(0);
  await expect(card(p, "auth")).toHaveCount(0);
  expect(await kept(p)).toBe(true);
  expect(logEvents(w).length).toBe(n + 1);
  expect(logEvents(w).at(-1)?.type).toBe("node.removed");
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('a[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('a[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('a[data-tile="auth"]')).toHaveCount(0);
  w.werk("restore", "auth", "--actor", "you");
  await p.goto(`${w.url}/map/auth`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  expect(w.werk("show", "auth")).toBe(before);
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('a[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('a[data-tile="tokens"]')).toHaveCount(0);
});

test("[18.5] proposed removal red, cancel, no token", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    real(d, "legacy", "Legacy importer", "root", { status: "decided" });
    real(d, "notes", "Old notes", "root", { status: "decided" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/legacy`);
  const art = card(p, "legacy");
  const c = await rgb(p, await css(art, "backgroundColor"));
  expect(c.r).toBeGreaterThan(c.b + 8);
  expect(c.r).toBeGreaterThan(c.g + 8);
  const b = await rgb(p, await css(art, "borderTopColor"));
  expect(b.r).toBeGreaterThan(b.g + 40);
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await card(p, "notes").locator('button[data-action="remove"]').click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(card(p, "notes")).toBeVisible();
  expect(readFileSync(log, "utf8")).toBe(before);
  await flag(p);
  const status = await p.evaluate(async () =>
    (await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) })).status,
  );
  expect(status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(card(p, "notes")).toBeVisible();
  expect(await kept(p)).toBe(true);
});

test("[70.1] a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", "Payments"));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('a[data-tile="refunds"]');
  await expect(tile).toBeVisible();
  const border = await rgb(p, await css(tile, "borderTopColor"));
  const style = await css(tile, "borderTopStyle");
  const bg = await rgb(p, await css(tile, "backgroundColor"));
  console.log("GHOST tile border", border, style, "bg", bg);
  expect(style).toBe("dashed");
  expect(greyish(border) && greyish(bg)).toBe(true);
  await p.goto(`${w.url}/map/root`);
  const real_ = p.locator('a[data-tile="payments"]');
  expect(await css(real_, "borderTopStyle")).not.toBe("dashed");
});

test("[70.2] accept one ghost with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", "Payments"));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const n = logEvents(w).length;
  await card(p, "refunds").locator('button[data-action="accept"]').click();
  await expect(card(p, "refunds")).toHaveAttribute("data-proposed", "false");
  await expect(card(p, "refunds").locator('button[data-action="accept"]')).toHaveCount(0);
  const ev = logEvents(w);
  expect(ev.length).toBe(n + 1);
  expect(ev.at(-1)?.type).toBe("change.accepted");
  expect(ev.at(-1)?.actor).toBe("you");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("[70.3] accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", "Payments"));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await card(p, "partial").locator('button[data-action="accept"]').click();
  await expect(card(p, "partial")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(card(p, "refunds")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('a[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("[70.4] an accept takes only the card's branch", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", "Payments"));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "opt", "--kind", "option", "--title", "Credit only", "--why_not", "customers dislike it");
  w.werk("link", "opt", "refunds", "--type", "alternative_to");
  w.werk("add", "src", "--kind", "source", "--title", "Refund study", "--finding", "f");
  w.werk("link", "refunds", "src", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator('[data-section="options"] [data-id="opt"]')).toBeVisible();
  await card(p, "refunds").locator('button[data-action="accept"]').click();
  await expect(card(p, "refunds")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/opt`);
  await expect(card(p, "opt")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/src`);
  await expect(card(p, "src")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  expect(await css(p.locator('a[data-tile="chargebacks"]'), "borderTopStyle")).toBe("dashed");
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
});

test("[70.5] a second window sees the accept", async ({ browser }) => {
  const w = await project(undefined, (d) => real(d, "payments", "Payments"));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await one.goto(`${w.url}/map/payments`);
  await two.goto(`${w.url}/map/payments`);
  await expect(two.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await one.goto(`${w.url}/map/refunds`);
  await one.locator('button[data-action="accept"]').click();
  await expect(two.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("[06.2] accepted excerpt is real; its link live; card view shows it as evidence", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(w.dir, ".werk", "chats"));
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" })}\n`);
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator('article[data-card]')).toHaveAttribute("data-proposed", "true");
  await p.locator('button[data-action="accept"]').click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/billing`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
});

test("[06.1] a new excerpt stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root", why: "Seats are the unit" });
  w.seed("node.decided", { id: "billing" });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(w.dir, ".werk", "chats"));
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" })}\n`);
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="why"]')).toContainText("Seats are the unit");
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toHaveText("pending");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('button[data-action="accept"]')).toBeVisible();
});
