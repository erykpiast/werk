// Held-out steps 17.x: breadcrumbs, header counts, the search box, the tabs and the home view.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 a deep card shows a one-line path, a hover shows it all, a click opens the parent", async ({ page: p }) => {
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  expect((await p.locator("#left-pane").boundingBox())?.width ?? 999).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).first().click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(await current.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toMatch(/^…\s*›\s*Card c\s*›\s*Card d$/);
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
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "o", "root", { status: "open" });
    card(d, "pr", "root", { status: "proto" });
    card(d, "dc", "root");
    card(d, "dc2", "dc", { status: "open" });
    card(d, "base", "root");
    d.seed("edge.added", { from: "dc", to: "base", type: "depends_on", why: "It reads base" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const total = Number(await count(p, "total").textContent());
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) === 0) continue;
    const n = Number(await at.textContent());
    expect(n).toBeGreaterThan(0);
    await expect(at).toHaveAttribute("title", new RegExp(name));
    sum += n;
  }
  expect(sum).toBe(total);
  await expect(count(p, "open")).toHaveCount(1);
  await expect(count(p, "proto")).toHaveCount(1);
  await expect(count(p, "decided")).toHaveCount(1);

  await p.locator('a[data-tile="dc"]').click();
  await expect(heading(p)).toHaveText("Card dc");
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3 a # search lists at most twelve rows, the exact id first, and Enter opens it", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 8; i++) card(d, `werk-s${i}`, "werk", { title: `Starts ${i}` });
    for (let i = 1; i <= 8; i++) card(d, `x${i}-werk`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-s1", to: "x1-werk", type: "depends_on", why: "reads it" });
    d.seed("node.reopened", { id: "x1-werk", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBeGreaterThan(1);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  if (firstContains !== -1) expect(lastStarts).toBeLessThan(firstContains);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row).toContainText(id);
  }
  await expect(rows.first()).toContainText("werk v0");
  // The stale card is werk-s1 (its basis was reopened). It must be among the rows to check its dot.
  const stale = p.locator('[role="option"][data-id="werk-s1"] [data-role="dot"]');
  await expect(stale).toHaveCount(1);
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4 Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(heading(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await expect(heading(p)).not.toHaveText("The invoice");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 the home view shows #root and #how side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    const log = join(d.dir, ".werk", "log.jsonl");
    writeFileSync(log, readFileSync(log, "utf8").replace('"title":"Root"', '"title":"Root","why":"The product"'));
    card(d, "pay", "root", { title: "Customers pay online" });
    d.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "How we build",
      status: "decided",
      who: "me",
    });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  expect(l?.y).toBe(r?.y);
  await expect(what).toContainText("Root");
  await expect(what).toContainText("The product");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(what.locator("[data-count]").first()).toBeVisible();
  await expect(how).toContainText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(how.locator("[data-count]").first()).toBeVisible();
});

test("17.5b with no #how card the right column shows an empty build-rules card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how).toContainText(/build rules/i);
  await expect(how.locator("[data-tile]")).toHaveCount(0);
});
