import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/support/fixtures.ts";
const ghost = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ type: "node.proposed", id, kind: "card", title, status: "open", ...extra });
const real = (id: string, title: string, extra: Record<string, unknown> = {}) => [ghost(id, title, extra), { type: "node.accepted", id, actor: "you" }];
const decided = (id: string, title: string, extra: Record<string, unknown> = {}) => [...real(id, title, extra), { type: "node.edited", id, who: "me", noBasis: "test" }, { type: "criterion.added", id, form: "revisit" }, { type: "node.decided", id }];
const edge = (from: string, to: string, link: string) => ({ type: "edge.added", from, to, link, why: "because" });

const ROOT_TITLE = "We build software with agents";
const AT = "2026-10-10T09:00:00.000Z";
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const put = (dir: string, ...events: unknown[]) =>
  appendFileSync(
    join(dir, ".werk", "log.jsonl"),
    `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`,
  );

test("17.1 deep card: breadcrumbs, overlay, and a click on the parent", async ({ page, app }) => {
  put(app.dir, real("a", "Level a", { parent: "root" }), real("b", "Level b", { parent: "a" }), real("c", "Level c", { parent: "b" }), real("d", "Level d", { parent: "c" }));
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const width = (await leftPane(page).boundingBox())?.width ?? 0;
  expect(width).toBeLessThan(700);
  for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
    await leftPane(page).locator("a.tile", { hasText: t }).click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: t })).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toHaveText(/^\s*…\s*›\s*Level c\s*›\s*Level d\s*$/);
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
  expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => e.tagName)).toBe("STRONG");
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText(new RegExp(`${ROOT_TITLE}\\s*›\\s*Level a\\s*›\\s*Level b\\s*›\\s*Level c\\s*›\\s*Level d`));
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
});

test("17.2 header counts follow the open card", async ({ page, app }) => {
  put(
    app.dir,
    real("c-open", "Open child", { parent: "root" }),
    real("kid", "Kid", { parent: "c-open" }),
    real("c-proto", "Proto child", { parent: "root", status: "proto" }),
    decided("dec", "Decided child"),
    edge("dec", "root", "refines"),
    decided("base2", "Base two"),
    real("stale-child", "Stale child", { parent: "root" }),
    edge("stale-child", "base2", "depends_on"),
    { type: "node.reopened", id: "base2", reason: "invalidated", at: AT },
  );
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const counts = page.locator("[data-slot=counts] [data-slot=count]");
  const n = async (kind: string) => {
    const el = page.locator(`[data-slot=count][data-kind=${kind}]`);
    return (await el.count()) === 0 ? null : Number(await el.innerText());
  };
  await expect(counts.first()).toBeVisible();
  const total = await n("total");
  const [o, p, d] = [await n("open"), await n("proto"), await n("decided")];
  expect(total).toBe(6);
  expect((o ?? 0) + (p ?? 0) + (d ?? 0)).toBe(total);
  expect([o, p, d]).toEqual([4, 1, 1]);
  await expect(page.locator("[data-slot=count][data-kind=open]")).toHaveAttribute("title", /open/);
  await expect(page.locator("[data-slot=count][data-kind=proto]")).toHaveAttribute("title", /proto/);
  await expect(page.locator("[data-slot=count][data-kind=decided]")).toHaveAttribute("title", /decided/);
  await expect(page.locator("[data-slot=count][data-kind=stale]")).toHaveAttribute("title", /stale/);

  await leftPane(page).locator("a.tile", { hasText: "Open child" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Open child" })).toBeVisible();
  await expect(page.locator("[data-slot=count][data-kind=total]")).toHaveText("2");
  await expect(page.locator("[data-slot=count][data-kind=open]")).toHaveText("2");
  await expect(page.locator("[data-slot=count][data-kind=proto]")).toHaveCount(0);
  await expect(page.locator("[data-slot=count][data-kind=decided]")).toHaveCount(0);
});

test("17.3 search by id and open", async ({ page, app }) => {
  const events: unknown[] = [real("werk", "Werk itself", { parent: "root" })];
  for (const s of ["a", "b", "c"]) events.push(real(`werk-${s}`, `Werk ${s}`, { parent: "root" }));
  events.push(decided("base3", "Base three"));
  events.push(real("werk-stale", "Werk stale", { parent: "root" }), edge("werk-stale", "base3", "depends_on"));
  events.push({ type: "node.reopened", id: "base3", reason: "invalidated", at: AT });
  for (let i = 1; i <= 9; i++) events.push(real(`x-werk-${i}`, `Contains ${i}`, { parent: "root" }));
  put(app.dir, ...events);
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allInnerTexts();
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  expect(firstContains).toBeGreaterThan(0);
  expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  for (const i of [0, 1]) {
    const row = rows.nth(i);
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toBeEmpty();
    await expect(row.locator("code")).not.toBeEmpty();
  }
  await expect(rows.filter({ hasText: "werk-stale" }).locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Werk itself" })).toBeVisible();
  await expect(page.locator("[data-slot=crumb-current]")).toHaveText("Werk itself");
  await expect(box).toHaveValue("");
});

test("17.4 Map and Board tabs", async ({ page, app }) => {
  put(app.dir, real("seats", "We charge per seat", { parent: "root" }));
  await page.goto(`${app.url}/map/seats`);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("button", { name: "Board" }).click();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  expect.soft(new URL(page.url()).pathname, "the address is /board").toBe("/board");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await views.getByRole("button", { name: "Map" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
});
