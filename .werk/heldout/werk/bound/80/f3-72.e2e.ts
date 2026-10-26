import { expect, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
type Down = Pick<Werk, "seed" | "werk">;
const card = (w: Down, id: string, extra: object = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent: "root", status: "decided", who: "me", ...extra });
const dep = (w: Down, from: string, to: string) =>
  w.seed("edge.added", { from, to, type: "depends_on", why: `${from} needs ${to}` });
const tile = (p: import("@playwright/test").Page, id: string) => p.locator(`a[data-tile="${id}"]`);
const bg = (l: import("@playwright/test").Locator) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
const bgi = (l: import("@playwright/test").Locator) => l.evaluate((e) => getComputedStyle(e).backgroundImage);
const bl = (l: import("@playwright/test").Locator) => l.evaluate((e) => getComputedStyle(e).borderLeftColor);

test("72.1 rejected reopen: B red stale mark over decided colour, C none", async ({ page: p }) => {
  let ref = "";
  const w = await project(undefined, (d) => {
    for (const id of ["a", "b", "c"]) card(d, id);
    dep(d, "b", "a");
    dep(d, "c", "b");
    d.werk("reopen", "a", "--reason", "rejected", "--why", "it is wrong");
  });
  await p.goto(`${w.url}/map`);
  const b = tile(p, "b");
  const c = tile(p, "c");
  await expect(b).toHaveAttribute("data-stale", "true");
  await expect(b).toHaveAttribute("data-status", "decided");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c).toHaveAttribute("data-postponed", "false");
  expect(await bg(b)).toMatch(/oklch\(0\.97\d* 0\.01\d* 17/); // red tint
  expect(await bg(c)).not.toMatch(/oklch\(0\.97\d* 0\.01\d* 17/);
  expect(await bl(b)).toBe(await bl(c)); // decided status colour kept
  expect(await bgi(c)).not.toContain("repeating-linear-gradient");
  void ref;
});

test("72.2 postponed reopen: B and C grey paused, keep decided colour, no red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "b", "c"]) card(d, id);
    dep(d, "b", "a");
    dep(d, "c", "b");
    d.werk("reopen", "a", "--reason", "postponed", "--why", "later");
  });
  await p.goto(`${w.url}/map`);
  for (const id of ["b", "c"]) {
    const t = tile(p, id);
    await expect(t).toHaveAttribute("data-postponed", "true");
    await expect(t).toHaveAttribute("data-status", "decided");
    await expect(t).toHaveAttribute("data-stale", "false");
    expect(await bgi(t)).toContain("repeating-linear-gradient");
    await expect(t.locator('[data-tag="postponed"]')).toHaveText("postponed");
    expect(await bg(t)).not.toMatch(/oklch\(0\.97\d* 0\.01\d* 17/);
  }
  expect(await bl(tile(p, "c"))).toBe(await bl(tile(p, "b")));
});

test("72.3 stale card view explains the change", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a");
    card(d, "b");
    dep(d, "b", "a");
    d.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  });
  await p.goto(`${w.url}/map`);
  await tile(p, "b").click();
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("a");
  await expect(s).toContainText("depends_on");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
});

test("72.4 paused card two hops away names reopened card and reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "b", "c"]) card(d, id);
    dep(d, "b", "a");
    dep(d, "c", "b");
    d.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  });
  await p.goto(`${w.url}/map`);
  await tile(p, "c").click();
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("postponed");
  await expect(s).toContainText("We build the engine next quarter");
});

test("72.5 stale wins over paused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    for (const id of ["a", "x", "b"]) card(d, id);
    dep(d, "b", "a");
    dep(d, "b", "x");
    d.werk("reopen", "x", "--reason", "postponed", "--why", "later");
    d.werk("reopen", "a", "--reason", "rejected", "--why", "broken");
  });
  await p.goto(`${w.url}/map`);
  const b = tile(p, "b");
  await expect(b).toHaveAttribute("data-stale", "true");
  expect(await bg(b)).toMatch(/oklch\(0\.97\d* 0\.01\d* 17/);
  await expect(b).toHaveAttribute("data-postponed", "false");
  expect(await bgi(b)).not.toContain("repeating-linear-gradient");
  await expect(b.locator('[data-tag="postponed"]')).toHaveCount(0);
  await b.click();
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});
