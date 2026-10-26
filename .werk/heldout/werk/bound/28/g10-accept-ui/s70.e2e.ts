import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop } from "../../e2e/project.ts";
import { card, events, flagPage, isGrey, stillSamePage } from "./common.ts";

test.afterEach(stop);

const look = (loc: Locator) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, bg: s.backgroundColor, dash: s.borderTopStyle };
  });

/** A tile drawn grey and dashed. */
async function expectGhostLook(tile: Locator) {
  await expect(tile).toBeVisible();
  await expect.poll(async () => (await look(tile)).dash).toBe("dashed");
  const l = await look(tile);
  expect(isGrey(l.border), `border colour ${l.border} is grey`).toBe(true);
}
async function expectRealLook(loc: Locator) {
  await expect(loc).toBeVisible();
  await expect.poll(async () => (await look(loc)).dash).not.toBe("dashed");
  await expect(loc).toHaveAttribute("data-proposed", "false");
}
const ghostRefunds = (w: { werk(...a: string[]): string }) =>
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
const seedPayments = (down: Parameters<typeof card>[0]) => card(down, "payments", { title: "Payments" });

async function openCard(p: Page, url: string, id: string) {
  await p.goto(`${url}/map/${id}`);
  await expect(p.locator(`article[data-card="${id}"]`)).toBeVisible();
}

test("70.1", async ({ page: p }) => {
  const w = await project(undefined, seedPayments);
  ghostRefunds(w);
  await p.goto(w.url);
  await p.locator('[data-tile="payments"]').first().click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  const tile = p.locator('[data-section="subcards"] [data-tile="refunds"]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("data-proposed", "true");
  await expectRealLook(p.locator('article[data-card="payments"]'));
  const pl = await look(p.locator('article[data-card="payments"]'));
  expect(isGrey(pl.bg) && pl.bg !== "rgb(255, 255, 255)" ? "grey bg" : "ok").toBe("ok");
  await expectGhostLook(tile);
});

test("70.2", async ({ page: p }) => {
  const w = await project(undefined, seedPayments);
  ghostRefunds(w);
  await openCard(p, w.url, "refunds");
  const before = events(w).length;
  await flagPage(p);
  await p.locator("article").getByRole("button", { name: "Accept" }).click();
  const hero = p.locator('article[data-card="refunds"]');
  await expectRealLook(hero);
  await expect(hero.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: /✓|Accept/ })).toHaveCount(0);
  const added = events(w).slice(before);
  const accepts = added.filter((e) => e.type === "change.accepted");
  expect(accepts).toHaveLength(1);
  expect(accepts[0]).toMatchObject({ actor: "you", payload: { id: "refunds" } });
  const refines = p.locator('[data-section="refines"] [data-id="payments"]');
  await expect(refines).toBeVisible();
  await expect(refines).toHaveAttribute("data-pending", "false");
  expect(await stillSamePage(p)).toBe(true);
});

test("70.3", async ({ page: p }) => {
  const w = await project(undefined, seedPayments);
  ghostRefunds(w);
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await openCard(p, w.url, "partial");
  await flagPage(p);
  await p.locator("article").getByRole("button", { name: "Accept" }).click();
  await expectRealLook(p.locator('article[data-card="partial"]'));
  const up = p.locator('[data-section="refines"] [data-id="refunds"]');
  await expect(up).toHaveAttribute("data-pending", "false");
  await expect(up).not.toContainText("(proposed)");
  expect(await stillSamePage(p)).toBe(true);
  await up.locator("a").click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  await expectRealLook(p.locator('article[data-card="refunds"]'));
  await expect(p.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
  const child = p.locator('[data-section="subcards"] [data-tile="partial"]');
  await expect(child).toHaveAttribute("data-proposed", "false");
  await p.locator('[data-section="refines"] [data-id="payments"] a').click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  await expect(p.locator('[data-section="subcards"] [data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4", async ({ page: p }) => {
  const w = await project(undefined, seedPayments);
  ghostRefunds(w);
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Refund by voucher", "--why_not", "Users want cash.");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refund-law", "--kind", "source", "--title", "Refund law", "--finding", "Refunds within 14 days.");
  w.werk("link", "refunds", "refund-law", "--type", "supported_by");
  await openCard(p, w.url, "refunds");
  const hero = p.locator('article[data-card="refunds"]');
  await expect(hero.getByRole("button", { name: "Accept" })).toHaveCount(1);
  await expect(p.getByRole("button", { name: /accept (all|both|every)|all/i })).toHaveCount(0);
  await hero.getByRole("button", { name: "Accept" }).click();
  await expectRealLook(hero);
  const option = p.locator('[data-section="options"] [data-id="refunds:opt0"]');
  const source = p.locator('[data-section="evidence"] [data-id="refund-law"]');
  for (const row of [option, source]) {
    await expect(row).toHaveAttribute("data-pending", "false");
    await expect(row).not.toContainText("(proposed)");
  }
  const after = events(w);
  const accepted = after.filter((e) => e.type === "change.accepted").map((e) => e.payload.id);
  expect(accepted).not.toContain("chargebacks");
  await p.locator('[data-section="refines"] [data-id="payments"] a').click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  const charge = p.locator('[data-section="subcards"] [data-tile="chargebacks"]');
  await expect(charge).toHaveAttribute("data-proposed", "true");
  await expectGhostLook(charge);
});

test("70.5", async ({ browser }) => {
  const w = await project(undefined, seedPayments);
  ghostRefunds(w);
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await openCard(one, w.url, "refunds");
  await openCard(two, w.url, "refunds");
  for (const page of [one, two]) await expect(page.locator("article")).toHaveAttribute("data-proposed", "true");
  await flagPage(two);
  await one.locator("article").getByRole("button", { name: "Accept" }).click();
  await expect(one.locator("article")).toHaveAttribute("data-proposed", "false");
  await expectRealLook(two.locator('article[data-card="refunds"]'));
  expect(await stillSamePage(two)).toBe(true);
});
