import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const events = (w: Pick<Werk, "dir">) =>
  readFileSync(`${w.dir}/.werk/log.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seq: number; actor: string; type: string; payload: Record<string, unknown> });
const _card = (w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
const flag = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
/** Any CSS colour as rgb numbers, through a canvas pixel. */
const rgbOf = (el: import("@playwright/test").Locator, prop: string) =>
  el.evaluate((e, prop) => {
    const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = getComputedStyle(e).getPropertyValue(prop);
    c.fillRect(0, 0, 1, 1);
    return Array.from(c.getImageData(0, 0, 1, 1).data);
  }, prop);
/** A real decided card: a decider, a waived basis and option, and a kill criterion, as the contract asks. */
const decided = (d: Pick<Werk, "seed" | "werk">, id: string, fields: Record<string, unknown> = {}) => {
  d.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
  d.werk("edit", id, "--who", "me", "--no-basis", "none", "--unchallenged", "none");
  d.werk("kill", id, "--revisit");
  d.werk("status", id, "decided");
};

test("18.1 accepting a proposed card with the check mark", async ({ page: p }) => {
  const w = await project(undefined, (d) => decided(d, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage", "--why", "one file");
  await p.goto(`${w.url}/map/use-sqlite`);
  const art = p.locator("article");
  await expect(art.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const [r, , b] = await rgbOf(art, "border-top-color");
  expect(b).toBeGreaterThan(r as number);
  const [br, , bb] = await rgbOf(art, "background-color");
  expect(bb).toBeGreaterThan(br as number);
  await expect(art.locator('[data-role="actions"] button[data-action="accept"]')).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flag(p);
  const before = events(w).length;
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(art).toHaveAttribute("data-proposed", "false");
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await same(p)).toBe(true);
  const log = events(w);
  expect(log.length).toBe(before + 1);
  expect(log.at(-1)).toMatchObject({ actor: "you", type: "change.accepted", payload: { id: "use-sqlite" } });
  // the same as from the command line
  w.werk("add", "use-pg", "--title", "Use Postgres", "--parent", "storage");
  w.werk("accept", "use-pg", "--actor", "you");
  expect(events(w).at(-1)).toMatchObject({ actor: "you", type: "change.accepted", payload: { id: "use-pg" } });
});

test("18.2 a pending edit shows as a diff and the check mark amends", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    decided(d, "cache", { title: "Cache layer", body: "Entries expire after five minutes." }),
  );
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]),
  );
  await p.goto(`${w.url}/map/cache`);
  const art = p.locator("article");
  await expect(art).toHaveAttribute("data-pending", "true");
  await expect(art).toHaveAttribute("data-proposed", "false");
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  const [r, , b] = await rgbOf(art, "border-top-color");
  expect(b).toBeGreaterThan(r as number);
  expect((await rgbOf(art, "background-color")).slice(0, 3)).toEqual([255, 255, 255]);
  await expect(p.locator('ins[data-diff="added"]')).toHaveText("ten");
  const del = p.locator('del[data-diff="removed"]');
  await expect(del).toHaveText("five");
  expect(await del.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("line-through");
  expect(await p.locator('ins[data-diff="added"]').evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(p.locator("[data-diff]")).toHaveCount(2);
  await flag(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("[data-diff]")).toHaveCount(0);
  await expect(p.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one added list item marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => decided(d, "plan", { title: "Plan", body: `A paragraph about steps.\n\n${items}` }));
  const longer = items.replace("- step 5", "- step 5\n- a new step");
  w.werk(
    "propose",
    "plan",
    "--ops",
    JSON.stringify([
      { tag: "removed", old: "A paragraph about steps." },
      { tag: "new", new: "- alpha\n- beta" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/plan`);
  const body = p.locator('[data-field="body"]');
  await expect(body.locator("[data-diff]").first()).toBeVisible();
  const newItem = body.locator("li", { hasText: "a new step" });
  await expect(newItem.locator('ins[data-diff="added"], [data-diff="added"]').first()).toBeVisible();
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^step ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("[data-diff]")).toHaveCount(0);
    expect(await li.evaluate((e) => e.closest("[data-diff]") === null)).toBe(true);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: "A paragraph about steps." });
  await expect(removed).toHaveCount(1);
  expect(await removed.first().evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("line-through");
  expect(await removed.first().evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  const added = body.locator('[data-diff="added"]', { hasText: "alpha" });
  await expect(added.first()).toBeVisible();
  expect(await added.first().evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("18.4 remove with two children offers subtree or reparent", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    decided(d, "server", { title: "Server" });
    decided(d, "auth", { title: "Auth", parent: "server" });
    decided(d, "tokens", { title: "Tokens", parent: "auth" });
    decided(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  const before = events(w).length;
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /Remove the subtree: 3 cards leave/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves.*move up to #server/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await flag(p);
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await same(p)).toBe(true);
  expect(events(w).length).toBe(before + 1);
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.locator('[data-tile="auth"]').click();
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
});

test("18.5 proposed removal in red, cancel, write without token", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    decided(d, "legacy", { title: "Legacy importer" });
    decided(d, "old", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/legacy`);
  const art = p.locator("article");
  await expect(art).toHaveAttribute("data-removal", "true");
  const [r, g, b] = await rgbOf(art, "border-top-color");
  expect(r).toBeGreaterThan(g as number);
  expect(r).toBeGreaterThan(b as number);
  await p.goto(`${w.url}/map/old`);
  const before = events(w).length;
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(events(w).length).toBe(before);
  const status = await fetch(`${w.url}/api/remove`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://other.example" },
    body: JSON.stringify({ id: "old" }),
  }).then((r) => r.status);
  expect(status).toBe(403);
  const status2 = await p.evaluate(async () =>
    (await fetch("/api/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "legacy" }) })).status,
  );
  expect(status2).toBe(403);
  expect(events(w).length).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
});
