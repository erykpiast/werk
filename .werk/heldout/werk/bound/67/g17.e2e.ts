// Held-out steps 17.1-17.5: the header, the search box, the tabs and the home view.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const card = (w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });
const bold = async (l: import("@playwright/test").Locator) =>
  Number(await l.evaluate((el) => getComputedStyle(el).fontWeight)) >= 600;

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const pane = await p.locator("#header").evaluate((el) => el.getBoundingClientRect().width);
  expect(pane).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).first().click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  const texts = (await line.innerText()).split("\n").join(" ");
  expect(texts).toMatch(/…\s*›\s*Card c\s*›\s*Card d/);
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(await bold(current)).toBe(true);
  const box = await line.boundingBox();
  const seg = await current.boundingBox();
  expect(box?.height ?? 99).toBeLessThan((seg?.height ?? 0) * 1.5);

  await line.hover();
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
  await line.getByText("Card c", { exact: true }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(line.locator('[aria-current="page"]')).toHaveText("Card c");
  expect(await bold(line.locator('[aria-current="page"]'))).toBe(true);
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "o", "root", { status: "open" });
    card(d, "o1", "o", { status: "open" });
    card(d, "o2", "o");
    card(d, "pr", "root", { status: "proto" });
    card(d, "base", "root");
    card(d, "s", "root");
    d.seed("edge.added", { from: "s", to: "base", type: "depends_on", why: "It reads base" });
    d.seed("node.reopened", { id: "base", reason: "rejected", why: "Wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const total = Number(await count(p, "total").textContent());
  expect(total).toBe(7);
  let sum = 0;
  for (const s of ["open", "proto", "decided"]) {
    const at = count(p, s);
    if ((await at.count()) === 0) continue;
    const n = Number(await at.textContent());
    expect(n).toBeGreaterThan(0);
    await expect(at).toHaveAttribute("title", new RegExp(s));
    sum += n;
  }
  expect(sum).toBe(total);

  await p.locator('a[data-tile="o"]').click();
  await expect(heading(p)).toHaveText("Card o");
  await expect(count(p, "total")).toHaveText("3");
  await expect(count(p, "open")).toHaveText("2");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "Werk itself" });
    for (let i = 0; i < 8; i++) card(d, `werk-s${i}`, "root", { title: `Starts ${i}` });
    for (let i = 0; i < 8; i++) card(d, `x-werk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-s0", to: "werk", type: "depends_on", why: "It reads werk" });
    d.seed("node.reopened", { id: "werk", reason: "rejected", why: "Wrong" });
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
  if (firstContains !== -1) expect(lastStarts).toBeLessThan(firstContains);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row.locator("code")).toHaveText((await row.getAttribute("data-id")) ?? "");
  }
  await expect(rows.first()).toContainText("Werk itself");
  const dot = p.locator('[role="option"][data-id="werk-s0"] [data-role="dot"]');
  const bg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg);
  expect(m !== null && Number(m[1]) > 180 && Number(m[2]) < 100).toBe(true);

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("Werk itself");
  expect(await bold(current)).toBe(true);
  await expect(search(p)).toHaveValue("");
});

test("17.4 a person switches between the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "inv", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/inv`);
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
  const w = await project(undefined, (d) => {
    card(d, "pay", "root", { title: "Customers pay" });
    card(d, "ship", "root", { title: "Orders ship" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided" });
    card(d, "bun", "how", { title: "Tests run on Bun" });
    card(d, "lint", "how", { title: "Lint with Biome" });
    d.werk("propose", "root", "--why", "What we sell");
    d.werk("accept", "root", "--actor", "you");
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const a = await what.boundingBox();
  const b = await how.boundingBox();
  expect(Math.abs((a?.width ?? 0) - (b?.width ?? 1))).toBeLessThan(2);
  expect(a?.y).toBe(b?.y);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("What we sell");
  await expect(what.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(what.locator('a[data-tile="ship"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How we build");
  await expect(how.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(how.locator('a[data-tile="bun"]')).toBeVisible();
  await expect(how.locator('a[data-tile="lint"]')).toBeVisible();
  stop();

  const empty = await project();
  await p.goto(`${empty.url}/`);
  await expect(p.locator('[data-column="how"] article[data-empty="true"]')).toBeVisible();
  await expect(p.locator('[data-column="how"]')).toContainText("Build rules");
});
