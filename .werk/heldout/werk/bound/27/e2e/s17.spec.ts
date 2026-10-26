import { expect, test } from "@playwright/test";
import { reopen } from "../../src/map/mark-fixtures.ts";
import { decided, left, link, open, ROOT_EVENTS, serve } from "./helpers.ts";

const R = [...decided("root", { title: "Root", why: "The top." })];
const crumbs = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Breadcrumbs" });

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page }) => {
  const log = [
    ...R,
    ...decided("a", { title: "Level a", parent: "root" }),
    ...decided("b", { title: "Level b", parent: "a" }),
    ...decided("c", { title: "Level c", parent: "b" }),
    ...decided("d", { title: "Level d", parent: "c" }),
  ];
  await page.setViewportSize({ width: 1000, height: 800 });
  await serve({ log }, async (server) => {
    await page.goto(server.url);
    const pane = left(page);
    expect((await pane.boundingBox())?.width).toBeLessThan(700);
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
      await pane.locator("a.tile", { hasText: t }).click();
      await expect(pane.getByRole("heading", { level: 1, name: t })).toBeVisible();
    }
    const line = crumbs(page).locator("[data-slot=crumb-line]");
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
    const text = (await line.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe("… › Level c › Level d");
    expect(await line.locator("strong").count()).toBe(1);
    await line.hover({ force: true });
    const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
    expect(full).toBe("Root › Level a › Level b › Level c › Level d");
    await overlay.getByRole("button", { name: "Level c" }).click();
    await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Level c");
  });
});

test("17.2 the header counts follow the open card", async ({ page }) => {
  const log = [
    ...R,
    ...open("o", { title: "Open one", parent: "root" }),
    ...open("p", { title: "Proto one", parent: "root", status: "proto" }),
    ...decided("d", { title: "Decided one", parent: "root" }),
    ...open("gx", { title: "Grand x", parent: "d" }),
    ...decided("gy", { title: "Grand y", parent: "d" }),
    ...decided("base", { title: "Base", parent: "root" }),
    ...decided("s", { title: "Stale one", parent: "root" }),
    link("s", "base"),
    reopen("base"),
  ];
  await serve({ log }, async (server) => {
    await page.goto(`${server.url}/map/root`);
    const counts = page.locator("[data-slot=counts] [data-slot=count]");
    await expect(counts.first()).toBeVisible();
    const read = async () => {
      const all = await counts.evaluateAll((els) =>
        els.map((e) => ({ kind: (e as HTMLElement).dataset.kind as string, n: Number(e.textContent), title: (e as HTMLElement).title })),
      );
      return Object.fromEntries(all.map((c) => [c.kind, c]));
    };
    const c = await read();
    expect(c.total).toBeDefined();
    expect(c.open.n + c.proto.n + c.decided.n).toBe(c.total.n);
    expect(c.open.title).toMatch(/open/);
    expect(c.proto.title).toMatch(/proto/);
    expect(c.decided.title).toMatch(/decided/);
    expect(c.stale).toBeDefined();
    expect(c.postponed).toBeUndefined();
    await page.goto(`${server.url}/map/d`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Decided one" })).toBeVisible();
    await expect.poll(async () => (await read()).total?.n).toBe(3);
    const c2 = await read();
    expect(c2.open.n + (c2.proto?.n ?? 0) + c2.decided.n).toBe(3);
  });
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page }) => {
  const log = [...R, ...decided("werk", { title: "The werk card", parent: "root" })];
  for (let i = 0; i < 5; i++) log.push(...open(`werk-${i}`, { title: `Prefix ${i}`, parent: "root" }));
  for (let i = 0; i < 9; i++) log.push(...open(`my-werk-${i}`, { title: `Contains ${i}`, parent: "root" }));
  log.push(...decided("base", { title: "Base", parent: "root" }), ...decided("werk-stale", { title: "Stale werk", parent: "root" }), link("werk-stale", "base"), reopen("base"));
  await serve({ log }, async (server) => {
    await page.goto(server.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allTextContents();
    const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
    const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
    expect(firstContains === -1 || firstContains > lastPrefix).toBe(true);
    const row0 = rows.first();
    await expect(row0.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row0.locator("[data-slot=result-title]")).toHaveText("The werk card");
    await box.fill("#werk-stale");
    await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    await box.fill("#werk");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(crumbs(page).locator("[data-slot=crumb-current]")).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  });
});

test("17.4 a person switches between the Map and Board tabs", async ({ page }) => {
  const log = [...R, ...decided("a", { title: "Card a", parent: "root" })];
  await serve({ log }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(left(page).getByRole("heading", { level: 1, name: "Card a" })).toBeVisible();
    await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.locator(".board-page")).toBeVisible();
    await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.locator(".board-page")).toBeVisible();
    await views.getByRole("button", { name: "Map" }).click();
    await expect(left(page).getByRole("heading", { level: 1, name: "Card a" })).toBeVisible();
  });
});
