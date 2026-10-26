// Held-out: review actions in the browser (steps 18.x).
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, f: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
}
const flag = (p: Page) => p.evaluate(() => { (window as unknown as { kept: boolean }).kept = true; });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const events = (w: { dir: string }) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const NONE = "rgba(0, 0, 0, 0)";

test("18.1 accepting a proposed card with ✓", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "cli-twin", "--title", "Twin", "--parent", "storage");
  await p.goto(`${w.url}/map/sqlite`);
  const hero = p.locator('article[data-card="sqlite"]');
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const probe = await p.evaluate(() => {
    const e = document.createElement("span");
    e.className = "border-blue-400 bg-blue-50";
    e.style.borderStyle = "solid";
    e.style.borderWidth = "1px";
    document.body.append(e);
    const s = getComputedStyle(e);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });
  const look = await hero.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor }));
  expect(look.border).toBe(probe.border);
  expect(look.bg).toBe(probe.bg);
  await expect(p.locator('[data-role="actions"] [data-action="accept"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  const before = events(w).length;
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await hero.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(after).not.toBe(probe.border);
  expect(await same(p)).toBe(true);
  const log = events(w);
  expect(log.length).toBe(before + 1);
  const last = log[log.length - 1];
  expect(last.type).toBe("change.accepted");
  expect(last.actor).toBe("you");
  // same result as CLI
  const r = await w.werk("accept", "cli-twin", "--actor", "you");
  const twin = events(w).at(-1);
  expect({ type: twin.type, payload: twin.payload, actor: twin.actor }).toEqual({ type: last.type, payload: { ...last.payload, id: "cli-twin" }, actor: last.actor });
  void r;
});

test("18.2 pending edit shows a diff and accept amends", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const hero = p.locator('article[data-card="cache"]');
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero).toHaveAttribute("data-pending", "true");
  const probe = await p.evaluate(() => {
    const e = document.createElement("span");
    e.className = "border-blue-400 bg-blue-50";
    e.style.borderStyle = "solid";
    e.style.borderWidth = "1px";
    document.body.append(e);
    const s = getComputedStyle(e);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  });
  const look = await hero.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor }));
  expect(look.border).toBe(probe.border);
  expect(look.bg).not.toBe(probe.bg);
  const ins = hero.locator("ins[data-diff]");
  const del = hero.locator("del[data-diff]");
  await expect(ins).toHaveText("ten");
  await expect(del).toHaveText("five");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  expect(await ins.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  expect(await del.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  expect(await del.evaluate((e) => getComputedStyle(e).textDecorationLine)).toContain("line-through");
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => {
    card(d, "plan", { status: "open", title: "Plan", body: `Old intro paragraph.\n\n${items}` });
  });
  const longer = items.replace("- step 5", "- step 5\n- a new step");
  w.werk("propose", "plan", "--ops", JSON.stringify([
    { tag: "removed", old: "Old intro paragraph." },
    { tag: "new", new: "- alpha\n- beta" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/plan`);
  const body = p.locator('[data-field="body"]');
  const added = body.locator("li", { hasText: "a new step" });
  await expect(added).toHaveCount(1);
  expect(await added.evaluate((e) => e.querySelector("[data-diff]") !== null || e.closest("[data-diff]") !== null)).toBe(true);
  expect(await added.locator("[data-diff]").first().evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^step ${i}$`) });
    await expect(li).toHaveCount(1);
    expect(await li.evaluate((e) => e.querySelector("[data-diff]") !== null || e.closest("[data-diff]") !== null)).toBe(false);
  }
  const old = body.locator('[data-diff="removed"]', { hasText: "Old intro paragraph." });
  await expect(old).toHaveCount(1);
  expect(await old.evaluate((e) => getComputedStyle(e).textDecorationLine)).toContain("line-through");
  expect(await old.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(NONE);
  const alpha = body.locator("li", { hasText: "alpha" });
  expect(await alpha.evaluate((e) => (e.closest("[data-diff]") ?? e.querySelector("[data-diff]"))?.getAttribute("data-diff"))).toBe("added");
  expect(await alpha.evaluate((e) => getComputedStyle(e.closest("[data-diff]") ?? e.querySelector("[data-diff]") ?? e).backgroundColor)).not.toBe(NONE);
});

test("18.4 removing a card with two children asks once; reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await flag(p);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Server/ })).toContainText("1 card leaves");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const before = events(w).length;
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p.locator('[data-missing]').or(p.locator('[data-tile="tokens"]'))).toBeVisible();
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  expect(events(w).length).toBe(before + 1);
  await w.werk("restore", "auth", "--actor", "you");
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

test("18.5 proposed removal red, cancel changes nothing, no-token write refused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(w.url);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  const red = await p.evaluate(() => {
    const e = document.createElement("span");
    e.className = "bg-red-50 border-red-400";
    e.style.borderStyle = "solid";
    document.body.append(e);
    return getComputedStyle(e).borderTopColor;
  });
  expect(await tile.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(red);
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  const port = new URL(w.url).port;
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/api/remove", method: "POST", headers: { host: `localhost:${port}`, origin: "http://evil.example", "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end(JSON.stringify({ id: "notes" }));
  });
  expect([401, 403]).toContain(status);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
});
