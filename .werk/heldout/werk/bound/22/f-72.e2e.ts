// Held-out: 72.1-72.5 stale and paused marks in the browser.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Werk, id: string, title: string): void {
  w.seed("node.added", { id, kind: "card", title, parent: "root", status: "decided", who: "me" });
}
const dep = (w: Werk, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });
const tags = (p: Page) => p.locator('[data-role="tags"]');
const GREEN = /oklch\(0\.62\d* 0\.1\d* 149/;

async function open(p: Page, w: Werk, id: string) {
  await p.goto(`${w.url}/map/${id}`);
  await expect(p.locator(`article[data-card="${id}"]`)).toBeVisible();
}
const edge = (p: Page, id: string) =>
  p.locator(`article[data-card="${id}"]`).evaluate((el) => getComputedStyle(el).borderLeftColor);

async function chain(w: Werk) {
  card(w, "a", "Card A");
  card(w, "b", "Card B");
  card(w, "c", "Card C");
  dep(w, "b", "a");
  dep(w, "c", "b");
}

test("72.1", async ({ page: p }) => {
  const w = await project();
  await chain(w);
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The storage choice is wrong");
  await p.goto(`${w.url}/map`);
  await open(p, w, "b");
  const stale = tags(p).locator('[data-tag="stale"]');
  await expect(stale).toBeVisible();
  expect(await stale.getAttribute("class")).toContain("red");
  await expect(tags(p).locator('[data-tag="status"]')).toHaveText("decided");
  expect(await edge(p, "b")).toMatch(GREEN);
  await open(p, w, "c");
  await expect(tags(p).locator('[data-tag="stale"]')).toHaveCount(0);
  await expect(tags(p).locator('[data-tag="paused"]')).toHaveCount(0);
});

test("72.2", async ({ page: p }) => {
  const w = await project();
  await chain(w);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map`);
  for (const id of ["b", "c"]) {
    await open(p, w, id);
    const paused = tags(p).locator('[data-tag="paused"]');
    await expect(paused).toBeVisible();
    expect(await paused.getAttribute("class")).toContain("gray");
    await expect(tags(p).locator('[data-tag="stale"]')).toHaveCount(0);
  }
  await expect(tags(p).locator('[data-tag="status"]')).toHaveText("decided");
  expect(await edge(p, "c")).toMatch(GREEN);
});

test("72.3", async ({ page: p }) => {
  const w = await project();
  card(w, "a", "Card A");
  card(w, "b", "Card B");
  dep(w, "b", "a");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map`);
  await open(p, w, "b");
  const sec = p.locator("section", { has: p.getByRole("heading", { name: "Why this card is stale" }) });
  await expect(sec).toBeVisible();
  await expect(sec.locator('a[href="/map/a"]').first()).toBeVisible();
  await expect(sec).toContainText("depends_on");
  await expect(sec).toContainText("#b");
  await expect(sec).toContainText("rejected");
  await expect(sec).toContainText("The vendor dropped this API");
});

test("72.4", async ({ page: p }) => {
  const w = await project();
  await chain(w);
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map`);
  await open(p, w, "c");
  const heading = p.getByRole("heading", { name: "Why this card is stale" });
  await expect(heading).toBeVisible();
  const sec = p.locator("section", { has: heading });
  await expect(sec.locator('a[href="/map/a"]').first()).toBeVisible();
  await expect(sec).toContainText("postponed");
  await expect(sec).toContainText("We build the engine next quarter");
});

test("72.5", async ({ page: p }) => {
  const w = await project();
  card(w, "a", "Card A");
  card(w, "x", "Card X");
  card(w, "b", "Card B");
  dep(w, "b", "a");
  dep(w, "b", "x");
  w.werk("reopen", "x", "--reason", "postponed", "--why", "Later");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "Wrong");
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="b"]');
  await expect(tile).toBeVisible();
  await open(p, w, "b");
  await expect(tags(p).locator('[data-tag="stale"]')).toBeVisible();
  await expect(tags(p).locator('[data-tag="paused"]')).toHaveCount(0);
  const sec = p.locator('[data-section="stale"]');
  await expect(sec.locator('[data-origin="a"]')).toBeVisible();
  await expect(sec).toContainText("rejected");
});
