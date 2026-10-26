import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { card, events, flagPage, isBlue, isRed, logText, rgbOf, stillSamePage } from "./web-c-util.ts";

test.afterEach(stop);

test("18.1 accepting a proposed card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/storage`);
  await expect(p.locator('[data-tile="sqlite"]')).toBeVisible();
  await flagPage(p);
  await p.locator('[data-tile="sqlite"]').click();
  await expect(p).toHaveURL(/\/map\/sqlite$/);
  const hero = p.locator('article[data-card="sqlite"]');
  const border = await rgbOf(hero, "border-top-color");
  const bg = await rgbOf(hero, "background-color");
  console.log("18.1 ghost border", border, "bg", bg);
  expect(isBlue(border.rgba)).toBe(true);
  expect(isBlue(bg.rgba)).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await expect(p.getByText(/discard/i)).toHaveCount(0);

  const before = events(w).length;
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await rgbOf(hero, "border-top-color");
  console.log("18.1 real border", after);
  expect(isBlue(after.rgba)).toBe(false);
  const added = events(w).slice(before);
  console.log("18.1 new events", JSON.stringify(added));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "sqlite" } });

  // The same accept from the command line, on a twin ghost.
  w.werk("add", "twin", "--title", "Use SQLite twin", "--parent", "storage");
  const mark = events(w).length;
  w.werk("accept", "twin", "--actor", "you");
  const cli = events(w).slice(mark);
  console.log("18.1 cli events", JSON.stringify(cli));
  expect(cli).toHaveLength(1);
  expect({ type: cli[0]?.type, actor: cli[0]?.actor, keys: Object.keys(cli[0]?.payload ?? {}) }).toEqual({
    type: added[0]?.type,
    actor: added[0]?.actor,
    keys: Object.keys(added[0]?.payload ?? {}),
  });
  const page = await (await fetch(`${w.url}/api/card/sqlite`)).json();
  const twin = await (await fetch(`${w.url}/api/card/twin`)).json();
  expect(page.card.proposed).toBe(false);
  expect(twin.card.proposed).toBe(false);
  expect(twin.card.status).toBe(page.card.status);
});

test("18.2 a pending edit to a decided card shows as a diff", async ({ page: p }) => {
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
  const hero = p.locator('article[data-card="cache"]');
  await expect(hero).toHaveAttribute("data-pending", "true");
  const border = await rgbOf(hero, "border-top-color");
  const bg = await rgbOf(hero, "background-color");
  console.log("18.2 border", border, "bg", bg);
  expect(isBlue(border.rgba)).toBe(true);
  expect(isBlue(bg.rgba)).toBe(false);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const added = hero.locator('ins[data-diff="added"]');
  const removed = hero.locator('del[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  const addBg = await rgbOf(added, "background-color");
  const delBg = await rgbOf(removed, "background-color");
  console.log("18.2 ins", addBg, "del", delBg);
  expect(isBlue(addBg.rgba)).toBe(true);
  expect(isBlue(delBg.rgba)).toBe(true);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  await expect(hero.locator("ins, del, mark")).toHaveCount(2);

  await flagPage(p);
  await hero.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  await expect(hero.locator("ins, del, mark")).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Plain words here.";
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "list", { title: "Long list", why: "Many items.", body: `${items}\n\n${para}` });
    down.seed("kill.added", { id: "list", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item 5", "- item 5\n- brand new item");
  w.werk(
    "propose",
    "list",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: items, new: longer },
      { tag: "elaborated", old: para, new: "- plain one\n- plain two" },
    ]),
  );
  await p.goto(`${w.url}/map/list`);
  const body = p.locator('article[data-card="list"] [data-field="body"]');
  console.log("18.3 body", await body.innerHTML());
  const lists = body.locator("ul");
  const first = body.locator("> ul").first();
  await expect(first.locator("> li")).toHaveCount(11);
  const newItem = first.locator("> li").nth(5);
  await expect(newItem).toHaveText("brand new item");
  const newMark = newItem.locator('[data-diff="added"]');
  await expect(newMark).toHaveCount(1);
  expect(isBlue((await rgbOf(newMark, "background-color")).rgba)).toBe(true);
  for (let i = 0; i < 11; i++) {
    if (i === 5) continue;
    await expect(first.locator("> li").nth(i).locator("[data-diff], ins, del")).toHaveCount(0);
  }
  const oldPara = body.locator('[data-diff="removed"]').filter({ hasText: para });
  await expect(oldPara).toHaveCount(1);
  const oldBg = await rgbOf(oldPara, "background-color");
  console.log("18.3 removed para bg", oldBg);
  expect(isBlue(oldBg.rgba)).toBe(true);
  expect(await oldPara.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  const newList = body.locator('[data-diff="added"]').filter({ has: p.locator("li", { hasText: "plain one" }) });
  await expect(newList).toHaveCount(1);
  const newBg = await rgbOf(newList, "background-color");
  console.log("18.3 added list bg", newBg);
  expect(isBlue(newBg.rgba)).toBe(true);
  expect(await lists.count()).toBeGreaterThanOrEqual(2);
});

test("18.4 removing a card with two children offers subtree or reparent", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  const beforeHtml = await p.locator('article[data-card="auth"]').innerHTML();
  const beforeTiles = await p.locator("[data-tile]").evaluateAll((t) => t.map((x) => x.getAttribute("data-tile")));
  await p.locator('article[data-card="auth"] [data-role="actions"]').getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  console.log("18.4 answers", await answers.allTextContents());
  await expect(answers).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toHaveCount(1);
  const reparent = dialog.getByRole("button", { name: /1 card leaves.*#server/ });
  await expect(reparent).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(1);

  const before = events(w).length;
  await flagPage(p);
  await reparent.click();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await stillSamePage(p)).toBe(true);
  const added = events(w).slice(before);
  console.log("18.4 removal events", JSON.stringify(added));
  expect(added).toHaveLength(1);
  expect(added[0]?.type).toBe("node.removed");

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="sessions"]')).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
  await p.locator('[data-tile="auth"]').click();
  await expect(p).toHaveURL(/\/map\/auth$/);
  await expect(p.locator('article[data-card="auth"]')).toBeVisible();
  expect(await p.locator('article[data-card="auth"]').innerHTML()).toBe(beforeHtml);
  expect(await p.locator("[data-tile]").evaluateAll((t) => t.map((x) => x.getAttribute("data-tile")))).toEqual(
    beforeTiles,
  );
});

function post(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host: `localhost:${port}`, "content-type": "application/json", origin: "http://evil.example" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer" });
    card(down, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('[data-tile="legacy"]');
  const border = await rgbOf(tile, "border-top-color");
  const bg = await rgbOf(tile, "background-color");
  console.log("18.5 legacy tile border", border, "bg", bg);
  expect(isRed(border.rgba)).toBe(true);
  expect(isRed(bg.rgba)).toBe(true);

  await p.locator('[data-tile="notes"]').click();
  await expect(p).toHaveURL(/\/map\/notes$/);
  const before = logText(w);
  await p.locator('article[data-card="notes"]').getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
  expect(logText(w)).toBe(before);

  await flagPage(p);
  const htmlBefore = await p.locator("main, body").first().innerHTML();
  const status = await post(w.url, "/api/remove", JSON.stringify({ id: "notes" }));
  console.log("18.5 tokenless status", status);
  expect(status).toBe(403);
  expect(logText(w)).toBe(before);
  await p.waitForTimeout(500);
  await expect(p.locator('article[data-card="notes"]')).toBeVisible();
  expect(await p.locator("main, body").first().innerHTML()).toBe(htmlBefore);
  expect(await stillSamePage(p)).toBe(true);
});
