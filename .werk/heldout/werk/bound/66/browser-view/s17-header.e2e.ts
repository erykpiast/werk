// Held-out steps 17.1–17.5: breadcrumbs, header counts, the search box, the tabs and the home view.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../../e2e/project.ts";
import { card, heading, isRed, style } from "./helpers.ts";

test.afterEach(stop);

const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page: p }) => {
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", { title: "Level one" });
    card(d, "b", { title: "Level two", parent: "a" });
    card(d, "c", { title: "Level three", parent: "b" });
    card(d, "e", { title: "Level four", parent: "c" });
  });
  await p.goto(`${w.url}/`);
  const left = await p.locator("#header").boundingBox();
  expect(left?.width ?? 1000).toBeLessThan(700);
  await p.locator('[data-column="what"] a[data-tile="a"]').click();
  await expect(heading(p)).toHaveText("Level one");
  for (const [id, title] of [["b", "Level two"], ["c", "Level three"], ["e", "Level four"]] as const) {
    await p.locator(`a[data-tile="${id}"]`).click();
    await expect(heading(p)).toHaveText(title);
  }
  // one line, … then parent then the open card in bold
  const line = await crumbs(p).boundingBox();
  const seg = await crumbs(p).locator('[aria-current="page"]').boundingBox();
  expect(line?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);
  const text = (await crumbs(p).innerText()).replace(/\s+/g, " ").trim();
  expect(text).toMatch(/^… › Level three › Level four$/);
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("Level four");
  expect(Number(await style(current, "font-weight"))).toBeGreaterThanOrEqual(600);
  // hover shows the full path
  await crumbs(p).hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual([
    "Home",
    "Root",
    "Level one",
    "Level two",
    "Level three",
    "Level four",
  ]);
  // click the parent card in the path
  await crumbs(p).getByRole("button", { name: "Level three" }).click();
  await expect(heading(p)).toHaveText("Level three");
  const now = crumbs(p).locator('[aria-current="page"]');
  await expect(now).toHaveText("Level three");
  expect(Number(await style(now, "font-weight"))).toBeGreaterThanOrEqual(600);
  expect((await crumbs(p).innerText()).trim().endsWith("Level three")).toBe(true);
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "o", { title: "Open child", status: "open" });
    card(d, "o1", { title: "Open grandchild", status: "open", parent: "o" });
    card(d, "pr", { title: "Proto child", status: "proto" });
    card(d, "base", { title: "Base", status: "decided", who: "me" });
    card(d, "dd", { title: "Decided child", status: "decided", who: "me" });
    d.seed("edge.added", { from: "dd", to: "base", type: "depends_on", why: "It needs base" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "Base changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toHaveText("6");
  await expect(count(p, "stale")).toHaveCount(1);
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    await expect(count(p, name)).toHaveCount(1);
    sum += Number(await count(p, name).innerText());
  }
  expect(sum).toBe(6);
  for (const name of ["open", "proto", "decided"]) {
    await count(p, name).hover();
    expect(await count(p, name).getAttribute("title")).toContain(name);
  }
  // open a child with a smaller subtree
  await p.locator('a[data-tile="o"]').click();
  await expect(heading(p)).toHaveText("Open child");
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "open")).toHaveText("2");
  await expect(count(p, "proto")).toHaveCount(0);
  await expect(count(p, "decided")).toHaveCount(0);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", { title: "Werk itself", status: "decided", who: "me" });
    for (let i = 1; i <= 9; i++) card(d, `werk-s${i}`, { title: `Starts ${i}` });
    for (let i = 1; i <= 4; i++) card(d, `x${i}-werk`, { title: `Contains ${i}`, status: "decided", who: "me" });
    // make x1-werk stale: it depends on werk, then werk is reopened
    d.seed("edge.added", { from: "x1-werk", to: "werk", type: "depends_on", why: "It reads werk" });
    d.seed("node.reopened", { id: "werk", reason: "invalidated", why: "Scope changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  expect(firstContains === -1 || lastStarts < firstContains).toBe(true);
  // each row: dot, title, id
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(ids[i] as string);
  }
  await expect(rows.first()).toContainText("Werk itself");
  // the stale row has a red dot (x1-werk must be in the list for this)
  expect(ids).toContain("x1-werk");
  const dot = p.locator('[role="option"][data-id="x1-werk"] [data-role="dot"]');
  expect(isRed(await style(dot, "background-color"))).toBe(true);
  // down then up
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("Werk itself");
  expect(Number(await style(current, "font-weight"))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 a person switches between the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(heading(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await tab("Map").click();
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 the first screen shows the requirements and the build rules side by side", async ({ page: p }) => {
  let w = await project(undefined, (d) => {
    d.seed("node.bodyEdited", { id: "root", why: "Why the root holds" });
    card(d, "pay", { title: "Customers pay online" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "Why the rules hold" });
    card(d, "tests", { title: "Tests run on Bun", parent: "how" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const a = await what.boundingBox();
  const b = await how.boundingBox();
  expect(a?.y).toBe(b?.y);
  expect(Math.abs((a?.width ?? 0) - (b?.width ?? 1))).toBeLessThan(2);
  await expect(what).toContainText("Root");
  await expect(what).toContainText("Why the root holds");
  await expect(what.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how).toContainText("Build rules");
  await expect(how).toContainText("Why the rules hold");
  await expect(how.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  // no #how card
  stop();
  w = await project();
  await p.goto(`${w.url}/`);
  await expect(p.locator('[data-column="how"] [data-empty="true"]')).toBeVisible();
});
