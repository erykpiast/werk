import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { isBlue, isGrey, isRed, isTransparent } from "./colors.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const css = (at: Locator, prop: string) => at.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);
const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const accept = (p: Page) => p.getByRole("button", { name: "Accept" });
const amendable = (down: Pick<Werk, "seed">, id: string, fields: Record<string, unknown>) => {
  card(down, id, fields);
  down.seed("kill.added", { id, criterion: { form: "revisit" } });
};

test("18.1 the check mark accepts a proposed card without a reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "pg", "--title", "Use Postgres", "--parent", "storage");
  await p.goto(`${w.url}/map/sqlite`);
  const art = p.locator("article");
  await expect(art.locator('[data-tag="proposed"]')).toHaveText("proposed");
  expect(isBlue(await css(art, "border-top-color"), 0.05)).toBe(true);
  expect(isBlue(await css(art, "background-color"))).toBe(true);
  await expect(accept(p)).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  await flagPage(p);
  await accept(p).click();
  await expect(art).toHaveAttribute("data-proposed", "false");
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect.poll(async () => isBlue(await css(art, "border-top-color"), 0.05)).toBe(false);
  expect(await same(p)).toBe(true);
  const last = logLines(w).at(-1);
  expect(last).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "sqlite" } });
  w.werk("accept", "pg", "--actor", "you");
  const cli = logLines(w).at(-1);
  expect({ type: cli.type, actor: cli.actor, keys: Object.keys(cli.payload) }).toEqual({
    type: last.type,
    actor: last.actor,
    keys: Object.keys(last.payload),
  });
});

test("18.2 a pending edit shows as a diff; accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    amendable(d, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
  });
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]),
  );
  await p.goto(`${w.url}/map/cache`);
  const art = p.locator("article");
  expect(isBlue(await css(art, "border-top-color"), 0.05)).toBe(true);
  expect(isBlue(await css(art, "background-color"))).toBe(false);
  await expect(art.locator('[data-tag="proposed"]')).toHaveCount(0);
  const ten = art.locator('ins[data-diff="added"]');
  const five = art.locator('del[data-diff="removed"]');
  await expect(ten).toHaveText("ten");
  await expect(five).toHaveText("five");
  expect(isBlue(await css(ten, "background-color"))).toBe(true);
  expect(isBlue(await css(five, "background-color"))).toBe(true);
  expect(await css(five, "text-decoration-line")).toContain("line-through");
  await expect(art.locator("[data-diff]")).toHaveCount(2);
  await flagPage(p);
  await accept(p).click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await same(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const old = "An old paragraph.";
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    amendable(d, "lst", { title: "A list card", body: `${old}\n\n${items}` });
  });
  const longer = items.replace("- item 5", "- item 5\n- inserted item");
  w.werk(
    "propose",
    "lst",
    "--ops",
    JSON.stringify([
      { tag: "removed", old },
      { tag: "new", new: "- fresh one\n- fresh two" },
      { tag: "elaborated", old: items, new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/lst`);
  const body = p.locator('[data-field="body"]');
  const inserted = body.locator("li", { hasText: "inserted item" });
  await expect(inserted).toHaveCount(1);
  expect(await inserted.evaluate((el) => el.querySelector('ins[data-diff="added"]') !== null || el.matches('[data-diff="added"]'))).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const li = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(li).toHaveCount(1);
    await expect(li.locator("[data-diff]")).toHaveCount(0);
  }
  const removed = body.locator('[data-diff="removed"]');
  await expect(removed).toContainText("An old paragraph.");
  expect(isTransparent(await css(removed.first(), "background-color"))).toBe(false);
  expect(await css(removed.first(), "text-decoration-line")).toContain("line-through");
  const fresh = body.locator("li", { hasText: "fresh one" });
  expect(await fresh.evaluate((el) => el.closest('[data-diff="added"]') !== null)).toBe(true);
  expect(isBlue(await css(body.locator('[data-diff="added"]').first(), "background-color"))).toBe(true);
});

test("18.4 removing a card with two children offers subtree or reparent, each with its count", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", { title: "Server" });
    card(d, "auth", { title: "Auth", parent: "server" });
    card(d, "tokens", { title: "Tokens", parent: "auth" });
    card(d, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  const buttons = dialog.getByRole("button");
  await expect(buttons).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Auth|auth/ }).filter({ hasText: /1 card leaves/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const before = logLines(w).length;
  await flagPage(p);
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p.locator('[data-missing]').or(p.getByRole("heading", { level: 1, name: "Server" }))).toBeVisible();
  expect(await same(p)).toBe(true);
  expect(logLines(w).length).toBe(before + 1);
  expect(logLines(w).at(-1).type).toBe("node.removed");
  await p.goto(`${w.url}/map/server`);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

test("18.5 a proposed removal is red, cancel changes nothing, a write without the token is refused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", { title: "Legacy importer" });
    card(d, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/legacy`);
  const art = p.locator("article");
  await expect(art).toHaveAttribute("data-removal", "true");
  const c = await css(art, "background-color");
  expect(isRed(c)).toBe(true);
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(log, "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(log, "utf8")).toBe(before);
  const status = await p.evaluate(async () => {
    const r = await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) });
    return r.status;
  });
  expect(status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
});

// ---- 70 ----
const ghostColour = async (at: Locator) => ({ border: await css(at, "border-top-color"), style: await css(at, "border-top-style"), bg: await css(at, "background-color") });

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('[data-tile="refunds"]');
  await expect(tile).toBeVisible();
  const g = await ghostColour(tile);
  expect(g.style).toBe("dashed");
  expect(isGrey(g.bg) && isGrey(g.border)).toBe(true);
  await p.goto(`${w.url}/map/root`);
  const real = await ghostColour(p.locator('[data-tile="payments"]'));
  expect(real.style).not.toBe("dashed");
});

test("70.2 the check button on a ghost makes it real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(accept(p)).toHaveCount(0);
  expect(logLines(w).at(-1)).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the accepted card's branch", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Credit notes", "--why_not", "slow");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "src", "--kind", "source", "--title", "Survey", "--finding", "f");
  w.werk("link", "refunds", "src", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator('[data-section="options"]')).toContainText("Credit notes");
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(w.werk("show", "refunds:opt0").split("\n")[0]).not.toContain("proposed");
  expect(w.werk("show", "src").split("\n")[0]).not.toContain("proposed");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  expect((await ghostColour(p.locator('[data-tile="chargebacks"]'))).style).toBe("dashed");
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
});

test("70.5 a second window sees the accept", async ({ page: p, context }) => {
  const w = await project(undefined, (d) => card(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const q = await context.newPage();
  await p.goto(`${w.url}/map/refunds`);
  await q.goto(`${w.url}/map/refunds`);
  await expect(q.locator("article")).toHaveAttribute("data-proposed", "true");
  await accept(p).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(q.locator("article")).toHaveAttribute("data-proposed", "false");
});
