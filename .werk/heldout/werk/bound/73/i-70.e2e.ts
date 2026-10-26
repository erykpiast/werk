// Held-out steps 70.1–70.5: ghosts in the map, and the ✓ that accepts them.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { decided, flagPage, isGrey, logLines, rgbOf, stillSamePage } from "./i-helpers.ts";

test.afterEach(stop);

async function payments(): Promise<Werk> {
  return project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    decided(down, "payments", { title: "Payments" });
  });
}

const tile = (p: Page, id: string) => p.locator(`[data-tile="${id}"]`);
const dashed = (p: Page, id: string) => tile(p, id).evaluate((el) => getComputedStyle(el).borderTopStyle);

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-section="subcards"]').locator('[data-tile="refunds"]')).toBeVisible();
  await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "true");
  expect(await dashed(p, "refunds")).toBe("dashed");
  const ghostBorder = await rgbOf(tile(p, "refunds"), "border-top-color");
  const ghostBg = await rgbOf(tile(p, "refunds"), "background-color");
  expect.soft(isGrey(ghostBorder), `ghost border colour ${JSON.stringify(ghostBorder)} is grey`).toBe(true);
  expect.soft(ghostBg.b > ghostBg.r + 5, `ghost background ${JSON.stringify(ghostBg)} is not blue-tinted`).toBe(false);

  await p.goto(`${w.url}/map/root`);
  await expect(tile(p, "payments")).toHaveAttribute("data-proposed", "false");
  expect(await dashed(p, "payments")).not.toBe("dashed");
  const realBg = await rgbOf(tile(p, "payments"), "background-color");
  expect(realBg.a === 0 || (realBg.r > 245 && realBg.g > 245 && realBg.b > 245)).toBe(true);
});

test("70.2 the person accepts one ghost with the ✓ button and it becomes real", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const before = logLines(w).length;
  await flagPage(p);
  await p.getByRole("button", { name: /Accept/ }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: /Accept/ })).toHaveCount(0);
  const added = logLines(w).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]?.actor).toBe("you");
  expect(JSON.stringify(added[0]?.payload)).toContain("refunds");
  expect(added[0]?.type).toMatch(/accept/);
  await p.goto(`${w.url}/map/payments`);
  await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
  expect(await dashed(p, "refunds")).not.toBe("dashed");
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial-refunds`);
  await flagPage(p);
  await p.getByRole("button", { name: /Accept/ }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(await stillSamePage(p)).toBe(true);
  await p
    .getByRole("link", { name: /Refunds/ })
    .first()
    .click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(tile(p, "partial-refunds")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
});

test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page: p }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Store credit only", "--why_not", "Users want money");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refund-law", "--kind", "source", "--title", "Refund law", "--finding", "Refunds are required");
  w.werk("link", "refunds", "refund-law", "--type", "supported_by");

  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /accept (all|both|every)/i })).toHaveCount(0);
  await expect(p.getByRole("button", { name: /Accept/ })).toHaveCount(0);
  await tile(p, "refunds").click();
  await expect(p).toHaveURL(/\/map\/refunds$/);
  await p.getByRole("button", { name: /Accept/ }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  for (const id of ["refunds:opt0", "refund-law"]) {
    const row = p.locator(`li[data-id="${id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("(proposed)");
    await expect(row).toHaveAttribute("data-pending", "false");
  }
  expect(w.werk("show", "refunds:opt0")).not.toMatch(/ghost/i);
  expect(w.werk("show", "refund-law")).not.toMatch(/ghost/i);
  await p.goto(`${w.url}/map/payments`);
  await expect(tile(p, "chargebacks")).toHaveAttribute("data-proposed", "true");
  expect(await dashed(p, "chargebacks")).toBe("dashed");
});

test("70.5 a second view sees the accept because it reads the same log", async ({ page: p, context }) => {
  const w = await payments();
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const second = await context.newPage();
  await p.goto(`${w.url}/map/refunds`);
  await second.goto(`${w.url}/map/refunds`);
  await expect(second.locator("article")).toHaveAttribute("data-proposed", "true");
  await flagPage(second);
  await p.getByRole("button", { name: /Accept/ }).click();
  await expect(second.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(second.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await stillSamePage(second)).toBe(true);
});
