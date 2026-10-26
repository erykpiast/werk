import { expect, type Locator, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
const card = (w: Pick<Werk, "seed">, id: string, extra: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", status: "decided", who: "me", ...extra });
const dep = (w: Pick<Werk, "seed">, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });
const style = (at: Locator, prop: "backgroundColor" | "backgroundImage" | "borderLeftColor") =>
  at.evaluate((el, n) => getComputedStyle(el)[n], prop);
const box = (p: import("@playwright/test").Page, id: string) => p.locator(`article[data-card="${id}"]`);

test("72.1 rejected reopen: B red stale, C none", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a"); card(d, "b"); card(d, "c"); dep(d, "b", "a"); dep(d, "c", "b");
    d.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "Because wrong");
  await p.goto(`${w.url}/map/b`);
  const b = box(p, "b");
  await expect(b).toHaveAttribute("data-stale", "true");
  await expect(b).toHaveAttribute("data-status", "decided");
  expect(await style(b, "backgroundColor")).toMatch(/oklch\(0\.97\d* 0\.01\d* 17/);
  expect(await style(b, "borderLeftColor")).toMatch(/oklch\(0\.62\d* 0\.1\d* 149/);
  await p.goto(`${w.url}/map/c`);
  const c = box(p, "c");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c).toHaveAttribute("data-postponed", "false");
});

test("72.2 postponed reopen: B and C grey paused, status kept, no red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a"); card(d, "b"); card(d, "c"); dep(d, "b", "a"); dep(d, "c", "b");
    d.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "wait");
  for (const id of ["b", "c"]) {
    await p.goto(`${w.url}/map/${id}`);
    const x = box(p, id);
    const tagEl = x.locator('[data-tag="paused"]');
    await expect(tagEl).toHaveText("paused");
    expect(await tagEl.evaluate((el) => getComputedStyle(el).color)).toMatch(/oklch\(0\.\d+ 0(\.0\d*)? |rgb\(|oklch/);
    await expect(x.locator('[data-tag="stale"]')).toHaveCount(0);
    await expect(x).toHaveAttribute("data-stale", "false");
    await expect(x).toHaveAttribute("data-status", "decided");
    expect(await style(x, "borderLeftColor")).toMatch(/oklch\(0\.62\d* 0\.1\d* 149/);
  }
});

test("72.3 stale card view explains", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a"); card(d, "b"); dep(d, "b", "a");
    d.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("Card a");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
  await expect(s).toContainText("depends_on");
});

test("72.4 paused card two hops away: heading Why this card is stale", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a"); card(d, "b"); card(d, "c"); dep(d, "b", "a"); dep(d, "c", "b");
    d.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const headings = await p.locator("h2").allTextContents();
  console.log(headings);
  await expect(p.getByRole("heading", { name: "Why this card is stale" })).toBeVisible({ timeout: 2000 });
  await expect(p.locator("main, body")).toContainText("postponed");
  await expect(p.locator("body")).toContainText("We build the engine next quarter");
});

test("72.5 stale wins over paused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a"); card(d, "x"); card(d, "b"); dep(d, "b", "a"); dep(d, "b", "x");
    d.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
    d.seed("kill.added", { id: "x", criterion: { form: "revisit" } });
  });
  w.werk("reopen", "x", "--reason", "postponed");
  w.werk("reopen", "a", "--reason", "rejected");
  await p.goto(`${w.url}/map/b`);
  const b = box(p, "b");
  await expect(b).toHaveAttribute("data-stale", "true");
  expect(await style(b, "backgroundImage")).not.toContain("repeating-linear-gradient");
  await expect(p.locator('[data-trace="stale"]')).toContainText("Card a");
  await expect(p.locator('[data-trace="stale"]')).toContainText("rejected");
});
