import { appendFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { decided, link, open, reopen } from "../src/map/mark-fixtures.ts";
import { expect, test } from "./fixtures.ts";

const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const add = (path: string, ...events: unknown[]) =>
  appendFileSync(path, events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));

test("17.1 a deep card: one-line breadcrumbs, hover overlay, and a click on the parent", async ({ page, app }) => {
  add(app.logPath, open("a", { title: "Level a", parent: "root" }), open("b", { title: "Level b", parent: "a" }), open("c", { title: "Level c", parent: "b" }), open("d", { title: "Level d", parent: "c" }));
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(app.url);
  const pane = leftPane(page);
  const width = (await pane.boundingBox())?.width ?? 0;
  expect(width).toBeLessThan(700);
  for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
    await pane.locator("a.tile", { hasText: title }).first().click();
    await expect(pane.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("… › Level c › Level d");
  await expect(line.locator("strong")).toHaveText("Level d");
  expect(await line.locator("strong").evaluate((el) => getComputedStyle(el).fontWeight)).toMatch(/^(700|bold|[6-9]00)$/);
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
  expect(full).toBe("Home › We build software with agents › Level a › Level b › Level c › Level d");
  await crumbs.locator("[data-slot=crumb-line] button", { hasText: "Level c" }).click();
  await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  const after = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(after.endsWith("Level c")).toBe(true);
  await expect(line.locator("strong")).toHaveText("Level c");
});

function countsMap(path: string) {
  add(
    path,
    // decide root and the children, then reopen the root so its children stay decided
    { type: "node.edited", id: "root", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "root", form: "revisit" },
    { type: "node.decided", id: "root" },
    open("o1", { title: "Open one", parent: "root" }),
    open("p1", { title: "Proto one", parent: "root", status: "proto" }),
    decided("d1", { title: "Decided one", parent: "root" }),
    decided("basis", { title: "Basis" }),
    open("stl", { title: "Stale one", parent: "root" }),
    link("stl", "basis"),
    reopen("basis", { reason: "invalidated" }),
    open("sub", { title: "Sub with kids", parent: "o1" }),
    open("subkid", { title: "Sub kid", parent: "sub" }),
    { type: "node.reopened", id: "root", reason: "rejected" },
  );
}

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  countsMap(app.logPath);
  await page.goto(`${app.url}/map/root`);
  const counts = page.locator("[data-slot=counts] [data-slot=count]");
  await expect(counts.first()).toBeVisible();
  const read = async () => {
    const out: Record<string, { n: number; title: string }> = {};
    for (const el of await counts.all()) {
      out[(await el.getAttribute("data-kind")) as string] = { n: Number(await el.innerText()), title: (await el.getAttribute("title")) as string };
    }
    return out;
  };
  const root = await read();
  expect(root.total).toBeTruthy();
  expect(root.open && root.proto && root.decided).toBeTruthy();
  expect(root.open.n + root.proto.n + root.decided.n).toBe(root.total.n);
  expect(root.stale?.n).toBeGreaterThan(0);
  expect(root.open.title).toMatch(/open/);
  expect(root.proto.title).toMatch(/proto/);
  expect(root.decided.title).toMatch(/decided/);
  // no zero counts
  for (const c of Object.values(root)) expect(c.n).toBeGreaterThan(0);
  await leftPane(page).locator("a.tile", { hasText: "Open one" }).first().click();
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Open one" })).toBeVisible();
  await expect.poll(async () => (await read()).total?.n).toBe(3);
  const sub = await read();
  expect(sub.proto).toBeUndefined();
  expect(sub.decided).toBeUndefined();
  expect(sub.total.n).toBe(sub.open.n);
});

test("17.3 find a card by id and open it from the search box", async ({ page, app }) => {
  const events: unknown[] = [open("werk", { title: "Werk itself", parent: "root" })];
  for (const id of ["werk-a", "werk-b", "werk-c", "werk-d", "werk-e", "werk-f", "xwerk-1", "xwerk-2", "xwerk-3", "my-werk-4", "my-werk-5", "my-werk-6", "werk-g"]) {
    events.push(open(id, { title: `Title ${id}`, parent: "root" }));
  }
  events.push(
    decided("basis", { title: "Basis" }),
    open("werk-stale", { title: "Stale werk", parent: "root" }),
    link("werk-stale", "basis"),
    reopen("basis", { reason: "invalidated" }),
  );
  add(app.logPath, ...events);
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allInnerTexts();
  const lastStarts = ids.map((id) => id.startsWith("werk"));
  const firstContains = lastStarts.indexOf(false);
  if (firstContains >= 0) expect(lastStarts.slice(firstContains).every((s) => !s)).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).toBeVisible();
    await expect(row.locator("code")).toBeVisible();
  }
  const staleRow = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  if (await staleRow.count()) await expect(staleRow.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  else expect(ids).not.toContain("werk-stale"); // cut by the limit
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] strong")).toHaveText("Werk itself");
  await expect(box).toHaveValue("");
});
