// Held-out steps 18.1–18.5: the person reviews proposals in the browser.
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { decided, flagPage, isBlue, isRed, isWhiteish, logLines, rgbOf, send, stillSamePage } from "./i-helpers.ts";

test.afterEach(stop);

test("18.1 accepting a proposed new card with the check mark makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "storage", { title: "Storage" });
  });
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  const hero = p.locator("article");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  expect(isBlue(await rgbOf(hero, "border-top-color"))).toBe(true);
  expect(isBlue(await rgbOf(hero, "background-color"))).toBe(true);
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: /Accept/ })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const before = logLines(w).length;
  await flagPage(p);
  await actions.getByRole("button", { name: /Accept/ }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(isBlue(await rgbOf(hero, "border-top-color"))).toBe(false);
  expect(await stillSamePage(p)).toBe(true);
  const added = logLines(w).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.actor === "you")).toBe(true);
  expect(added.some((e) => JSON.stringify(e.payload).includes("use-sqlite"))).toBe(true);

  const shown = w.werk("show", "use-sqlite");
  // The same proposal accepted from the command line in a second project writes the same events.
  stop();
  const cli = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "storage", { title: "Storage" });
  });
  cli.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  const cliBefore = logLines(cli).length;
  cli.werk("accept", "use-sqlite", "--actor", "you");
  const cliAdded = logLines(cli).slice(cliBefore);
  expect(cliAdded.map((e) => [e.type, e.actor, e.payload])).toEqual(added.map((e) => [e.type, e.actor, e.payload]));
  expect(cli.werk("show", "use-sqlite")).toBe(shown);
});

test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
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
  expect(isBlue(await rgbOf(hero, "border-top-color"))).toBe(true);
  expect(isWhiteish(await rgbOf(hero, "background-color"))).toBe(true);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const added = hero.locator('ins[data-diff="added"]');
  const removed = hero.locator('del[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  expect(isBlue(await rgbOf(added, "background-color"))).toBe(true);
  expect(isBlue(await rgbOf(removed, "background-color"))).toBe(true);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  await expect(hero.locator("ins, del, mark")).toHaveCount(2);

  await flagPage(p);
  await hero.getByRole("button", { name: /Accept/ }).click();
  await expect(hero).toHaveAttribute("data-pending", "false");
  const body = hero.locator('[data-field="body"]');
  await expect(body).toHaveText("Entries expire after ten minutes.");
  await expect(hero.locator("[data-diff], ins, del")).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Keep these in mind.";
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "list", { title: "A list card", why: "Lists matter.", body: `${items}\n\n${para}` });
  });
  const longer = items.replace("- item 5", "- item 5\n- brand new item");
  w.werk(
    "propose",
    "list",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: items, new: longer },
      { tag: "elaborated", old: para, new: "- keep these\n- in mind" },
    ]),
  );
  await p.goto(`${w.url}/map/list`);
  const body = p.locator('article [data-field="body"]');
  const newItem = body.locator("li").filter({ hasText: "brand new item" });
  await expect(newItem).toHaveCount(1);
  const newMark = newItem.locator('[data-diff="added"]');
  await expect(newMark).toHaveCount(1);
  expect(isBlue(await rgbOf(newMark, "background-color"))).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff], ins, del")).toHaveCount(0);
  }
  const oldPara = body.locator('[data-diff="removed"]').filter({ hasText: "Keep these in mind." });
  await expect(oldPara).toHaveCount(1);
  expect(await oldPara.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(isWhiteish(await rgbOf(oldPara, "background-color"))).toBe(false);
  const newList = body.locator('[data-diff="added"]').filter({ hasText: "keep these" });
  await expect(newList).toHaveCount(1);
  expect(isWhiteish(await rgbOf(newList, "background-color"))).toBe(false);
});

test("18.4 removing a card with two children offers subtree or reparent, each with its count", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "server", { title: "Server" });
    decided(down, "auth", { title: "Auth", parent: "server" });
    decided(down, "tokens", { title: "Tokens", parent: "auth" });
    decided(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  const showBefore = w.werk("show", "auth");
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*server/i });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

  const before = logLines(w).length;
  await flagPage(p);
  await reparent.click();
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  expect(await stillSamePage(p)).toBe(true);
  const added = logLines(w).slice(before);
  expect(added.map((e) => e.type)).toEqual(["node.removed"]);

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  expect(w.werk("show", "auth")).toBe(showBefore);
});

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "legacy", { title: "Legacy importer" });
    decided(down, "old-notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/legacy`);
  const hero = p.locator("article");
  expect(isRed(await rgbOf(hero, "border-top-color"))).toBe(true);

  await p.goto(`${w.url}/map/old-notes`);
  const before = logLines(w).length;
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(logLines(w).length).toBe(before);

  const status = (await send(w.url, "/api/remove", { method: "POST", body: JSON.stringify({ id: "old-notes" }) }))
    .status;
  expect(status).toBe(403);
  expect(logLines(w).length).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  await expect(hero).toHaveAttribute("data-card", "old-notes");
});
