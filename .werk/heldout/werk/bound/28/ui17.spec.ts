import { decided, link, open } from "../src/map/mark-fixtures.ts";
import { appendLog, decideEvents, expect, leftPane, test } from "./pw.ts";

const ROOT_TITLE = "We build software with agents";

test("17.1 a deep card: breadcrumbs on one line, hover shows the whole path, click goes up", async ({ page, app }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  appendLog(
    app,
    ...open("a", { parent: "root", title: "Level a" }),
    ...open("b", { parent: "a", title: "Level b" }),
    ...open("c", { parent: "b", title: "Level c" }),
    ...open("d", { parent: "c", title: "Level d" }),
  );
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const width = (await leftPane(page).boundingBox())?.width ?? 0;
  expect(width).toBeLessThan(700);
  for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
    await leftPane(page).locator("a.tile", { hasText: title }).first().click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toContainText("…");
  await expect(line).toContainText("›");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toMatch(/^…\s*›\s*Level c\s*›\s*Level d$/);
  await expect(line.locator("strong")).toHaveText("Level d");
  expect((await line.boundingBox())?.height ?? 99).toBeLessThan(40);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"]) await expect(overlay).toContainText(t);
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(line.locator("strong")).toHaveText("Level c");
});

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  appendLog(
    app,
    ...decideEvents("root"),
    ...open("o", { parent: "root", title: "Open child" }),
    ...open("o2", { parent: "o", title: "Open grandchild" }),
    ...open("p", { parent: "root", title: "Proto child", status: "proto" }),
    ...decided("base", { parent: "root", title: "Base" }),
    ...decided("s", { parent: "root", title: "Stale child" }),
    link("s", "base"),
    { type: "node.reopened", id: "base", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  await page.goto(app.url);
  const counts = page.locator("[data-slot=counts]");
  const n = async (kind: string) => {
    const el = counts.locator(`[data-kind=${kind}]`);
    return (await el.count()) === 0 ? null : Number(await el.innerText());
  };
  await expect(counts.locator("[data-kind=total]")).toBeVisible();
  const total = await n("total");
  const dots = (await n("open")) ?? 0;
  const sum = dots + ((await n("proto")) ?? 0) + ((await n("decided")) ?? 0);
  expect(sum).toBe(total);
  expect(total).toBe(6);
  expect(await n("stale")).toBe(1);
  for (const kind of ["open", "proto", "decided"]) {
    await expect(counts.locator(`[data-kind=${kind}]`)).toHaveAttribute("title", new RegExp(kind));
  }
  await page.goto(`${app.url}/map/o`);
  await expect(counts.locator("[data-kind=total]")).toHaveText("2");
  await expect(counts.locator("[data-kind=proto]")).toHaveCount(0);
  await expect(counts.locator("[data-kind=decided]")).toHaveCount(0);
});

test("17.3 find a card by id from the search box", async ({ page, app }) => {
  const extra = Array.from({ length: 10 }, (_, i) => open(`werk-x${i}`, { parent: "root", title: `Werk extra ${i}` })).flat();
  appendLog(
    app,
    ...decideEvents("root"),
    ...open("werk", { parent: "root", title: "Werk main" }),
    ...extra,
    ...open("my-werk", { parent: "root", title: "Contains werk" }),
    ...open("a-werk-b", { parent: "root", title: "Also contains" }),
    ...decided("werk-base", { parent: "root", title: "Werk base" }),
    ...decided("werk-stale", { parent: "root", title: "Werk stale" }),
    link("werk-stale", "werk-base"),
    { type: "node.reopened", id: "werk-base", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list).toBeVisible();
  const rows = list.locator("li");
  expect(await rows.count()).toBeLessThanOrEqual(12);
  expect(await rows.count()).toBe(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allInnerTexts();
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  if (firstContains !== -1) expect(lastStarts).toBeLessThan(firstContains);
  for (const row of await rows.all()) {
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
    await expect(row.locator("code")).not.toHaveText("");
  }
  await box.fill("#werk-stale");
  await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  await box.fill("#werk");
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("strong")).toHaveText("Werk main");
  await expect(box).toHaveValue("");
});

test("17.4 the Map and Board tabs switch views", async ({ page, app }) => {
  appendLog(app, ...open("a", { parent: "root", title: "Level a" }));
  await page.goto(`${app.url}/map/a`);
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page, [data-slot=board]").first()).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page, [data-slot=board]").first()).toBeVisible();
  await views.getByRole("button", { name: "Map" }).click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level a" })).toBeVisible();
});
