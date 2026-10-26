import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import type { BrowserServer } from "./server.ts";

const AT = "2026-10-10T09:00:00.000Z";
const card = (id: string, extra: Record<string, unknown> = {}) => [
  { type: "node.proposed", id, kind: "card", title: `Title ${id}`, status: "open", ...extra },
  { type: "node.accepted", id, actor: "you" },
];
const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...card(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const dep = (from: string, to: string) => ({ type: "edge.added", from, to, link: "depends_on", why: "needs" });
const append = (app: BrowserServer, events: unknown[]) =>
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));

const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumbs" });
const ROOT = "We build software with agents";

test("17.1 deep card and breadcrumbs", async ({ page, app }) => {
  append(app, [card("a", { parent: "root" }), card("b", { parent: "a" }), card("c", { parent: "b" }), card("d", { parent: "c" })]);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(app.origin + new URL(app.url).pathname);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  const pane = await page.locator("#left-pane").boundingBox();
  expect(pane?.width).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) {
    await leftPane(page).locator(`a.tile[data-card-id="${id}"]`).click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: `Title ${id}` })).toBeVisible();
  }
  const line = crumbs(page).locator("[data-slot=crumb-line]");
  await expect(line).toHaveText(/^…\s*›\s*Title c\s*›\s*Title d$/);
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Title d");
  expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => e.tagName)).toBe("STRONG");
  expect((await line.boundingBox())!.height).toBeLessThan(40);
  await line.hover({ force: true });
  const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText(new RegExp(`${ROOT}\\s*›\\s*Title a\\s*›\\s*Title b\\s*›\\s*Title c\\s*›\\s*Title d`));
  await overlay.getByRole("button", { name: "Title c" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title c" })).toBeVisible();
  await expect(crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Title c");
});

test("17.2 header counts follow the open card", async ({ page, app }) => {
  append(app, [
    { type: "node.edited", id: "root", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "root", form: "revisit" },
    { type: "node.decided", id: "root" },
    card("open1", { parent: "root" }),
    card("proto1", { parent: "root", status: "proto" }),
    decided("dec1", { parent: "root" }),
    decided("stale1", { parent: "root" }),
    dep("stale1", "dec1"),
    { type: "node.reopened", id: "dec1", reason: "invalidated", at: AT },
    card("o1a", { parent: "open1" }),
    card("o1b", { parent: "open1", status: "proto" }),
  ]);
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  const counts = page.locator("[data-slot=counts]");
  const n = async (kind: string) => {
    const el = counts.locator(`[data-kind=${kind}]`);
    return (await el.count()) === 0 ? null : Number(await el.innerText());
  };
  await expect.poll(() => n("total")).toBe(7);
  const [total, open, proto, dec] = [await n("total"), await n("open"), await n("proto"), await n("decided")];
  expect((open ?? 0) + (proto ?? 0) + (dec ?? 0)).toBe(total!);
  expect(open).toBeGreaterThan(0);
  expect(proto).toBeGreaterThan(0);
  expect(dec).toBeGreaterThan(0);
  expect(await counts.locator("[data-kind=stale]").count()).toBe(1);
  await expect(counts.locator("[data-kind=open]")).toHaveAttribute("title", /open/);
  await expect(counts.locator("[data-kind=proto]")).toHaveAttribute("title", /proto/);
  await expect(counts.locator("[data-kind=decided]")).toHaveAttribute("title", /decided/);
  await leftPane(page).locator('a.tile[data-card-id="open1"]').click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title open1" })).toBeVisible();
  await expect.poll(() => n("total")).toBe(3);
  expect(await n("open")).toBe(2);
  expect(await n("proto")).toBe(1);
  expect(await n("decided")).toBeNull();
});

test("17.3 find a card by id from the search box", async ({ page, app }) => {
  const ev: unknown[] = [
    card("werk", { parent: "root" }),
    decided("origin-x"),
    decided("werk-stale"),
    dep("werk-stale", "origin-x"),
    { type: "node.reopened", id: "origin-x", reason: "invalidated", at: AT },
  ];
  for (let i = 1; i <= 8; i++) ev.push(card(`x-werk-${i}`, { parent: "root" }));
  for (let i = 1; i <= 8; i++) ev.push(card(`werk-${i}`, { parent: "root" }));
  append(app, ev);
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allInnerTexts();
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  if (firstContains !== -1) expect(lastStarts).toBeLessThan(firstContains);
  const first = rows.first();
  await expect(first.locator("[data-slot=dot]")).toHaveCount(1);
  await expect(first.locator("[data-slot=result-title]")).toHaveText("Title werk");
  const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  await expect(stale).toHaveCount(1);
  await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  const color = await stale.locator("[data-slot=dot]").evaluate((e) => getComputedStyle(e).backgroundColor);
  const [r, g, b] = color.match(/\d+(\.\d+)?/g)!.map(Number);
  expect(r).toBeGreaterThan(g! + 40);
  expect(r).toBeGreaterThan(b! + 40);
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title werk" })).toBeVisible();
  await expect(crumbs(page).locator("[data-slot=crumb-current]")).toHaveText("Title werk");
  await expect(box).toHaveValue("");
});

test("17.4 Map and Board tabs", async ({ page, app }) => {
  append(app, [card("deep", { parent: "root" })]);
  await page.goto(app.url);
  await leftPane(page).locator('a.tile[data-card-id="deep"]').click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title deep" })).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page")).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page")).toBeVisible();
  await views.getByRole("button", { name: "Map" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title deep" })).toBeVisible();
});
