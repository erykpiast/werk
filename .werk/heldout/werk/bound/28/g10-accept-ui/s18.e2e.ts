import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop } from "../../e2e/project.ts";
import { card, cliOnCopy, events, flagPage, isBlue, isRed, logOf, stillSamePage } from "./common.ts";

test.afterEach(stop);

const style = (loc: import("@playwright/test").Locator) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor, dash: s.borderTopStyle };
  });

test("18.1", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  const hero = p.locator("article");
  await expect(hero.locator("h1")).toHaveText("Use SQLite");
  const look = await style(hero);
  expect(isBlue(look.border), `border ${look.border}`).toBe(true);
  expect(isBlue(look.bg), `bg ${look.bg}`).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const cli = cliOnCopy(w.dir, "accept", "use-sqlite", "--actor", "you");
  const before = events(w).length;
  await flagPage(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await style(hero);
  expect(isBlue(after.border), `border ${after.border}`).toBe(false);
  expect(after.dash).not.toBe("dashed");
  expect(await stillSamePage(p)).toBe(true);
  const added = events(w).slice(before);
  expect(added.some((e) => e.type === "change.accepted" && e.payload.id === "use-sqlite" && e.actor === "you")).toBe(
    true,
  );
  const strip = (es: ReturnType<typeof events>) => es.map((e) => ({ type: e.type, actor: e.actor, payload: e.payload }));
  expect(strip(added)).toEqual(strip(events({ dir: cli }).slice(before)));
});

test("18.2", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    down.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
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
  const look = await style(hero);
  expect(isBlue(look.border), `border ${look.border}`).toBe(true);
  expect(isBlue(look.bg), `bg ${look.bg}`).toBe(false);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const added = hero.locator("ins");
  const removed = hero.locator("del");
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  expect(isBlue(await added.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
  expect(isBlue(await removed.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(hero.locator("[data-diff], ins, del, mark")).toHaveCount(2);

  await flagPage(p);
  await hero.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff], ins, del, mark")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "plan", { title: "Plan", body: `Steps run nightly.\n\n${items}` });
    down.seed("kill.added", { id: "plan", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item 5", "- item 5\n- a new item");
  w.werk(
    "propose",
    "plan",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Steps run nightly.", new: "- runs nightly\n- runs at noon" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/plan`);
  const body = p.locator('article [data-field="body"]');
  const longList = body.locator("ul").filter({ hasText: "item 10" });
  const newItem = longList.locator("li").filter({ hasText: "a new item" });
  await expect(newItem.locator('ins, [data-diff="added"]')).toHaveText("a new item");
  expect(isBlue(await newItem.locator("ins").evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
  const old = longList.locator("li").filter({ hasNotText: "a new item" });
  await expect(old).toHaveCount(10);
  await expect(old.locator("ins, del, [data-diff]")).toHaveCount(0);
  const gone = body.locator('[data-diff="removed"]').filter({ hasText: "Steps run nightly." });
  await expect(gone).toHaveCount(1);
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(isBlue(await gone.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
  const fresh = body.locator('[data-diff="added"]').filter({ has: p.locator("li", { hasText: "runs at noon" }) });
  await expect(fresh).toHaveCount(1);
  expect(isBlue(await fresh.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
});

test("18.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/server`);
  const serverSubs = await p.locator('[data-section="subcards"]').innerHTML();
  await p.locator('[data-tile="auth"]').click();
  await expect(p).toHaveURL(/\/map\/auth$/);
  const authHtml = await p.locator("article").innerHTML();
  const authSubs = await p.locator('[data-section="subcards"]').innerHTML();
  await flagPage(p);
  await p.locator("article").getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toHaveCount(1);
  const reparent = dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*to #server Server/ });
  await expect(reparent).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(1);
  const before = events(w).length;
  await reparent.click();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-card="auth"]')).toHaveCount(0);
  await expect(p.locator("h1")).toHaveText("Server");
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await stillSamePage(p)).toBe(true);
  const added = events(w).slice(before);
  expect(added.map((e) => e.type)).toEqual(["node.removed"]);
  expect(added[0]?.payload).toMatchObject({ id: "auth", reparent: true });

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  expect(await p.locator('[data-section="subcards"]').innerHTML()).toBe(serverSubs);
  await p.locator('[data-tile="auth"]').click();
  await expect(p).toHaveURL(/\/map\/auth$/);
  expect(await p.locator("article").innerHTML()).toBe(authHtml);
  expect(await p.locator('[data-section="subcards"]').innerHTML()).toBe(authSubs);
});

test("18.5", async ({ page: p, playwright }) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer" });
    card(down, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  const log = logOf(w);
  await p.goto(w.url);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toBeVisible();
  await expect.poll(async () => isRed((await style(tile)).border), { timeout: 5000 }).toBe(true);

  await p.locator('[data-tile="notes"]').click();
  await expect(p).toHaveURL(/\/map\/notes$/);
  const before = readFileSync(log, "utf8");
  await p.locator("article").getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.locator("h1")).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);

  await flagPage(p);
  const pageHtml = await p.locator("main").first().innerHTML().catch(() => p.content());
  const other = await playwright.request.newContext();
  const res = await other.post(`${w.url}/api/remove`, { data: { id: "notes" } });
  expect(res.ok()).toBe(false);
  expect([401, 403]).toContain(res.status());
  await other.dispose();
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(p.locator("h1")).toHaveText("Old notes");
  expect(await stillSamePage(p)).toBe(true);
  const nowHtml = await p.locator("main").first().innerHTML().catch(() => p.content());
  expect(nowHtml).toBe(pageHtml);
  void join;
});
