import { expect, type Page, test } from "@playwright/test";
import {
  decided,
  link,
  type MapServer,
  open,
  reopen,
  ROOT,
  ROOT_DECIDED,
  startMapServer,
} from "./support-map.ts";

const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const crumbs = (page: Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });
const heading = (page: Page, name: string) =>
  leftPane(page).getByRole("heading", { level: 1, name });

let server: MapServer;
test.afterEach(async () => {
  await server?.dispose();
});

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
}) => {
  server = await startMapServer({
    log: [
      ROOT,
      open("a", { parent: "root", title: "Level a" }),
      open("b", { parent: "a", title: "Level b" }),
      open("c", { parent: "b", title: "Level c" }),
      open("d", { parent: "c", title: "Level d" }),
    ],
  });
  await server.start();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(server.url);
  await expect(heading(page, "Root")).toBeVisible();
  const pane = await leftPane(page).boundingBox();
  console.log("PANE", pane?.width);
  expect(pane?.width).toBeLessThan(700);

  // Open the deep card from the map: follow the tiles down four levels.
  for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
    await leftPane(page).locator("a.tile", { hasText: title }).click();
    await expect(heading(page, title)).toBeVisible();
  }

  const line = crumbs(page).locator("[data-slot=crumb-line]");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("… › Level c › Level d");
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  await expect(line.locator("strong")).toHaveText("Level d");
  await expect(line.locator("strong")).toHaveCSS("font-weight", /^(700|600|bold)$/);
  await expect(line.getByRole("button", { name: "Level c" })).toBeVisible();

  await line.hover({ force: true });
  const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
  expect(full).toBe("Root › Level a › Level b › Level c › Level d");

  // The open overlay covers the line, so the click lands on the parent card in the overlay.
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(heading(page, "Level c")).toBeVisible();
  await expect(crumbs(page).locator("[data-slot=crumb-line] strong")).toHaveText(
    "Level c",
  );
  await expect(
    crumbs(page).locator("[data-slot=crumb-line] button"),
  ).toHaveText(["Level a", "Level b"].slice(1));
});

const MIXED = [
  ROOT_DECIDED,
  open("o1", { parent: "root", title: "An open card" }),
  open("p1", { parent: "root", title: "A proto card", status: "proto" }),
  open("p2", { parent: "p1", title: "Below the proto card" }),
  decided("x", { parent: "root", title: "The basis" }),
  decided("d1", { parent: "root", title: "A decided card" }),
  link("d1", "x"),
  reopen("x"),
];

test("17.2 the header counts follow the open card", async ({ page }) => {
  server = await startMapServer({ log: MIXED });
  await server.start();
  const stale = server.werk("stale");
  expect(stale.stdout).toContain("d1");
  await page.goto(server.url);
  await expect(heading(page, "Root")).toBeVisible();
  const counts = page.locator("[data-slot=counts]");
  const num = async (kind: string) => {
    const one = counts.locator(`[data-slot=count][data-kind=${kind}]`);
    return (await one.count()) === 0 ? null : Number(await one.innerText());
  };
  await expect(counts.locator("[data-slot=count]").first()).toBeVisible();
  const total = await num("total");
  const dots = [await num("open"), await num("proto"), await num("decided")];
  expect(total).not.toBeNull();
  expect(dots.every((n) => n !== null && n > 0)).toBe(true);
  expect((dots as number[]).reduce((a, b) => a + b, 0)).toBe(total as number);
  expect(await num("stale")).toBe(1);
  for (const status of ["open", "proto", "decided"]) {
    await expect(
      counts.locator(`[data-slot=count][data-kind=${status}]`),
    ).toHaveAttribute("title", new RegExp(status));
  }

  await leftPane(page).locator("a.tile", { hasText: "A proto card" }).click();
  await expect(heading(page, "A proto card")).toBeVisible();
  await expect(counts.locator("[data-slot=count][data-kind=total]")).toHaveText(
    "2",
  );
  await expect(counts.locator("[data-slot=count][data-kind=open]")).toHaveText(
    "1",
  );
  await expect(counts.locator("[data-slot=count][data-kind=proto]")).toHaveText(
    "1",
  );
  await expect(
    counts.locator("[data-slot=count][data-kind=decided]"),
  ).toHaveCount(0);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
}) => {
  const prefix = [1, 2, 3, 4, 5].map((n) =>
    open(`werk-${n}`, { parent: "root", title: `Prefix card ${n}` }),
  );
  const contain = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    open(`my-werk-${n}`, { parent: "root", title: `Inner card ${n}` }),
  );
  server = await startMapServer({
    log: [
      ROOT_DECIDED,
      // The contain cards come first in the log, so a sort by log order alone would fail.
      ...contain,
      decided("base", { parent: "root", title: "Base" }),
      open("werk", { parent: "root", title: "The werk card" }),
      ...prefix,
      open("werk-stale", { parent: "base", title: "Stale prefix card" }),
      reopen("base"),
    ],
  });
  await server.start();
  expect(server.werk("stale").stdout).toContain("werk-stale");
  await page.goto(server.url);
  await expect(heading(page, "Root")).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list).toBeVisible();
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(12);
  const ids = await rows.locator("code").allInnerTexts();
  expect(ids[0]).toBe("werk");
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  expect(firstContain).toBeGreaterThan(0);
  expect(ids.slice(firstContain).every((id) => !id.startsWith("werk"))).toBe(
    true,
  );
  expect(ids.slice(0, firstContain)).toContain("werk-stale");
  await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
  await expect(rows.first().locator("[data-slot=result-title]")).toHaveText(
    "The werk card",
  );
  const staleRow = rows.filter({ hasText: "werk-stale" });
  await expect(staleRow.locator("[data-slot=dot]")).toHaveAttribute(
    "data-color",
    "stale",
  );
  await expect(
    staleRow.locator("[data-slot=dot]"),
  ).toHaveCSS("background-color", /rgb\(2[0-9]{2}, \d{1,2}, \d{1,2}\)|rgb\(\d{3}, \d{1,2}, \d{1,2}\)/);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");

  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");

  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(heading(page, "The werk card")).toBeVisible();
  await expect(
    crumbs(page).locator("[data-slot=crumb-line] strong"),
  ).toHaveText("The werk card");
  await expect(box).toHaveValue("");
});
