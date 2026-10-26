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

test("17.1 deep card breadcrumbs", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "deep", "c");
  });
  await p.goto(`${w.url}/`);
  const left = await p.locator("#header").boundingBox();
  expect(left?.width ?? 0).toBeLessThan(700);
  await p.locator('a[data-tile="root"], [data-card="root"] a').first().click();
  for (const id of ["a", "b", "c", "deep"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("Card deep");
  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  await expect(line).toHaveText(/^…\s*›\s*Card c\s*›\s*Card deep$/);
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card deep");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const lb = await line.boundingBox();
  const sb = await current.boundingBox();
  expect(lb?.height ?? 0).toBeLessThan((sb?.height ?? 0) * 1.5);
  await line.hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual([
    "Home",
    "Root",
    "Card a",
    "Card b",
    "Card c",
    "Card deep",
  ]);
  await line.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root", { status: "open" });
    card(d, "s", "root");
    card(d, "t", "root");
    d.seed("edge.added", { from: "t", to: "s", type: "depends_on", why: "needs s" });
    d.seed("node.reopened", { id: "s", reason: "rejected", why: "wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  const total = Number(await count(p, "total").textContent());
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) === 0) continue;
    const n = Number(await at.textContent());
    expect(n).toBeGreaterThan(0);
    expect(await at.getAttribute("title")).toContain(name);
    sum += n;
  }
  expect(sum).toBe(total);
  await expect(count(p, "stale")).toHaveCount(1);
  expect(await count(p, "stale").getAttribute("title")).toContain("stale");
  await p.locator('a[data-tile="a"]').click();
  await expect(heading(p)).toHaveText("Card a");
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "stale")).toHaveCount(0);
});

test("17.3 find a card by id in the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 0; i < 8; i++) card(d, `werk-${i}`, "root", { title: `Starts ${i}` });
    for (let i = 0; i < 8; i++) card(d, `x-werk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-3", to: "werk-0", type: "depends_on", why: "uses it" });
    d.seed("node.reopened", { id: "werk-0", reason: "rejected", why: "wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toHaveAttribute("data-id", "werk");
  expect(await rows.count()).toBeLessThanOrEqual(12);
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContains >= 0) expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row).toContainText(id);
  }
  await expect(rows.first()).toContainText("werk v0");
  // werk-3 depends on rejected werk-0, so werk-3 is stale.
  const stale = p.locator('[role="option"][data-id="werk-3"] [data-role="dot"]');
  if ((await stale.count()) > 0) {
    expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  } else {
    throw new Error(`stale row werk-3 not in list: ${ids.join(",")}`);
  }
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk v0");
  await expect(search(p)).toHaveValue("");
});

test("17.4 switch between Map and Board tabs", async ({ page: p }) => {
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
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 home shows requirements and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "pay", "root", { title: "Customers pay" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How why", status: "decided" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
    card(d, "lint", "how", { title: "Lint" });
  });
  w.werk("propose", "root", "--why", "Root why");
  w.werk("accept", "root", "--actor", "you");
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how).toContainText("How why");
  await expect(what).toContainText("Root why");
  await expect(how.locator('[data-role="rollup"]')).toBeVisible();
  await expect(what.locator('[data-role="rollup"]')).toBeVisible();
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  stop();

  const w2 = await project(undefined, (d) => card(d, "pay", "root"));
  await p.goto(`${w2.url}/`);
  const empty = p.locator('[data-column="how"] [data-empty="true"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Build rules");
});
