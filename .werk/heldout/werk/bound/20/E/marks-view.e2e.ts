// Held-out steps 72.x: the stale and paused marks in the browser, after a reopen on the command line.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, title: string): void {
  w.seed("node.added", { id, kind: "card", title, parent: "root", status: "decided", who: "me" });
}
const dep = (w: Pick<Werk, "seed">, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} takes from ${to}` });

const style = (l: Locator, prop: string) => l.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);
const hue = (color: string) => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)/.exec(color)?.[1] ?? Number.NaN);

async function openCard(p: Page, w: Werk, id: string) {
  await p.goto(`${w.url}/map`);
  await p.goto(`${w.url}/map/${id}`);
  return p.locator(`article[data-card="${id}"]`);
}

async function expectRedStale(box: Locator) {
  const tag = box.locator('[data-tag="stale"]');
  await expect(tag).toBeVisible();
  const h = hue(await style(tag, "color"));
  expect(h > 10 && h < 40).toBe(true);
}
async function expectGreyPaused(box: Locator) {
  const tag = box.locator('[data-tag="paused"]');
  await expect(tag).toBeVisible();
  const c = await style(tag, "color");
  const chroma = Number(/oklch\([\d.]+ ([\d.]+)/.exec(c)?.[1] ?? 1);
  expect(chroma).toBeLessThan(0.05);
}
async function expectDecidedEdge(box: Locator) {
  await expect(box.locator('[data-tag="status"]')).toHaveText("decided");
  const h = hue(await style(box, "border-left-color"));
  expect(h > 130 && h < 160).toBe(true);
}

const abc = (down: Pick<Werk, "seed">) => {
  card(down, "A", "Card A");
  card(down, "B", "Card B");
  card(down, "C", "Card C");
  dep(down, "B", "A");
  dep(down, "C", "B");
};

test("72.1 a rejected reopen marks only the direct dependent as stale, in red", async ({ page: p }) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "A", "--reason", "rejected", "--why", "The storage choice is wrong");
  const b = await openCard(p, w, "B");
  await expectRedStale(b);
  await expectDecidedEdge(b);
  const c = await openCard(p, w, "C");
  await expect(c.locator('[data-tag="stale"]')).toHaveCount(0);
  await expect(c.locator('[data-tag="paused"]')).toHaveCount(0);
  await expect(c).toHaveAttribute("data-stale", "false");
});

test("72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour", async ({
  page: p,
}) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "A", "--reason", "postponed", "--why", "We build the engine next quarter");
  const b = await openCard(p, w, "B");
  await expectGreyPaused(b);
  await expect(b.locator('[data-tag="stale"]')).toHaveCount(0);
  const c = await openCard(p, w, "C");
  await expectGreyPaused(c);
  await expectDecidedEdge(c);
  await expect(c.locator('[data-tag="stale"]')).toHaveCount(0);
});

test("72.3 the card view of a stale card explains the change, the link, and the reason", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "A", "Card A");
    card(down, "B", "Card B");
    dep(down, "B", "A");
  });
  w.werk("reopen", "A", "--reason", "rejected", "--why", "The vendor dropped this API");
  await openCard(p, w, "B");
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#A");
  await expect(s.locator('[data-role="link"]')).toContainText("#B");
  await expect(s.locator('[data-role="link"]')).toContainText("#A");
  await expect(s.locator('[data-role="link"]')).toContainText("depends_on");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
});

test("72.4 the card view of a paused card two hops away names the reopened card and the reason", async ({
  page: p,
}) => {
  const w = await project(undefined, abc);
  w.werk("reopen", "A", "--reason", "postponed", "--why", "We build the engine next quarter");
  await openCard(p, w, "C");
  await expect(p.getByRole("heading", { name: "Why this card is stale" })).toBeVisible();
  const marks = p.locator('[data-section="stale"], [data-section="paused"]');
  await expect(marks.first()).toContainText("#A");
  await expect(marks.first()).toContainText("postponed");
  await expect(marks.first()).toContainText("We build the engine next quarter");
});

test("72.5 a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "A", "Card A");
    card(down, "X", "Card X");
    card(down, "B", "Card B");
    dep(down, "B", "A");
    dep(down, "B", "X");
  });
  w.werk("reopen", "X", "--reason", "postponed");
  w.werk("reopen", "A", "--reason", "rejected");
  const b = await openCard(p, w, "B");
  await expectRedStale(b);
  await expect(b.locator('[data-tag="paused"]')).toHaveCount(0);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#A");
  await expect(s).toContainText("rejected");
});
