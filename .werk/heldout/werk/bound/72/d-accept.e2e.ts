// Fork D: ghosts, excerpts, accepts, diffs and removals in the browser (06.x, 70.x, 18.x).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { card, cleanup, mark, marked, type Proj, proj, send, serve } from "./d-util.ts";

test.afterEach(cleanup);

const h1 = (p: Page) => p.locator("#view").getByRole("heading", { level: 1 });

/** The computed border of a box: its style and its colour, with whether the colour is a grey. */
async function border(at: Locator) {
  const { style, color } = await at.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.borderTopStyle, color: s.borderTopColor };
  });
  return { style, color, grey: isGrey(color) };
}

function isGrey(color: string): boolean {
  const ok = /oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)/.exec(color);
  if (ok) return Number(ok[2]) < 0.04;
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(color);
  if (rgb) {
    const v = rgb.slice(1, 4).map(Number);
    return Math.max(...v) - Math.min(...v) < 25;
  }
  return false;
}

/** The computed colour of a probe element that carries the given classes. */
const probe = (p: Page, classes: string, prop: "backgroundColor" | "borderTopColor") =>
  p.evaluate(
    ({ classes, prop }) => {
      const el = document.createElement("div");
      el.className = `border ${classes}`;
      document.body.append(el);
      const value = getComputedStyle(el)[prop];
      el.remove();
      return value;
    },
    { classes, prop },
  );

function payments(): Proj {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "payments", { title: "Payments" });
  return p;
}

function quotedProject(): Proj {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "billing", { title: "We bill per seat", body: "Seats are the unit." });
  mkdirSync(join(p.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(p.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return p;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page }) => {
  const p = quotedProject();
  const url = await serve(p).url;
  const out = p.ok("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await page.goto(`${url}/map/billing`);
  await expect(h1(page)).toHaveText("We bill per seat");
  await expect(page.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(page.locator('[data-field="body"]')).toHaveText("Seats are the unit.");
  const row = page.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("pending");
  await row.getByRole("link").first().click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(page.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page }) => {
  const p = quotedProject();
  const url = await serve(p).url;
  p.ok("quote", "billing", "pricing", "seats are the unit");
  await page.goto(`${url}/map/billing`);
  const row = page.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await row.getByRole("link").first().click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  const accepts = () => p.lines().filter((l) => l.includes("change.accepted")).length;
  const before = accepts();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(page.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(accepts()).toBe(before + 1);
  await page.goto(`${url}/map/billing`);
  const said = page.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(said).toContainText("seats are the unit");
  await expect(said).toHaveAttribute("data-pending", "false");
  expect(p.ok("show", "billing")).not.toContain("held");
});

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page }) => {
  const p = payments();
  const url = await serve(p).url;
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await page.goto(`${url}/map/payments`);
  const tile = page.locator('#view [data-tile="refunds"]');
  await expect(tile).toContainText("Refunds");
  const ghost = await border(tile);
  await page.goto(`${url}/map`);
  const real = await border(page.locator('#view [data-tile="payments"]'));
  expect({ ghostStyle: ghost.style, ghostGrey: ghost.grey, ghostColor: ghost.color }).toEqual({
    ghostStyle: "dashed",
    ghostGrey: true,
    ghostColor: ghost.color,
  });
  expect(real.style).not.toBe("dashed");
});

test("70.2 the person accepts one ghost with the ✓ button and it becomes real", async ({ page }) => {
  const p = payments();
  const url = await serve(p).url;
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const before = p.lines().length;
  await page.goto(`${url}/map/refunds`);
  await mark(page);
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  const added = p
    .lines()
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
  expect(await marked(page)).toBe(true);
  await page.goto(`${url}/map/payments`);
  await expect(page.locator('#view [data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page }) => {
  const p = payments();
  const url = await serve(p).url;
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  p.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await page.goto(`${url}/map/partial`);
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(page.locator('[data-section="refines"] [data-id="refunds"]')).toBeVisible();
  await page.goto(`${url}/map/payments`);
  await expect(page.locator('#view [data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  await page.goto(`${url}/map/refunds`);
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(page.locator('#view [data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await expect(page.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
});

test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page }) => {
  const p = payments();
  const url = await serve(p).url;
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  p.ok("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  p.ok("add", "refunds:opt0", "--kind", "option", "--title", "No refunds", "--why_not", "Customers leave");
  p.ok("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  p.ok("add", "refunds:src0", "--kind", "source", "--title", "Refund study", "--finding", "Most want refunds");
  p.ok("link", "refunds", "refunds:src0", "--type", "supported_by");
  await page.goto(`${url}/map/payments`);
  await expect(page.getByRole("button", { name: /accept (all|both|every)/i })).toHaveCount(0);
  await expect(page.locator("#view").getByRole("button", { name: "Accept" })).toHaveCount(0);
  await page.locator('#view [data-tile="refunds"]').click();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  for (const id of ["refunds:opt0", "refunds:src0"]) {
    await page.goto(`${url}/map/${encodeURIComponent(id)}`);
    await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  }
  await page.goto(`${url}/map/payments`);
  const charge = page.locator('#view [data-tile="chargebacks"]');
  await expect(charge).toHaveAttribute("data-proposed", "true");
  const look = await border(charge);
  expect({ style: look.style, grey: look.grey, color: look.color }).toEqual({
    style: "dashed",
    grey: true,
    color: look.color,
  });
});

test("70.5 a second view sees the accept because it reads the same log", async ({ context }) => {
  const p = payments();
  const url = await serve(p).url;
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const one = await context.newPage();
  const two = await context.newPage();
  await one.goto(`${url}/map/refunds`);
  await two.goto(`${url}/map/refunds`);
  await expect(two.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await mark(two);
  await one.getByRole("button", { name: "Accept" }).click();
  await expect(two.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  expect(await marked(two)).toBe(true);
});

function storage(): Proj {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "storage", { title: "Storage" });
  p.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  return p;
}

test("18.1 accepting a proposed new card with the check mark makes it real without a reload", async ({ page }) => {
  const p = storage();
  const url = await serve(p).url;
  await page.goto(`${url}/map/sqlite`);
  const hero = page.locator("article[data-card]");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const blueBorder = await probe(page, "border-blue-400", "borderTopColor");
  const blueBg = await probe(page, "bg-blue-50", "backgroundColor");
  expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(blueBorder);
  expect(await hero.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(blueBg);
  const actions = hero.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  const box = await hero.boundingBox();
  const btn = await actions.getByRole("button", { name: "Accept" }).boundingBox();
  expect(btn && box && btn.x > box.x + box.width / 2 && btn.y < box.y + 80).toBe(true);
  await expect(page.getByRole("button", { name: /discard/i })).toHaveCount(0);
  const before = p.lines().length;
  await mark(page);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(hero).toHaveAttribute("data-proposed", "false");
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(blueBorder);
  expect(await marked(page)).toBe(true);
  const events = p
    .lines()
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(events.map((e) => [e.type, e.actor, e.payload])).toEqual([["change.accepted", "you", { id: "sqlite" }]]);
  const viaPage = p.ok("show", "sqlite");
  const q = storage();
  q.ok("accept", "sqlite", "--actor", "you");
  expect(q.ok("show", "sqlite")).toBe(viaPage);
  const cliEvent = JSON.parse(q.lines().at(-1) ?? "{}");
  expect([cliEvent.type, cliEvent.actor, cliEvent.payload]).toEqual([
    events[0].type,
    events[0].actor,
    events[0].payload,
  ]);
});

function cache(): Proj {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  p.seed("node.decided", { id: "root" });
  card(p, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
  p.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  return p;
}

test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page }) => {
  const p = cache();
  const url = await serve(p).url;
  p.ok(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
    ]),
  );
  await page.goto(`${url}/map/cache`);
  const hero = page.locator("article[data-card]");
  const blueBorder = await probe(page, "border-blue-400", "borderTopColor");
  const blueBg = await probe(page, "bg-blue-50", "backgroundColor");
  expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(blueBorder);
  expect(await hero.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(blueBg);
  await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  const added = hero.locator('[data-diff="added"]');
  const removed = hero.locator('[data-diff="removed"]');
  await expect(added).toHaveText("ten");
  await expect(removed).toHaveText("five");
  await expect(hero.locator("[data-diff]")).toHaveCount(2);
  const none = "rgba(0, 0, 0, 0)";
  const addedBg = await added.evaluate((el) => getComputedStyle(el).backgroundColor);
  const removedBg = await removed.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(addedBg).not.toBe(none);
  expect(removedBg).not.toBe(none);
  const blueMark = await probe(page, "bg-blue-100", "backgroundColor");
  expect(addedBg).toBe(blueMark);
  expect(removedBg).toBe(blueMark);
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await mark(page);
  await hero.getByRole("button", { name: "Accept" }).click();
  await expect(hero.locator("[data-diff]")).toHaveCount(0);
  await expect(hero.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await marked(page)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  p.seed("node.decided", { id: "root" });
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  card(p, "steps", { title: "Steps", why: "Order matters.", body: `The steps run in order.\n\n${items}` });
  p.seed("kill.added", { id: "steps", criterion: { form: "revisit" } });
  const url = await serve(p).url;
  p.ok(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "The steps run in order.", new: "- first step\n- second step" },
      { tag: "elaborated", old: items, new: items.replace("- item 5", "- item 5\n- a new item") },
    ]),
  );
  await page.goto(`${url}/map/steps`);
  const body = page.locator('[data-field="body"]');
  const none = "rgba(0, 0, 0, 0)";
  const newItem = body.locator("li").filter({ hasText: "a new item" });
  await expect(newItem).toHaveCount(1);
  const newMark = newItem.locator('[data-diff="added"]');
  await expect(newMark).toHaveCount(1);
  expect(await newMark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(none);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  const gone = body.locator('[data-diff="removed"]').filter({ hasText: "The steps run in order." });
  await expect(gone).toHaveCount(1);
  expect(await gone.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  expect(await gone.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(none);
  for (const text of ["first step", "second step"]) {
    const mark = body.locator('[data-diff="added"]').filter({ hasText: text });
    await expect(mark).toHaveCount(1);
    expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(none);
  }
});

test("18.4 removing a card with two children offers subtree removal or reparent", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "server", { title: "Server" });
  card(p, "auth", { title: "Auth", parent: "server" });
  card(p, "tokens", { title: "Tokens", parent: "auth" });
  card(p, "sessions", { title: "Sessions", parent: "auth" });
  const url = await serve(p).url;
  const showBefore = p.ok("show", "auth");
  await page.goto(`${url}/map/auth`);
  await page.locator("article[data-card]").getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button")).toHaveCount(3);
  const subtree = dialog.getByRole("button", { name: /subtree/i });
  await expect(subtree).toContainText(/3 cards/);
  const reparent = dialog.getByRole("button", { name: /Remove only/i });
  await expect(reparent).toContainText(/1 card\b/);
  await expect(reparent).toContainText("Server");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const before = p.lines().length;
  await mark(page);
  await reparent.click();
  await expect(page.locator('#view [data-tile="auth"]')).toHaveCount(0);
  expect(p.lines().length).toBe(before + 1);
  expect(await marked(page)).toBe(true);
  await page.goto(`${url}/map/server`);
  await expect(page.locator('#view [data-tile="tokens"]')).toBeVisible();
  await expect(page.locator('#view [data-tile="sessions"]')).toBeVisible();
  await expect(page.locator('#view [data-tile="auth"]')).toHaveCount(0);
  p.ok("restore", "auth", "--actor", "you");
  await expect(page.locator('#view [data-tile="auth"]')).toBeVisible();
  await expect(page.locator('#view [data-tile="tokens"]')).toHaveCount(0);
  await page.goto(`${url}/map/auth`);
  await expect(page.locator('#view [data-tile="tokens"]')).toBeVisible();
  await expect(page.locator('#view [data-tile="sessions"]')).toBeVisible();
  expect(p.ok("show", "auth")).toBe(showBefore);
});

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page,
}) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  card(p, "legacy", { title: "Legacy importer" });
  card(p, "notes", { title: "Old notes" });
  const url = await serve(p).url;
  p.ok("propose", "legacy", "--remove");
  await page.goto(`${url}/map`);
  const red = await probe(page, "border-red-400", "borderTopColor");
  const tile = page.locator('#view [data-tile="legacy"]');
  await expect(tile).toHaveAttribute("data-removal", "true");
  expect(await tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(red);
  await page.goto(`${url}/map/notes`);
  const before = readFileSync(p.log, "utf8");
  await page.locator("article[data-card]").getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(h1(page)).toHaveText("Old notes");
  expect(readFileSync(p.log, "utf8")).toBe(before);
  await mark(page);
  const res = await send(url, "/api/remove", { method: "POST", body: JSON.stringify({ id: "notes" }) });
  expect(res.status).toBe(403);
  expect(readFileSync(p.log, "utf8")).toBe(before);
  await expect(h1(page)).toHaveText("Old notes");
  expect(await marked(page)).toBe(true);
  await page.goto(`${url}/map`);
  await expect(page.locator('#view [data-tile="notes"]')).toBeVisible();
});
