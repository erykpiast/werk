// Held-out steps 18.1–18.5: the person reviews proposals in the browser.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const CLI = join(process.cwd(), "src", "cli.ts");

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}
/** A card decided through the contract check: who, a waived basis and option, and a kill criterion. */
const rootDecided = new Set<string>();
function decide(w: Pick<Werk, "werk">, id: string): void {
  w.werk("edit", id, "--who", "me", "--no-basis", "It stands alone.", "--unchallenged", "Nothing else fits.");
  w.werk("kill", id, "--revisit");
  w.werk("status", id, "decided");
}
function decided(w: Pick<Werk, "seed" | "werk" | "dir">, id: string, fields: Record<string, unknown> = {}): void {
  if (!rootDecided.has(w.dir)) {
    rootDecided.add(w.dir);
    decide(w, "root");
  }
  card(w, id, fields);
  w.werk("edit", id, "--who", "me", "--no-basis", "It stands alone.", "--unchallenged", "Nothing else fits.");
  w.werk("kill", id, "--revisit");
  w.werk("status", id, "decided");
}
const logOf = (w: Werk) => readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
const events = (w: Werk) =>
  logOf(w)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; actor: string; type: string; payload: { id?: string } });

const flag = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const kept = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** Hue in degrees and chroma of a computed colour (rgb() or oklch()), and its alpha. */
function hue(s: string): { h: number; c: number; a: number } {
  const n = (s.match(/[\d.]+/g) ?? []).map(Number);
  if (s.startsWith("oklch")) return { h: n[2] ?? 0, c: n[1] ?? 0, a: s.includes("/") ? (n[3] ?? 1) : 1 };
  const [r = 0, g = 0, b = 0] = n.map((x) => x / 255);
  const a = n.length > 3 ? (n[3] ?? 1) : 1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, c: d, a };
}
const isBlue = (s: string) => {
  const { h, c, a } = hue(s);
  const oklch = s.startsWith("oklch");
  return a > 0 && c > (oklch ? 0.012 : 0.03) && (oklch ? h >= 200 && h <= 290 : h >= 190 && h <= 260);
};
const isRed = (s: string) => {
  const { h, c, a } = hue(s);
  const oklch = s.startsWith("oklch");
  return a > 0 && c > (oklch ? 0.05 : 0.1) && (oklch ? h <= 45 || h >= 340 : h <= 20 || h >= 340);
};
const style = (at: Locator) =>
  at.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, left: s.borderLeftColor, bg: s.backgroundColor, color: s.color };
  });

test("18.1 accepting a proposed new card with the ✓ makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (down) => decided(down, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  w.werk("add", "use-sqlite-cli", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/storage`);
  await p.locator('[data-tile="use-sqlite"]').click();
  await expect(p).toHaveURL(/\/map\/use-sqlite$/);

  const article = p.locator("article[data-card]");
  const look = await style(article);
  console.log("ghost look", look);
  expect(isBlue(look.border)).toBe(true);
  expect(isBlue(look.bg)).toBe(true);
  await expect(article.locator('[data-tag="proposed"]')).toHaveText(/proposed/i);
  const actions = article.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: /Accept/ })).toContainText("✓");
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const before = events(w).length;
  await flag(p);
  await actions.getByRole("button", { name: /Accept/ }).click();
  await expect(article.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(article).toHaveAttribute("data-proposed", "false");
  expect(isBlue((await style(article)).border)).toBe(false);
  expect(await kept(p)).toBe(true);
  const added = events(w).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-sqlite" } });

  w.werk("accept", "use-sqlite-cli", "--actor", "you");
  const cli = events(w).at(-1);
  expect(cli).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-sqlite-cli" } });
  const show = (id: string) => w.werk("show", id).replaceAll(id, "ID");
  expect(show("use-sqlite")).toBe(show("use-sqlite-cli"));
});

test("18.2 a pending edit to a decided card shows as a diff and an accept amends it", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    decided(down, "cache", { title: "Cache layer", why: "Reads are slow", body: "Entries expire after five minutes." }),
  );
  w.werk(
    "propose",
    "cache",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
    ]),
  );
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="cache"]').click();
  const article = p.locator("article[data-card]");
  const look = await style(article);
  console.log("cache look", look);
  expect(isBlue(look.border)).toBe(true);
  expect(isBlue(look.bg)).toBe(false);
  await expect.soft(article.getByText("proposed", { exact: true }), "no proposed badge").toHaveCount(0);

  const ten = article.locator("ins", { hasText: /^ten$/ });
  await expect(ten).toHaveCount(1);
  expect(isBlue((await style(ten)).bg)).toBe(true);
  const five = article.locator("del", { hasText: /^five$/ });
  await expect(five).toHaveCount(1);
  expect(isBlue((await style(five)).bg)).toBe(true);
  expect(await five.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  await expect(article.locator("ins, del, mark, [data-diff]")).toHaveCount(2);

  await flag(p);
  await article.getByRole("button", { name: /Accept/ }).click();
  await expect(article.locator("ins, del, [data-diff]")).toHaveCount(0).catch(async (e) => {
    console.log("after accept:", await article.innerText(), "\nlog tail:", logOf(w).split("\n").slice(-3).join("\n"));
    throw e;
  });
  await expect(article.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await kept(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`);
  const para = "The steps run in order.";
  const w = await project(undefined, (down) =>
    decided(down, "steps", { title: "Steps", body: `${para}\n\n${items.join("\n")}` }),
  );
  const longer = [...items.slice(0, 5), "- brand new item", ...items.slice(5)].join("\n");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: para, new: "- run first\n- run second" },
      { tag: "elaborated", old: items.join("\n"), new: longer },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = p.locator('[data-field="body"]');
  const fresh = body.locator("li", { hasText: "brand new item" });
  await expect(fresh).toHaveCount(1);
  expect(await fresh.locator("ins, [data-diff='added']").count()).toBeGreaterThan(0);
  expect(isBlue((await style(fresh.locator("ins, [data-diff='added']").first())).bg)).toBe(true);
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li", { hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("ins, del, [data-diff]")).toHaveCount(0);
    const inside = await old.evaluate((el) => el.closest("[data-diff]") === null);
    expect(inside).toBe(true);
  }
  const removed = body.locator("del, [data-diff='removed']").filter({ hasText: para });
  await expect(removed).toHaveCount(1);
  const rs = await removed.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, td: getComputedStyle(el).textDecorationLine }));
  expect(isBlue(rs.bg)).toBe(true);
  expect(rs.td).toContain("line-through");
  const addedList = body.locator("[data-diff='added']").filter({ hasText: "run first" });
  await expect(addedList).toHaveCount(1);
  await expect(addedList.locator("li")).toHaveCount(2);
  expect(isBlue((await style(addedList)).bg)).toBe(true);
});

test("18.4 removing a card with two children offers subtree or reparent with counts", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    decided(down, "server", { title: "Server" });
    decided(down, "auth", { title: "Auth", parent: "server" });
    decided(down, "tokens", { title: "Tokens", parent: "auth" });
    decided(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  const cardHtml = async (id: string) => ((await (await fetch(`${w.url}/api/card/${id}`)).json()) as { html: string }).html;
  const before = await cardHtml("auth");
  const showBefore = w.werk("show", "auth");
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: /Remove/ }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(answers.filter({ hasText: /subtree/i })).toContainText("3 cards");
  const reparent = answers.filter({ hasText: /Server/ });
  await expect(reparent).toContainText("1 card");
  await expect(reparent).toContainText(/Auth|#auth/);
  await expect(answers.filter({ hasText: /Cancel/ })).toHaveCount(1);

  const n = events(w).length;
  await flag(p);
  await reparent.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Server");
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await kept(p)).toBe(true);
  const added = events(w).slice(n);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  expect(await cardHtml("auth")).toBe(before);
  expect(w.werk("show", "auth")).toBe(showBefore);
});

test("18.5 a proposed removal shows in red, cancel changes nothing, a write without the token is refused", async ({
  page: p,
  request,
}) => {
  const w = await project(undefined, (down) => {
    decided(down, "legacy", { title: "Legacy importer" });
    decided(down, "old-notes", { title: "Old notes" });
  });
  // The agent proposes the removal: the only removal verb, run without the person's claim.
  const agent = spawnSync("bun", [CLI, "remove", "legacy"], { cwd: w.dir, encoding: "utf8" });
  console.log("agent remove:", agent.status, agent.stdout, agent.stderr);

  await p.goto(`${w.url}/map`);
  const tile = p.locator('[data-tile="legacy"]');
  await expect(tile).toBeVisible();
  const look = await style(tile);
  console.log("legacy look", look);
  expect.soft(isRed(look.border) || isRed(look.bg) || isRed(look.left), "Legacy importer is drawn in red").toBe(true);

  await p.goto(`${w.url}/map/old-notes`);
  const n = logOf(w);
  await p.getByRole("button", { name: /Remove/ }).click();
  await p.getByRole("dialog").getByRole("button", { name: /Cancel/ }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(logOf(w)).toBe(n);

  await flag(p);
  const res = await request.post(`${w.url}/api/remove`, { data: { id: "old-notes" } });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(logOf(w)).toBe(n);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(await kept(p)).toBe(true);
});
