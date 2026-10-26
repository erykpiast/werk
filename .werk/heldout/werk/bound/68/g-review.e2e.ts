// Held-out steps 18.x, 70.x and 06.x: proposals, accepts, removals and excerpts in a real browser.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

type Event = { seq: number; actor: string; type: string; payload: Record<string, unknown> };

const logOf = (w: Werk) => join(w.dir, ".werk", "log.jsonl");
const events = (w: Werk): Event[] =>
  readFileSync(logOf(w), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

/** A flag on the window that a reload would lose. */
const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** The colour values of an element, read by the browser. */
const styleOf = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, borderStyle: s.borderTopStyle, background: s.backgroundColor };
  });

/** The hue and chroma of a CSS colour, read through a canvas so every colour space compares. */
async function colour(p: Page, css: string): Promise<{ r: number; g: number; b: number; a: number }> {
  return p.evaluate((value) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r: r as number, g: g as number, b: b as number, a: a as number };
  }, css);
}
async function isBlue(p: Page, css: string): Promise<boolean> {
  const c = await colour(p, css);
  return c.a > 0 && c.b >= c.r + 15 && c.b >= c.g;
}
async function isGrey(p: Page, css: string): Promise<boolean> {
  const c = await colour(p, css);
  return c.a > 0 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24;
}

const hero = (p: Page) => p.locator("article[data-card]").first();
const tile = (p: Page, id: string) => p.locator(`[data-tile="${id}"]`);

// ---------------------------------------------------------------- 18.1

test("18.1 accepting a proposed new card with the ✓ makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    card(down, "storage", { title: "Storage", status: "decided", who: "me" }),
  );
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "postgres", "--title", "Use Postgres", "--parent", "storage");

  await p.goto(`${w.url}/map/sqlite`);
  const box = hero(p);
  const look = await styleOf(box);
  expect(await isBlue(p, look.border)).toBe(true);
  expect(await isBlue(p, look.background)).toBe(true);
  await expect(box.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = box.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: /accept/i })).toContainText("✓");
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const before = events(w).length;
  await flagPage(p);
  await actions.getByRole("button", { name: /accept/i }).click();
  await expect(box).toHaveAttribute("data-proposed", "false");
  await expect(box.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await styleOf(box);
  expect(await isBlue(p, after.border)).toBe(false);
  expect(await stillSamePage(p)).toBe(true);

  const added = events(w).slice(before);
  const pageAccept = added.find((e) => /accept/.test(e.type) && JSON.stringify(e.payload).includes("sqlite"));
  expect(pageAccept).toBeDefined();
  expect(pageAccept?.actor).toBe("you");

  // The same accept from the command line, on the twin ghost.
  const mid = events(w).length;
  w.werk("accept", "postgres", "--actor", "you");
  const cliEvents = events(w).slice(mid);
  const shape = (list: Event[], id: string) =>
    list.map((e) => ({
      type: e.type,
      actor: e.actor,
      payload: JSON.parse(JSON.stringify(e.payload).replaceAll(id, "X")),
    }));
  expect(shape(added, "sqlite")).toEqual(shape(cliEvents, "postgres"));
  const showA = w.werk("show", "sqlite").replaceAll("sqlite", "X").replaceAll("Use SQLite", "T");
  const showB = w.werk("show", "postgres").replaceAll("postgres", "X").replaceAll("Use Postgres", "T");
  expect(showA).toBe(showB);
});

// ---------------------------------------------------------------- 18.2

test("18.2 a pending edit to a decided card shows as a diff, and an accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "cache", {
      title: "Cache layer",
      why: "Reads repeat.",
      body: "Entries expire after five minutes.",
      status: "decided",
      who: "me",
    });
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
  const box = hero(p);
  const look = await styleOf(box);
  expect(await isBlue(p, look.border)).toBe(true);
  expect(await isBlue(p, look.background)).toBe(false);
  await expect(box.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(box.getByText("proposed", { exact: true })).toHaveCount(0);

  const marks = box.locator("[data-diff]");
  await expect(marks).toHaveCount(2);
  const ten = box.locator("[data-diff]", { hasText: /^ten$/ });
  const five = box.locator("[data-diff]", { hasText: /^five$/ });
  await expect(ten).toHaveCount(1);
  await expect(five).toHaveCount(1);
  expect(await isBlue(p, (await styleOf(ten)).background)).toBe(true);
  expect(await isBlue(p, (await styleOf(five)).background)).toBe(true);
  expect(await five.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");

  await flagPage(p);
  await box.getByRole("button", { name: /accept/i }).click();
  await expect(box.locator("[data-diff]")).toHaveCount(0);
  await expect(box.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

// ---------------------------------------------------------------- 18.3

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item number ${i + 1}`).join("\n");
  const paragraph = "Reads go through one queue.";
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "steps", {
      title: "Steps",
      why: "Order matters.",
      body: `${items}\n\n${paragraph}`,
      status: "decided",
      who: "me",
    });
    down.seed("kill.added", { id: "steps", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- item number 5", "- item number 5\n- a brand new item");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: items, new: longer },
      { tag: "elaborated", old: paragraph, new: "- reads go through\n- one queue" },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = hero(p).locator('[data-field="body"]');
  const fresh = body.locator("li", { hasText: "a brand new item" });
  await expect(fresh).toHaveCount(1);
  const freshMark = fresh.locator("[data-diff]");
  await expect(freshMark).toHaveCount(1);
  expect(await isBlue(p, (await styleOf(freshMark)).background)).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li", { hasText: new RegExp(`^item number ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: "one queue" }).first();
  await expect(removed).toBeVisible();
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  expect(await isBlue(p, (await styleOf(removed)).background)).toBe(true);
  const addedList = body.locator('[data-diff="added"]', { hasText: "reads go through" }).first();
  await expect(addedList).toBeVisible();
  expect(await isBlue(p, (await styleOf(addedList)).background)).toBe(true);
});

// ---------------------------------------------------------------- 18.4

test("18.4 removing a card with two children offers subtree or reparent with counts", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server", status: "decided", who: "me" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/auth`);
  const beforeHtml = await hero(p).innerHTML();
  await p.getByRole("button", { name: /remove/i }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(answers.filter({ hasText: /subtree/i })).toContainText("3 cards");
  const reparent = answers.filter({ hasText: /Server/ });
  await expect(reparent).toContainText("1 card leaves");
  await expect(answers.filter({ hasText: /cancel/i })).toHaveCount(1);

  const before = events(w).length;
  await flagPage(p);
  await reparent.click();
  await expect(dialog).toHaveCount(0);
  await expect(p).toHaveURL(/\/map\/server$/);
  expect(await stillSamePage(p)).toBe(true);
  expect(events(w).length).toBe(before + 1);
  await expect(tile(p, "auth")).toHaveCount(0);
  await expect(tile(p, "tokens")).toBeVisible();
  await expect(tile(p, "sessions")).toBeVisible();

  w.werk("restore", "auth", "--actor", "you");
  await expect(tile(p, "auth")).toBeVisible();
  await expect(tile(p, "tokens")).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  expect(await hero(p).innerHTML()).toBe(beforeHtml);
  await expect(tile(p, "tokens")).toBeVisible();
  await expect(tile(p, "sessions")).toBeVisible();
});

// ---------------------------------------------------------------- 18.5

test("18.5 a proposed removal shows red, cancel changes nothing, a tokenless write is refused", async ({
  page: p,
  request,
}) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy", { title: "Legacy importer", status: "decided", who: "me" });
    card(down, "notes", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/root`);
  const legacy = tile(p, "legacy");
  const look = await styleOf(legacy);
  const c = await colour(p, look.border);
  expect(c.r).toBeGreaterThan(c.g + 40);
  expect(c.r).toBeGreaterThan(c.b + 40);

  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(logOf(w), "utf8");
  await p.getByRole("button", { name: /remove/i }).click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: /cancel/i })
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(readFileSync(logOf(w), "utf8")).toBe(before);

  await flagPage(p);
  const answer = await request.post(`${w.url}/api/remove`, { data: { id: "notes" } });
  expect(answer.status()).toBeGreaterThanOrEqual(400);
  expect(readFileSync(logOf(w), "utf8")).toBe(before);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await stillSamePage(p)).toBe(true);
});

// ---------------------------------------------------------------- 70.x

function payments(): Promise<Werk> {
  return project(undefined, (down) => card(down, "payments", { title: "Payments" }));
}

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = tile(p, "refunds");
  await expect(ghost).toBeVisible();
  const g = await styleOf(ghost);
  expect(g.borderStyle).toBe("dashed");
  expect(await isGrey(p, g.border)).toBe(true);
  const real = hero(p);
  const r = await styleOf(real);
  expect(r.borderStyle).not.toBe("dashed");
  await p.goto(`${w.url}/map/root`);
  const realTile = await styleOf(tile(p, "payments"));
  expect(realTile.borderStyle).not.toBe("dashed");
});

test("70.2 the person accepts one ghost with the ✓ and it becomes real", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const before = events(w).length;
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  const added = events(w).slice(before);
  const accepts = added.filter((e) => /accept/.test(e.type) && JSON.stringify(e.payload).includes("refunds"));
  expect(accepts.length).toBe(1);
  expect(accepts[0]?.actor).toBe("you");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  await p.goto(`${w.url}/map/payments`);
  await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await flagPage(p);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await p.goto(`${w.url}/map/refunds`);
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await expect(tile(p, "partial")).toBeVisible();
  await p.goto(`${w.url}/map/payments`);
  await expect(tile(p, "refunds")).toBeVisible();
  await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the accepted card's branch", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Store credit", "--why_not", "People want money.");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "policy", "--kind", "source", "--title", "Refund policy", "--finding", "Refunds within 30 days.");
  w.werk("link", "refunds", "policy", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds:opt0`);
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/policy`);
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  const charge = tile(p, "chargebacks");
  await expect(charge).toHaveAttribute("data-proposed", "true");
  const look = await styleOf(charge);
  expect(look.borderStyle).toBe("dashed");
  expect(await isGrey(p, look.border)).toBe(true);
  await expect(p.getByRole("button", { name: /accept all|accept every|accept both/i })).toHaveCount(0);
});

test("70.5 a second view sees the accept because it reads the same log", async ({ page: p, context }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const second = await context.newPage();
  await p.goto(`${w.url}/map/refunds`);
  await second.goto(`${w.url}/map/refunds`);
  await expect(hero(second)).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await expect(hero(second)).toHaveAttribute("data-proposed", "false");
});

// ---------------------------------------------------------------- 06.x

async function quotedCard(): Promise<Werk> {
  const w = await project(undefined, (down) => {
    card(down, "billing", { title: "We bill per seat", body: "Seats are counted monthly." });
    down.seed("node.decided", { id: "billing" });
  });
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await quotedCard();
  await p.goto(`${w.url}/map/billing`);
  const statusBefore = await p.locator('[data-tag="status"]').textContent();
  const wordsBefore = await hero(p).locator('[data-field="body"]').textContent();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const id = /^(\S+):\s*proposed/.exec(out)?.[1] ?? "billing:ex0";

  await p.goto(`${w.url}/map/billing`);
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("pending");
  await expect(p.locator('[data-tag="status"]')).toHaveText(statusBefore ?? "decided");
  await expect(hero(p).locator('[data-field="body"]')).toHaveText(wordsBefore ?? "");

  await p.goto(`${w.url}/map/${id}`);
  await expect(hero(p)).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toContainText("✓");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await quotedCard();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  const id = /^(\S+):\s*proposed/.exec(out)?.[1] ?? "billing:ex0";
  await p.goto(`${w.url}/map/${id}`);
  await expect(hero(p)).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/billing`);
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
});
