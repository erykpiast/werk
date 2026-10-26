import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { isRed } from "./colors.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", status: "decided", who: "me", ...fields });
}
const dep = (w: Pick<Werk, "seed">, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });
const css = (at: Locator, prop: string) => at.evaluate((el, n) => getComputedStyle(el).getPropertyValue(n), prop);
const tagStale = (p: Page) => p.locator('[data-tag="stale"]');
const tagPaused = (p: Page) => p.locator('[data-tag="paused"]');

test("72.1 a rejected reopen marks only the direct dependent as stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "the vendor dropped it");
  await p.goto(`${w.url}/map/b`);
  await expect(tagStale(p)).toHaveCount(1);
  expect(isRed(await css(tagStale(p), "background-color"))).toBe(true);
  await expect(p.locator("article")).toHaveAttribute("data-status", "decided");
  expect(await css(p.locator("article"), "border-left-color")).toMatch(/oklch\(0\.6\d* 0\.1\d* 149/);
  await p.goto(`${w.url}/map/c`);
  await expect(tagStale(p)).toHaveCount(0);
  await expect(tagPaused(p)).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-stale", "false");
});

test("72.2 a postponed reopen marks every downstream card as paused, in grey", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "later");
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    await expect(tagPaused(p)).toHaveCount(1);
    expect(await css(tagPaused(p), "border-top-color")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await tagPaused(p).getAttribute("class")).toMatch(/gray/);
    await expect(tagStale(p)).toHaveCount(0);
    await expect(p.locator("article")).toHaveAttribute("data-status", "decided");
    expect(await css(p.locator("article"), "border-left-color")).toMatch(/oklch\(0\.6\d* 0\.1\d* 149/);
    await expect(p.locator("article")).toHaveAttribute("data-stale", "false");
  }
});

test("72.3 the card view of a stale card explains the change, the link and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    dep(d, "b", "a");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map/b`);
  const sec = p.locator('[data-section="stale"]');
  await expect(sec.locator("h2")).toHaveText("Why this card is stale");
  await expect(sec).toContainText("from #a");
  await expect(sec).toContainText("#b → #a");
  await expect(sec).toContainText("depends_on");
  await expect(sec).toContainText("rejected");
  await expect(sec).toContainText("The vendor dropped this API");
});

test("72.4 the card view of a paused card two hops away names the reopened card and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    card(d, "c");
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const heading = p.locator("section h2").filter({ hasText: "Why this card is" });
  await expect(heading).toHaveText("Why this card is stale");
  const sec = p.locator('[data-section="paused"], [data-section="stale"]').first();
  await expect(sec).toContainText("#a");
  await expect(sec).toContainText("reopened");
  await expect(sec).toContainText("postponed");
  await expect(sec).toContainText("We build the engine next quarter");
});

test("72.5 a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "x");
    card(d, "b");
    dep(d, "b", "a");
    dep(d, "b", "x");
  });
  w.werk("reopen", "x", "--reason", "postponed", "--why", "later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "wrong");
  await p.goto(`${w.url}/map/b`);
  await expect(tagStale(p)).toHaveCount(1);
  await expect(tagPaused(p)).toHaveCount(0);
  await expect(p.locator('[data-section="stale"]')).toContainText("#a");
  await expect(p.locator('[data-section="stale"]')).toContainText("rejected");
});

// ---- excerpts and threads ----
function quoted(): Promise<Werk> {
  return project(undefined, (d) => {
    card(d, "billing", { title: "We bill per seat" });
    mkdirSync(join(d.dir, ".werk", "chats"), { recursive: true });
    const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
    writeFileSync(join(d.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  });
}
const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await quoted();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/billing`);
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(said(p)).toHaveAttribute("data-pending", "true");
  await expect(said(p).locator('[data-mark="pending"]')).toBeVisible();
  await said(p).getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await quoted();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/billing`);
  await expect(p.locator('[data-section="say"]')).toContainText("seats are the unit");
  await expect(said(p)).toHaveAttribute("data-pending", "false");
  await expect(said(p).locator('[data-mark="pending"]')).toHaveCount(0);
});

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "auth-login", { title: "Login uses magic links" });
  });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});
