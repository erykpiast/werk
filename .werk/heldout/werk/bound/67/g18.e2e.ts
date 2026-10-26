// Held-out steps 18.1-18.5: the ✓ and ✕ on the card page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const card = (w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
const flag = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const kept = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const logOf = (w: Werk) => readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
const events = (w: Werk) =>
  logOf(w)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const NONE = "rgba(0, 0, 0, 0)";
/** Whether an rgb/oklch colour reads as blue: blue channel clearly over red. */
const isBlue = (c: string) => {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
  if (m) return Number(m[3]) > Number(m[1]) + 20;
  const o = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(c);
  return o !== null && Number(o[2]) > 0.012 && Number(o[3]) > 220 && Number(o[3]) < 290;
};
const isRed = (c: string) => {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
  if (m) return Number(m[1]) > Number(m[3]) + 20;
  const o = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(c);
  return o !== null && Number(o[2]) > 0.05 && (Number(o[3]) < 40 || Number(o[3]) > 340);
};
const look = (p: Page) =>
  p.locator("article").evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, background: s.backgroundColor };
  });

test("18.1 accepting a proposed new card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Use SQLite");
  const before = await look(p);
  expect(isBlue(before.border)).toBe(true);
  expect(isBlue(before.background)).toBe(true);
  await expect(p.locator('article [data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = p.locator('article [data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await expect(p.locator('[data-action="discard"]')).toHaveCount(0);

  const count = events(w).length;
  await flag(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(await kept(p)).toBe(true);
  await expect(p.locator('article [data-tag="proposed"]')).toHaveCount(0);
  const after = await look(p);
  expect(isBlue(after.border), after.border).toBe(false);
  const added = events(w).slice(count);
  expect(added.map((e) => [e.type, e.actor, e.payload.id])).toEqual([["change.accepted", "you", "use-sqlite"]]);
  // The CLI accept writes the same event shape (seen in its own log: change.accepted, actor you, {id}).
  expect(w.werk("show", "use-sqlite")).not.toContain("proposed");
});

test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
    ]),
  );
  await p.goto(`${w.url}/map/cache`);
  const hero = p.locator("article");
  await expect(hero).toHaveAttribute("data-pending", "true");
  const l = await look(p);
  expect(isBlue(l.border)).toBe(true);
  expect(isBlue(l.background)).toBe(false);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const ins = hero.locator('ins[data-diff="added"]');
  const del = hero.locator('del[data-diff="removed"]');
  await expect(ins).toHaveText("ten");
  await expect(del).toHaveText("five");
  for (const m of [ins, del]) {
    const bg = await m.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe(NONE);
    expect(isBlue(bg)).toBe(true);
  }
  expect(await del.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await kept(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Old paragraph text.";
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "list", { title: "A list", body: `${para}\n\n${items}` });
    d.seed("kill.added", { id: "list", criterion: { form: "revisit" } });
  });
  w.werk(
    "propose",
    "list",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- new list one\n- new list two" },
      { tag: "elaborated", old: items, new: items.replace("- item 5", "- item 5\n- inserted item") },
    ]),
  );
  await p.goto(`${w.url}/map/list`);
  const body = p.locator('[data-field="body"]');
  const inserted = body.locator("li", { hasText: "inserted item" });
  await expect(inserted.locator("[data-diff]")).toHaveCount(1);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("[data-diff]")).toHaveCount(0);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: "Old paragraph" });
  await expect(removed).toHaveCount(1);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(await removed.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
  const added = body.locator('[data-diff="added"]', { hasText: "new list one" });
  await expect(added).toHaveCount(1);
  expect(await added.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(NONE);
});

test("18.4 removing a card with two children offers subtree removal or reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /1 card.*Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const count = events(w).length;
  await flag(p);
  await reparent.click();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  // The page redraws on the removed card's parent, Server.
  await expect(p).toHaveURL(/\/map\/server$/);
  expect(await kept(p)).toBe(true);
  expect(
    events(w)
      .slice(count)
      .map((e) => e.type),
  ).toEqual(["node.removed"]);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator("[data-tile]")).toHaveCount(1);
  const show = w.werk("show", "auth");
  expect(show).toContain("parent: server");
  expect(show).toContain("tokens");
  expect(show).toContain("sessions");
});

test("18.5 a proposed removal shows in red, cancel changes nothing, a tokenless write is refused", async ({
  page: p,
  context,
}) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/legacy`);
  const l = await look(p);
  expect(isRed(l.border) || isRed(l.background)).toBe(true);

  await p.goto(`${w.url}/map/notes`);
  const before = logOf(w);
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(logOf(w)).toBe(before);

  await flag(p);
  const other = await context.newPage();
  await other.goto(`${w.url}/map/root`);
  const status = await other.evaluate(async () => {
    const r = await fetch("/api/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "notes" }),
    });
    return r.status;
  });
  expect(status).toBeGreaterThanOrEqual(400);
  expect(logOf(w)).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await kept(p)).toBe(true);
});
