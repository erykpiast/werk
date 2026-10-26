/// <reference lib="dom" />
// Held-out: 17.1-17.5 (breadcrumbs, header counts, search box, tabs, home columns).
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

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page: p }) => {
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const left = await p.locator("#view").evaluate((el) => (el.parentElement ?? el).getBoundingClientRect().width);
  expect(left).toBeLessThan(700);
  await p.locator('[data-column="what"] h2').click();
  await expect(heading(p)).toHaveText("Root");
  for (const id of ["a", "b", "c", "d"]) {
    await p.locator(`a[data-tile="${id}"]`).click();
    await expect(heading(p)).toHaveText(`Card ${id}`);
  }
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const text = (await crumbs(p).innerText()).replace(/\s+/g, " ").trim();
  expect(text).toMatch(/…\s*›\s*Card c\s*›\s*Card d$/);
  const line = await crumbs(p).boundingBox();
  const seg = await current.boundingBox();
  expect(line?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

  await crumbs(p).hover();
  const full = p.locator('[data-role="crumbs-full"]');
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
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "op", "root", { status: "open" });
    card(d, "pr", "root", { status: "proto" });
    card(d, "de", "root");
    card(d, "base", "root");
    card(d, "de-kid", "de", { status: "open" });
    d.seed("edge.added", { from: "de", to: "base", type: "depends_on", why: "needs base" });
    d.seed("node.reopened", { id: "base", reason: "rejected", why: "wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const total = Number(await count(p, "total").textContent());
  expect(total).toBe(6);
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) > 0) {
      const n = Number(await at.textContent());
      expect(n).toBeGreaterThan(0);
      sum += n;
      await expect(at).toHaveAttribute("title", new RegExp(name));
    }
  }
  expect(sum).toBe(total);
  await p.locator('a[data-tile="de"]').click();
  await expect(heading(p)).toHaveText("Card de");
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "proto")).toHaveCount(0);
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 8; i++) card(d, `werk-s${i}`, "werk", { title: `Starts ${i}` });
    for (let i = 1; i <= 8; i++) card(d, `in-werk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-s1", to: "in-werk-1", type: "depends_on", why: "reads it" });
    d.seed("node.reopened", { id: "in-werk-1", reason: "rejected", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContains >= 0) expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(ids[i] ?? "");
  }
  await expect(rows.first()).toContainText("werk v0");
  // the stale card (werk-s1) must be among the rows to check its dot
  expect(ids).toContain("werk-s1");
  const colour = await p
    .locator('[role="option"][data-id="werk-s1"] [data-role="dot"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(colour).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4 a person switches between the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(heading(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await tab("Map").click();
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 the first screen shows the requirements and the build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
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
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(what.locator('[data-role="rollup"]')).toBeVisible();
  await expect(how.locator('[data-role="rollup"]')).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  expect(l?.y).toBe(r?.y);
  await stop();

  const w2 = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w2.url}/`);
  const how2 = p.locator('[data-column="how"]');
  await expect(how2).toBeVisible();
  await expect(how2.locator("[data-tile]")).toHaveCount(0);
  await expect(how2.locator('article[data-empty="true"]')).toContainText("Build rules");
});
