import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 a deep card's breadcrumbs, hover overlay, and parent click", async ({ page: p }) => {
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const pane = await p.locator("#header").boundingBox();
  expect(pane?.width ?? 9999).toBeLessThan(700);
  await p.locator('[data-column="what"] article[data-card="root"] a').first().click();
  await expect(h1(p)).toHaveText("Root");
  for (const id of ["a", "b", "c", "d"]) {
    await p.locator(`a[data-tile="${id}"]`).click();
    await expect(h1(p)).toHaveText(`Card ${id}`);
  }
  const line = crumbs(p);
  const parts = await line.locator(":scope > *").allTextContents();
  expect(parts).toEqual(["…", "›", "Card c", "›", "Card d"]);
  const open = line.locator('[aria-current="page"]');
  expect(Number(await open.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await open.boundingBox();
  expect(box?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeHidden();
  await line.hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);

  await line.locator('button[data-crumb="c"]').click();
  await expect(h1(p)).toHaveText("Card c");
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
  const last = await crumbs(p).locator(":scope > *").last();
  await expect(last).toHaveText("Card c");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "o", "root", { status: "open" });
    card(d, "pr", "root", { status: "proto" });
    card(d, "pr1", "pr", { status: "decided" });
    card(d, "dd", "root");
    card(d, "st", "root");
    d.seed("edge.added", { from: "st", to: "dd", type: "depends_on", why: "needs dd" });
    d.seed("node.reopened", { id: "dd", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await expect(count(p, "total")).toBeVisible();
  const total = Number(await count(p, "total").locator('[data-role="value"]').textContent());
  let sum = 0;
  for (const s of ["open", "proto", "decided"]) {
    await expect(count(p, s)).toHaveCount(1);
    sum += Number(await count(p, s).locator('[data-role="value"]').textContent());
    expect(await count(p, s).getAttribute("title")).toContain(s);
  }
  expect(sum).toBe(total);
  const values = await p.locator('#header [data-count] [data-role="value"]').allTextContents();
  expect(values).not.toContain("0");
  await expect(count(p, "stale")).toHaveCount(1);
  expect(await count(p, "stale").getAttribute("title")).toContain("stale");

  await p.locator('a[data-tile="pr"]').click();
  await expect(h1(p)).toHaveText("Card pr");
  await expect(count(p, "total").locator('[data-role="value"]')).toHaveText("2");
  await expect(count(p, "proto").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "decided").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "open")).toHaveCount(0);
});

test("17.3 find a card by id from the search box", async ({ page: p }) => {
  const starts = ["werk-a", "werk-b", "werk-c", "werk-d", "werk-e", "werk-f", "werk-g", "werk-h"];
  const contains = ["vi-werk", "x-werk", "y-werk", "z-werk", "q-werk"];
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk itself" });
    for (const id of [...starts, ...contains]) card(d, id, "root");
    d.seed("edge.added", { from: "werk-a", to: "werk-b", type: "depends_on", why: "needs b" });
    d.seed("node.reopened", { id: "werk-b", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids.length).toBeLessThanOrEqual(12);
  expect(ids.length).toBeGreaterThan(9);
  expect(ids[0]).toBe("werk");
  const lastStart = Math.max(...ids.map((id, i) => (id.startsWith("werk") ? i : -1)));
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContain !== -1) expect(lastStart).toBeLessThan(firstContain);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row.locator("code")).toHaveText(id);
    await expect(row).toContainText(id === "werk" ? "werk itself" : `Card ${id}`);
  }
  const dot = p.locator('[role="option"][data-id="werk-a"] [data-role="dot"]');
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");

  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const cur = crumbs(p).locator('[aria-current="page"]');
  await expect(cur).toHaveText("werk itself");
  expect(Number(await cur.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 switch between the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(h1(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(h1(p)).toHaveText("The invoice");
});

test("17.5 the home shows requirements and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.bodyEdited", { id: "root", why: "Root reason" });
    card(d, "pay", "root", { title: "Customers pay" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How reason", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(r?.x ?? 0);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("Root reason");
  await expect(what.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How reason");
  await expect(how.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  stop();

  const w2 = await project();
  await p.goto(`${w2.url}/`);
  const empty = p.locator('[data-column="how"] article[data-empty="true"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Build rules");
  await expect(empty).toContainText("No build rules yet");
});
