import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  // open the deep card from the map by following the tiles
  for (const id of ["a", "b", "c", "d"]) {
    await p.locator(`a[data-tile="${id}"]`).first().click();
    await expect(p).toHaveURL(new RegExp(`/map/${id}$`));
  }
  await expect(heading(p)).toHaveText("Card d");
  const box = await p.locator('[data-role="crumbs"]').boundingBox();
  expect(box?.width ?? 0).toBeLessThan(700);
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card d");
  expect(await crumbs(p).locator('[aria-current="page"]').evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const text = (await crumbs(p).innerText()).replace(/\s+/g, " ");
  expect(text).toContain("›");
  expect(text.indexOf("…")).toBeLessThan(text.indexOf("Card c"));
  expect(text.indexOf("Card c")).toBeLessThan(text.indexOf("Card d"));
  const full = p.locator('[data-role="crumbs-full"]');
  await crumbs(p).hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await p.mouse.move(0, 0);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root", { status: "open" });
    card(d, "base", "root");
    card(d, "z", "root", { status: "open" });
    card(d, "z1", "z", { status: "open" });
    card(d, "old", "root", { status: "decided" });
    d.seed("edge.added", { from: "old", to: "base", type: "depends_on", why: "needs it" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toHaveText("9");
  let sum = 0;
  for (const n of ["open", "proto", "decided"]) {
    const at = count(p, n);
    if ((await at.count()) > 0) sum += Number(await at.textContent());
  }
  expect(sum).toBe(9);
  await expect(count(p, "open")).toHaveAttribute("title", /open/);
  await expect(count(p, "proto")).toHaveAttribute("title", /proto/);
  await expect(count(p, "decided")).toHaveAttribute("title", /decided/);
  // a status with zero cards shows no count
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "total")).not.toHaveText("9");
  await p.goto(`${w.url}/map/z`);
  await expect(count(p, "open")).toHaveText("2");
  await expect(count(p, "proto")).toHaveCount(0);
  await expect(count(p, "decided")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 0; i < 8; i++) card(d, `pre-werk-${i}`, "root", { title: `Contains ${i}` });
    for (let i = 0; i < 5; i++) card(d, `werk-${i}`, "werk", { title: `Starts ${i}` });
    d.seed("edge.added", { from: "werk-0", to: "pre-werk-0", type: "depends_on", why: "x" });
    d.seed("node.reopened", { id: "pre-werk-0", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
  expect(ids.slice(firstContains).every((i) => !i.startsWith("werk"))).toBe(true);
  expect(ids.slice(0, firstContains).every((i) => i.startsWith("werk"))).toBe(true);
  await expect(rows.first().locator('[data-role="dot"]')).toHaveCount(1);
  await expect(rows.first()).toContainText("werk v0");
  await expect(rows.first().locator("code")).toHaveText("werk");
  // stale card: werk-0 depends on reopened pre-werk-0
  await search(p).fill("#werk-0");
  const dot = p.locator('[role="option"][data-id="werk-0"] [data-role="dot"]');
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).fill("#werk");
  await expect(rows).toHaveCount(12);
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
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

test("17.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", "root", { title: "Customers pay online" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  await expect(what.locator("[data-role=rollup]")).toHaveCount(1);
  await expect(how.locator("[data-role=rollup]")).toHaveCount(1);
});

test("17.5 no how card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.locator("[data-tile]")).toHaveCount(0);
  console.log("HOWTEXT:", await how.innerText());
});
