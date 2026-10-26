import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
const card = (w: Pick<Werk, "seed">, id: string, parent: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...f });
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, n: string) => p.locator(`#header [data-count="${n}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 deep card breadcrumbs", async ({ page: p }) => {
  await p.setViewportSize({ width: 900, height: 700 });
  const w = await project(undefined, (d) => { card(d, "a", "root"); card(d, "b", "a"); card(d, "c", "b"); card(d, "d", "c"); });
  await p.goto(`${w.url}/`);
  await p.locator('[data-column="what"]').getByRole("heading", { level: 2 }).click();
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(h1(p)).toHaveText("Card d");
  const width = (await crumbs(p).evaluate((e) => (e.parentElement ?? e).getBoundingClientRect().width));
  expect(width).toBeLessThan(700);
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  const txt = (await crumbs(p).innerText()).replace(/\s+/g, " ");
  expect(txt).toContain("›");
  expect(txt).toMatch(/…\s*›\s*Card c\s*›\s*Card d/);
  const cur = crumbs(p).locator('[aria-current="page"]');
  await expect(cur).toHaveText("Card d");
  expect(Number(await cur.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  await crumbs(p).hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(h1(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 header counts", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "base", "root");
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "s", "a");
    d.seed("edge.added", { from: "s", to: "base", type: "depends_on", why: "needs base" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  const sum = async () => { let t = 0; for (const n of ["open", "proto", "decided"]) { const l = count(p, n); if (await l.count()) t += Number(await l.textContent()); } return t; };
  const total = Number(await count(p, "total").textContent());
  expect(total).toBe(6);
  expect(await sum()).toBe(total);
  for (const n of ["open", "proto", "decided"]) await expect(count(p, n)).toHaveAttribute("title", new RegExp(n));
  await expect(count(p, "stale")).toHaveCount(1);
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("4");
  expect(await sum()).toBe(4);
  await expect(count(p, "proto")).toHaveCount(1);
});

test("17.3 search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "wbase", "root");
    card(d, "werk", "root", { title: "werk v0" });
    for (const s of ["a", "b", "c", "d"]) card(d, `werk-${s}`, "root");
    card(d, "werk-dep", "root");
    d.seed("edge.added", { from: "werk-dep", to: "wbase", type: "depends_on", why: "needs" });
    d.seed("node.reopened", { id: "wbase", reason: "invalidated", why: "changed" });
    for (let i = 0; i < 9; i++) card(d, `my-werk-${i}`, "root");
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((r) => r.map((x) => x.getAttribute("data-id") as string));
  expect(ids[0]).toBe("werk");
  const firstContain = ids.findIndex((i) => !i.startsWith("werk"));
  expect(firstContain).toBeGreaterThan(0);
  expect(ids.slice(firstContain).every((i) => !i.startsWith("werk") && i.includes("werk"))).toBe(true);
  expect(ids.slice(0, firstContain).every((i) => i.startsWith("werk"))).toBe(true);
  const r0 = rows.first();
  await expect(r0.locator('[data-role="dot"]')).toHaveCount(1);
  await expect(r0).toContainText("werk v0");
  await expect(r0).toContainText("werk");
  const dep = p.locator('[role="option"][data-id="werk-dep"] [data-role="dot"]');
  expect(await dep.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4 map and board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (n: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name: n });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(h1(p)).toHaveText("The invoice");
});

test("17.5 home two columns", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "root2", kind: "card", title: "x", parent: "root" });
    card(d, "pay", "root", { title: "Customers pay online", why: "money" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "how we build", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const a = await what.boundingBox();
  const b = await how.boundingBox();
  expect(a?.y).toBe(b?.y);
  expect(Math.abs((a?.width ?? 0) - (b?.width ?? 0))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("how we build");
  await expect(what.locator("[data-role=counts], [data-count], [data-role=count]").first()).toBeVisible();
  await expect(how.locator("[data-role=counts], [data-count], [data-role=count]").first()).toBeVisible();
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
});

test("17.5b no how card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how.locator('[data-empty="true"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator("[data-tile]")).toHaveCount(0);
});

test("17.2b zero status shows no count", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "x", "root"));
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
});
