import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { isRed } from "./colors.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", "root", { title: "Child" }));
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-such-card-id`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(p.getByRole("heading", { name: "Root" })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child" })).toHaveCount(0);
});

test("17.1 a deep card shows a short path, a hover shows the whole path, and the parent is one click away", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.setViewportSize({ width: 900, height: 700 });
  await p.goto(`${w.url}/`);
  await p.goto(`${w.url}/map/root`);
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("Card d");
  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  const text = (await line.innerText()).replace(/\s+/g, " ");
  expect(text).toMatch(/…\s*›\s*Card c\s*›\s*Card d/);
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(await current.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await line.hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await full.getByRole("button", { name: "Card c" }).click().catch(async () => {
    await line.getByRole("button", { name: "Card c" }).click();
  });
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root", { status: "open" });
    card(d, "b2", "b");
    card(d, "base", "root");
    card(d, "old", "root", { status: "decided" });
    d.seed("edge.added", { from: "old", to: "base", type: "depends_on", why: "needs" });
    d.seed("node.reopened", { id: "base", reason: "rejected", why: "bad" });
  });
  await p.goto(`${w.url}/map/root`);
  const total = Number(await count(p, "total").textContent());
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) > 0) {
      sum += Number(await at.textContent());
      await expect(at).toHaveAttribute("title", new RegExp(name));
    }
  }
  expect(sum).toBe(total);
  await expect(count(p, "stale")).toHaveCount(1);
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("4");
  await expect(count(p, "stale")).toHaveCount(0);
  await p.locator('a[data-tile="b"]').click();
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3 a search finds a card by id and opens it", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 10; i++) card(d, `werk-${i}`, "werk", { title: `Starts ${i}` });
    for (let i = 1; i <= 4; i++) card(d, `pre-werk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-1", to: "pre-werk-1", type: "depends_on", why: "x" });
    d.seed("node.reopened", { id: "pre-werk-1", reason: "rejected", why: "y" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows).toHaveCount(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") as string));
  expect(ids[0]).toBe("werk");
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContain >= 0) for (const id of ids.slice(firstContain)) expect(id.startsWith("werk")).toBe(false);
  await expect(rows.first().locator('[data-role="dot"]')).toBeVisible();
  await expect(rows.first()).toContainText("werk v0");
  await expect(rows.first().locator("code")).toHaveText("werk");
  await search(p).fill("#werk-1");
  const stale = p.locator('[role="option"][data-id="werk-1"] [data-role="dot"]');
  void stale;
  await search(p).fill("#werk");
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.3b the row of a stale card has a red dot", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    card(d, "werk-x", "root", { title: "Stale one" });
    d.seed("edge.added", { from: "werk-x", to: "werk", type: "depends_on", why: "x" });
    d.seed("node.reopened", { id: "werk", reason: "rejected", why: "y" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const dot = p.locator('[role="option"][data-id="werk-x"] [data-role="dot"]');
  expect(isRed(await dot.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(true);
});

test("17.4 the Map and Board tabs", async ({ page: p }) => {
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

test("17.5 the first screen shows the requirements and the build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "root", kind: "card", title: "Root again" }); // ignored duplicate
    card(d, "pay", "root", { title: "Customers pay online", why: "Why pay" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(what.locator("[data-count]").first()).toBeVisible();
  await expect(how.locator("[data-count]").first()).toBeVisible();
});

test("17.5b with no build rules card the right column is an empty card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  await expect(how.locator("[data-tile]")).toHaveCount(0);
});
