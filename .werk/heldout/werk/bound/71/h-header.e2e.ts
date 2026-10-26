// Held-out tests for the header steps 17.1 to 17.5.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });
const weight = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).fontWeight));

/** The colour of an element as r, g, b, through a canvas so oklch() also converts. */
async function rgb(l: Locator, prop: "backgroundColor" | "borderTopColor" | "color"): Promise<number[]> {
  return l.evaluate((el, name) => {
    const colour = getComputedStyle(el)[name as "color"];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, prop);
}

test("17.1", async ({ page: p }) => {
  // The chat pane is 28rem wide, so a 1100px window leaves a left pane under 700px.
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (down) => {
    card(down, "a", "root");
    card(down, "b", "a");
    card(down, "c", "b");
    card(down, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const left = await p.locator("#header").boundingBox();
  expect(left?.width ?? 9999).toBeLessThan(700);
  // From the home view, open the deep card from the map: root, then each tile down.
  await p.locator('[data-column="what"] h2').click();
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  const parts = await line.evaluate((el) =>
    Array.from(el.children)
      .map((child) => child.textContent?.trim() ?? "")
      .filter((t) => t !== ""),
  );
  expect(parts).toEqual(["…", "›", "Card c", "›", "Card d"]);
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(await weight(current)).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await current.boundingBox();
  expect(box?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

  const full = p.locator('[data-role="crumbs-full"]');
  await line.hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual([
    "Home",
    "Root",
    "Card a",
    "Card b",
    "Card c",
    "Card d",
  ]);

  await p.mouse.move(0, 700);
  await line.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("Card c");
  expect(await weight(last)).toBeGreaterThanOrEqual(600);
  const texts = await crumbs(p).locator("[data-crumb]").allTextContents();
  expect(texts[texts.length - 1]).toBe("Card c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "o", "root", { status: "open" });
    card(down, "x", "o");
    card(down, "pr", "root", { status: "proto" });
    card(down, "d", "root");
    card(down, "d1", "d");
    card(down, "d2", "d");
    card(down, "s", "root");
    down.seed("edge.added", { from: "s", to: "x", type: "depends_on", why: "It reads x" });
    down.seed("node.reopened", { id: "x", reason: "invalidated", why: "x changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toBeVisible();
  const total = Number(await count(p, "total").textContent());
  expect(total).toBe(8);
  await expect(count(p, "stale")).toHaveCount(1);
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    await expect(count(p, name)).toHaveCount(1);
    await expect(count(p, name).locator("span").first()).toBeVisible(); // the dot
    sum += Number(await count(p, name).textContent());
    await expect(count(p, name)).toHaveAttribute("title", new RegExp(`\\b${name}\\b`));
  }
  expect(sum).toBe(total);
  await expect(count(p, "paused")).toHaveCount(0);
  await expect(count(p, "unchallenged")).toHaveCount(0);

  await p.locator('a[data-tile="d"]').click();
  await expect(heading(p)).toHaveText("Card d");
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "decided")).toHaveText("3");
  await expect(count(p, "open")).toHaveCount(0);
  await expect(count(p, "proto")).toHaveCount(0);
  await expect(count(p, "stale")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const starts = ["werk-a", "werk-b", "werk-c", "werk-d", "werk-e", "werk-f", "werk-g", "werk-h"];
  const contains = ["vi-werk", "my-werk", "x-werk-y", "z-werk", "q-werk", "r-werk"];
  const w = await project(undefined, (down) => {
    card(down, "werk", "root", { title: "werk v0" });
    for (const id of [...starts, ...contains]) card(down, id, "root");
    down.seed("edge.added", { from: "werk-b", to: "werk-a", type: "depends_on", why: "It reads a" });
    down.seed("node.reopened", { id: "werk-a", reason: "invalidated", why: "a changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBe(12);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  expect(firstContains).toBeGreaterThan(0);
  expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  expect(ids.filter((id) => id.startsWith("werk")).length).toBe(9);

  for (const id of ids) {
    const row = p.locator(`[role="option"][data-id="${id}"]`);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(id === "werk" ? "werk v0" : `Card ${id}`);
    await expect(row.locator("code")).toHaveText(id);
  }
  const dot = p.locator('[role="option"][data-id="werk-b"] [data-role="dot"]');
  const [r, g, b] = await rgb(dot, "backgroundColor");
  expect(r).toBeGreaterThan(150);
  expect(r).toBeGreaterThan((g ?? 0) * 2);
  expect(r).toBeGreaterThan((b ?? 0) * 2);

  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");

  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(heading(p)).toHaveText("werk v0");
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("werk v0");
  expect(await weight(last)).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(heading(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");

  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await expect(tab("Map")).not.toHaveAttribute("aria-current", "page");

  await p.reload();
  await expect(p.locator('[data-view="board"]')).toBeVisible();

  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5", async ({ page: p }) => {
  let w = await project(undefined, (down) => {
    down.seed("node.bodyEdited", { id: "root", why: "The product serves shops." });
    card(down, "pay", "root", { title: "Customers pay online" });
    card(down, "ship", "root", { title: "Orders ship" });
    down.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "Rules keep the build plain.",
      status: "decided",
      who: "me",
    });
    card(down, "tests", "how", { title: "Tests run on Bun" });
    card(down, "lint", "how", { title: "Lint runs first" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(r?.x ?? 0);

  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("The product serves shops.");
  await expect(what.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(what.locator('a[data-tile="ship"]')).toBeVisible();

  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("Rules keep the build plain.");
  await expect(how.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(how.locator('a[data-tile="lint"]')).toBeVisible();

  stop();
  w = await project(undefined, (down) => card(down, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const empty = p.locator('[data-column="how"] article[data-empty="true"]');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { level: 2 })).toHaveText("Build rules");
});
