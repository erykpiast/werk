import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { decide, real } from "./helpers-14-17.ts";

const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const ROOT = "We build software with agents";

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page, app }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  real(app.werk, "a", "root", "Level a");
  real(app.werk, "b", "a", "Level b");
  real(app.werk, "c", "b", "Level c");
  real(app.werk, "d", "c", "Level d");
  await page.goto(app.url);
  const width = await pane(page).evaluate((el) => el.clientWidth);
  expect(width).toBeLessThan(700);
  for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
    await pane(page).locator("a.tile", { hasText: t }).first().click();
    await expect(pane(page).getByRole("heading", { level: 1, name: t })).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toContainText("…");
  await expect(line).toContainText("Level c");
  await expect(line).not.toContainText("Level b");
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
  expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => e.tagName)).toBe("STRONG");
  expect(((await line.boundingBox())?.height ?? 99)).toBeLessThan(40);
  expect(await line.innerText()).toMatch(/…\s*›\s*Level c\s*›\s*Level d/);

  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  for (const t of ["Home", ROOT, "Level a", "Level b", "Level c", "Level d"]) await expect(overlay).toContainText(t);

  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(pane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
});

async function seedCounts(app: { werk: Parameters<typeof real>[0] }) {
  decide(app.werk, "root");
  real(app.werk, "o", "root", "Open child");
  real(app.werk, "o1", "o", "Open grandchild");
  real(app.werk, "p", "root", "Proto child", "proto");
  real(app.werk, "dd", "root", "Decided child");
  decide(app.werk, "dd");
  real(app.werk, "base", "root", "Basis");
  decide(app.werk, "base");
  real(app.werk, "s", "root", "Stale child");
  expect(app.werk("link", "s", "base", "--type", "depends_on", "--why", "needs it").code).toBe(0);
  decide(app.werk, "s");
  expect(app.werk("reopen", "base", "--reason", "invalidated").code).toBe(0);
}

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  await seedCounts(app);
  await page.goto(`${app.url}/map/root`);
  const counts = page.locator("[data-slot=counts]");
  const n = async (kind: string) => {
    const el = counts.locator(`[data-kind=${kind}]`);
    return (await el.count()) === 0 ? null : Number(await el.innerText());
  };
  await expect(counts.locator("[data-kind=total]")).toBeVisible();
  const total = await n("total");
  const open = await n("open");
  const proto = await n("proto");
  const decided = await n("decided");
  expect(open).not.toBeNull();
  expect(proto).not.toBeNull();
  expect(decided).not.toBeNull();
  expect((open ?? 0) + (proto ?? 0) + (decided ?? 0)).toBe(total);
  expect(await n("stale")).toBe(1);
  await expect(counts.locator("[data-kind=open]")).toHaveAttribute("title", /open/);
  await expect(counts.locator("[data-kind=proto]")).toHaveAttribute("title", /proto/);
  await expect(counts.locator("[data-kind=decided]")).toHaveAttribute("title", /decided/);

  await pane(page).locator("a.tile", { hasText: "Open child" }).first().click();
  await expect(pane(page).getByRole("heading", { level: 1, name: "Open child" })).toBeVisible();
  await expect(counts.locator("[data-kind=total]")).toHaveText("2");
  expect(await n("open")).toBe(2);
  expect(await counts.locator("[data-kind=proto]").count()).toBe(0);
  expect(await counts.locator("[data-kind=decided]").count()).toBe(0);
});

test("17.3 a person finds a card by id from the search box", async ({ page, app }) => {
  decide(app.werk, "root");
  real(app.werk, "werk", "root", "The werk card");
  real(app.werk, "base", "root", "Basis");
  decide(app.werk, "base");
  real(app.werk, "werk-stale", "root", "Stale werk card");
  expect(app.werk("link", "werk-stale", "base", "--type", "depends_on", "--why", "needs it").code).toBe(0);
  decide(app.werk, "werk-stale");
  expect(app.werk("reopen", "base", "--reason", "invalidated").code).toBe(0);
  for (const id of ["x-werk-1", "x-werk-2", "x-werk-3", "x-werk-4"]) real(app.werk, id, "root", `Contains ${id}`);
  for (let i = 1; i <= 9; i++) real(app.werk, `werk-${i}`, "root", `Prefix ${i}`);

  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).locator("li");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(12);
  expect(await rows.count()).toBe(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allInnerTexts();
  const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
  const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
  expect(firstContains).toBeGreaterThan(lastPrefix);
  for (const i of [0, 1, 11]) {
    await expect(rows.nth(i).locator("[data-slot=dot]")).toHaveCount(1);
    await expect(rows.nth(i).locator("[data-slot=result-title]")).not.toHaveText("");
  }
  const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  const color = await stale.locator("[data-slot=dot]").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(color).toMatch(/rgb\(\s*(2[0-5]\d|1[89]\d)/);

  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("The werk card");
  await expect(box).toHaveValue("");
});
