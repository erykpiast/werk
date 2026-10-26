import { expect, type Locator, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { card, events, flagPage, isGrey, rgbOf, stillSamePage } from "./web-c-util.ts";

test.afterEach(stop);

async function look(at: Locator) {
  const border = await rgbOf(at, "border-top-color");
  const bg = await rgbOf(at, "background-color");
  const style = await at.evaluate((el) => getComputedStyle(el).borderTopStyle);
  return { border, bg, style };
}

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = p.locator('[data-section="subcards"] [data-tile="refunds"]');
  await expect(ghost).toBeVisible();
  const g = await look(ghost);
  const real = await look(p.locator('article[data-card="payments"]'));
  console.log("70.1 ghost", JSON.stringify(g), "payments", JSON.stringify(real));
  expect(real.style).toBe("solid");
  expect(g.style).toBe("dashed");
  expect(isGrey(g.border.rgba) && isGrey(g.bg.rgba)).toBe(true);
});

test("70.2 the person accepts one ghost with the ✓ button", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await p.locator('[data-tile="refunds"]').click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  const before = events(w).length;
  await flagPage(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  const added = events(w).slice(before);
  console.log("70.2 events", JSON.stringify(added));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await p.locator('[data-section="refines"] a[href$="/map/payments"]').click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await expect(p.locator('article[data-card="partial"]')).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.locator('[data-section="refines"] a[href$="/map/refunds"]').click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.locator('[data-section="refines"] a[href$="/map/payments"]').click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the accepted card's branch", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "No refunds", "--why_not", "Customers leave");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk(
    "add",
    "refunds:src0",
    "--kind",
    "source",
    "--title",
    "Survey",
    "--url",
    "https://x.example",
    "--finding",
    "Most want refunds",
  );
  w.werk("link", "refunds", "refunds:src0", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  const accepts = p.getByRole("button", { name: /accept/i });
  console.log("70.4 accept-like controls on payments", await accepts.count());
  await expect(accepts).toHaveCount(0);
  await p.locator('[data-tile="refunds"]').click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  await expect(p.locator('[data-section="options"] li[data-id="refunds:opt0"]')).toContainText("(proposed)");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(1);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  const opt = p.locator('[data-section="options"] li[data-id="refunds:opt0"]');
  const src = p.locator('[data-section="evidence"] li[data-id="refunds:src0"]');
  await expect(opt).not.toContainText("(proposed)");
  await expect(src).not.toContainText("(proposed)");
  await expect(opt).toHaveAttribute("data-pending", "false");
  await expect(src).toHaveAttribute("data-pending", "false");
  await p.locator('[data-section="refines"] a[href$="/map/payments"]').click();
  await expect(p).toHaveURL(/\/map\/payments$/);
  const charge = p.locator('[data-tile="chargebacks"]');
  await expect(charge).toHaveAttribute("data-proposed", "true");
  expect(await charge.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  const c = await look(charge);
  console.log("70.4 chargebacks", JSON.stringify(c));
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  expect(isGrey(c.border.rgba) && isGrey(c.bg.rgba)).toBe(true);
});

test("70.5 a second view sees the accept", async ({ browser }) => {
  const w = await project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await one.goto(`${w.url}/map/refunds`);
  await two.goto(`${w.url}/map/payments`);
  await expect(two.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await expect(one.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "true");
  await flagPage(two);
  await one.getByRole("button", { name: "Accept" }).click();
  await expect(two.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(two)).toBe(true);
});
