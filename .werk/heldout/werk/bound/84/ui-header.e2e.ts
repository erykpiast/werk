// Held-out: header, crumbs, counts, search, tabs, home (steps 17.x).
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, f: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...f });
}
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, n: string) => p.locator(`#header [data-count="${n}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 deep card path and breadcrumbs", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 700 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).first().click();
  await expect(heading(p)).toHaveText("Card d");
  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  await expect(line.locator('[aria-current="page"]')).toHaveText("Card d");
  const weight = await line.locator('[aria-current="page"]').evaluate((e) => Number(getComputedStyle(e).fontWeight));
  expect(weight).toBeGreaterThanOrEqual(600);
  await expect(line).toContainText("Card c");
  await expect(line).not.toContainText("Card b");
  expect(await line.textContent()).toContain("›");
  const box = await line.boundingBox();
  const seg = await line.locator('[aria-current="page"]').boundingBox();
  expect(box?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);
  const full = p.locator('[data-role="crumbs-full"]');
  await line.hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await full.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
  const w2 = await crumbs(p).locator('[aria-current="page"]').evaluate((e) => Number(getComputedStyle(e).fontWeight));
  expect(w2).toBeGreaterThanOrEqual(600);
});

test("17.2 header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root", { status: "open" });
    card(d, "base", "root");
    card(d, "st", "root", { status: "decided" });
    d.seed("edge.added", { from: "st", to: "base", type: "depends_on", why: "needs it" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  const total = Number(await count(p, "total").textContent());
  let sum = 0;
  for (const n of ["open", "proto", "decided"]) if ((await count(p, n).count()) > 0) sum += Number(await count(p, n).textContent());
  expect(sum).toBe(total);
  await expect(count(p, "stale")).toHaveCount(1);
  await expect(count(p, "open")).toHaveAttribute("title", /open/);
  await expect(count(p, "proto")).toHaveAttribute("title", /proto/);
  await expect(count(p, "decided")).toHaveAttribute("title", /decided/);
  await p.goto(`${w.url}/map/a`);
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
});

test("17.3 find a card by id from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 0; i < 6; i++) card(d, `werk-${i}`, "werk", { title: `Starts ${i}` });
    for (let i = 0; i < 6; i++) card(d, `x-werk-${i}`, "root", { title: `Contains ${i}` });
    card(d, "werk-stale", "werk", { title: "Stale one" });
    card(d, "basis", "root");
    d.seed("edge.added", { from: "werk-stale", to: "basis", type: "depends_on", why: "needs" });
    d.seed("node.reopened", { id: "basis", reason: "rejected", why: "wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBeGreaterThan(0);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const lastStart = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
  const firstContain = ids.findIndex((i) => !i.startsWith("werk"));
  if (firstContain >= 0) expect(lastStart).toBeLessThan(firstContain);
  const first = rows.first();
  await expect(first.locator('[data-role="dot"]')).toHaveCount(1);
  await expect(first).toContainText("werk v0");
  await expect(first.locator("code")).toHaveText("werk");
  await p.locator('[role="option"][data-id="werk-stale"] [data-role="dot"]').scrollIntoViewIfNeeded().catch(() => undefined);
  const stale = p.locator('[role="option"][data-id="werk-stale"] [data-role="dot"]');
  await expect(stale).toHaveCount(1);
  expect(await stale.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  const wt = await crumbs(p).locator('[aria-current="page"]').evaluate((e) => Number(getComputedStyle(e).fontWeight));
  expect(wt).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 home shows requirements and build rules side by side", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "pay", kind: "card", title: "Pay online", parent: "root", status: "decided", who: "me" });
  w.seed("node.added", { id: "how", kind: "card", title: "Build rules", status: "decided", who: "me", why: "How we build" });
  w.seed("node.added", { id: "tests", kind: "card", title: "Tests on Bun", parent: "how", status: "decided", who: "me" });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect.poll(async () => (await how.boundingBox())?.x ?? 0).toBeGreaterThan(100);
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(what.locator('[data-role="rollup"]')).toContainText("cards");
  await expect(how.locator('[data-role="rollup"]')).toContainText("2 cards");
});

test("17.5b no #how card shows an empty build-rules card", async ({ page: p }) => {
  const w = await project();
  card(w, "pay", "root");
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toBeVisible();
  console.log("HOW:", await how.innerText());
});
