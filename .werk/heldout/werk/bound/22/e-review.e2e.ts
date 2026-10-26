/// <reference lib="dom" />
// Held-out: 18.1-18.5 (accept, diff, removal dialog, red removal, token refusal).
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { family } from "./e-colour.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const flag = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const events = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: Record<string, unknown> });

test("18.1 accepting a proposed new card with the check mark makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "use-other", "--title", "Use other", "--parent", "storage");
  await p.goto(`${w.url}/map/use-sqlite`);
  const hero = p.locator('article[data-card="use-sqlite"]');
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  expect(((await family(hero, "border-top-color")) === "blue")).toBe(true);
  expect(((await family(hero, "background-color")) === "blue")).toBe(true);
  const accept = p.getByRole("button", { name: "Accept" });
  await expect(accept).toHaveText(/✓/);
  const a = await accept.boundingBox();
  const h = await hero.boundingBox();
  expect((a?.x ?? 0) > (h?.x ?? 0) + (h?.width ?? 0) / 2).toBe(true);
  expect((a?.y ?? 0) < (h?.y ?? 0) + 80).toBe(true);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const n = events(w).length;
  await flag(p);
  await accept.click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(((await family(hero, "border-top-color")) === "blue")).toBe(false);
  expect(await same(p)).toBe(true);
  const fromPage = events(w).slice(n);
  expect(fromPage.length).toBeGreaterThan(0);
  expect(fromPage.every((e) => e.actor === "you")).toBe(true);
  expect(fromPage.some((e) => e.type === "change.accepted" && e.payload.id === "use-sqlite")).toBe(true);

  const m = events(w).length;
  w.werk("accept", "use-other", "--actor", "you");
  const fromCli = events(w).slice(m);
  const shape = (es: typeof fromPage, id: string) =>
    es.map((e) => ({ type: e.type, actor: e.actor, payload: JSON.stringify(e.payload).replaceAll(id, "ID") }));
  expect(shape(fromPage, "use-sqlite")).toEqual(shape(fromCli, "use-other"));
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
  await p.goto(w.url);
  const tile = p.locator('[data-tile="cache"]');
  await expect(tile).toBeVisible();
  await tile.click();
  const hero = p.locator('article[data-card="cache"]');
  await expect(hero).toBeVisible();
  expect(((await family(hero, "border-top-color")) === "blue")).toBe(true);
  expect(((await family(hero, "background-color")) === "blue")).toBe(false);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const ins = hero.locator('ins[data-diff="added"]');
  const del = hero.locator('del[data-diff="removed"]');
  await expect(ins).toHaveText("ten");
  await expect(del).toHaveText("five");
  expect(((await family(ins, "background-color")) === "blue")).toBe(true);
  expect(((await family(del, "background-color")) === "blue")).toBe(true);
  expect(await del.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "The steps run in order.";
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "steps", { title: "Steps", body: `${para}\n\n${items}` });
    d.seed("kill.added", { id: "steps", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item 5", "- item 5\n- a brand new item");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- The steps\n- run in order." },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = p.locator('article[data-card="steps"] [data-field="body"]');
  const newItem = body.locator("li", { hasText: "a brand new item" });
  await expect(newItem).toHaveCount(1);
  const newMark = newItem.locator('ins[data-diff="added"], [data-diff="added"]').first();
  const marked = (await newItem.getAttribute("data-diff")) === "added" || (await newMark.count()) > 0;
  expect(marked).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("[data-diff]")).toHaveCount(0);
    expect(await li.getAttribute("data-diff")).toBeNull();
  }
  const removedPara = body.locator('del[data-diff="removed"], [data-diff="removed"]', { hasText: "The steps run" });
  await expect(removedPara.first()).toBeVisible();
  expect(await removedPara.first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  const addedList = body.locator('[data-diff="added"]', { hasText: "The steps" });
  await expect(addedList.first()).toBeVisible();
  expect(((await family(addedList.first(), "background-color")) === "blue")).toBe(true);
});

test("18.4 removing a card with two children offers subtree removal or reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const buttons = dialog.getByRole("button");
  await expect(buttons).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards/i })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /1 card.*Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const n = events(w).length;
  await flag(p);
  await reparent.click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await same(p)).toBe(true);
  const added = events(w).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator("[data-tile]")).toHaveCount(1);
  await p.locator('[data-tile="auth"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(p.locator('article[data-card="auth"]')).toHaveAttribute("data-status", "decided");
});

function send(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host: `localhost:${port}`, "content-type": "application/json", origin: "https://evil.example" },
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
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(w.url);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toBeVisible();
  expect(((await family(tile, "border-top-color")) === "red")).toBe(true);
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);
  await flag(p);
  const html = await p.locator("#view").innerHTML();
  expect(await send(w.url, "/api/remove", JSON.stringify({ id: "notes" }))).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await p.locator("#view").innerHTML()).toBe(html);
  expect(await same(p)).toBe(true);
});
