// Held-out binding of steps 17.1-17.5: breadcrumbs, header counts, id search, tabs and the home view.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const counts = (p: Page) => p.locator("#header [data-count]");
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1 a deep card shows a cut path and the breadcrumbs lead back", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (down) => {
    card(down, "a", "root");
    card(down, "b", "a");
    card(down, "c", "b");
    card(down, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const pane = await p.locator("#header").boundingBox();
  expect(pane?.width ?? 9999).toBeLessThan(700);
  await p.locator('a[data-tile="a"]').click();
  await p.locator('a[data-tile="b"]').click();
  await p.locator('a[data-tile="c"]').click();
  await p.locator('a[data-tile="d"]').click();
  await expect(heading(p)).toHaveText("Card d");

  const parts = await crumbs(p).locator(":scope > *").allTextContents();
  expect(parts).toEqual(["…", "›", "Card c", "›", "Card d"]);
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("Card d");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const line = await crumbs(p).boundingBox();
  const seg = await last.boundingBox();
  expect(line?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

  await crumbs(p).hover();
  const full = p.locator('[data-role="crumbs-full"]');
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);

  await p.mouse.move(0, 700);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "a", "root", { status: "open" });
    card(down, "a1", "a");
    card(down, "b", "root", { status: "proto" });
    card(down, "c", "root");
    card(down, "d", "root");
    down.seed("edge.added", { from: "c", to: "d", type: "depends_on", why: "c reads d" });
    down.seed("node.reopened", { id: "d", reason: "rejected", why: "d was wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await expect(count(p, "total")).toBeVisible();
  const read = async () => {
    const out: Record<string, number> = {};
    for (const el of await counts(p).all()) {
      out[(await el.getAttribute("data-count")) ?? ""] = Number(await el.locator('[data-role="value"]').textContent());
    }
    return out;
  };
  const root = await read();
  expect(root.total).toBeGreaterThan(0);
  expect((root.open ?? 0) + (root.proto ?? 0) + (root.decided ?? 0)).toBe(root.total);
  for (const [name, value] of Object.entries(root)) expect(value, `count ${name}`).toBeGreaterThan(0);
  for (const name of ["open", "proto", "decided"]) {
    if (root[name] === undefined) continue;
    const at = count(p, name);
    await at.hover();
    expect(await at.getAttribute("title")).toContain(name);
  }

  await p.locator('a[data-tile="a"]').click();
  await expect(heading(p)).toHaveText("Card a");
  await expect(count(p, "total")).toHaveText("2");
  const sub = await read();
  expect(sub).toEqual({ total: 2, open: 1, decided: 1 });
});

test("17.3 a # search lists matches and Enter opens the card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "werk", "root", { title: "werk itself" });
    for (const s of ["a", "b", "c", "d", "e"]) card(down, `werk-${s}`, "root", { title: `Starts ${s}` });
    for (const s of ["a", "b", "c", "d", "e", "f", "g"]) card(down, `${s}-werk`, "root", { title: `Contains ${s}` });
    card(down, "base", "root", { title: "Base" });
    down.seed("edge.added", { from: "werk-b", to: "base", type: "depends_on", why: "It reads base" });
    down.seed("node.reopened", { id: "base", reason: "rejected", why: "Base was wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  expect(firstContains === -1 || lastStarts < firstContains).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row).toContainText(id);
  }
  await expect(p.locator('[role="option"][data-id="werk"]')).toContainText("werk itself");
  const red = await p
    .locator('[role="option"][data-id="werk-b"] [data-role="dot"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = /rgb\((\d+), (\d+), (\d+)/.exec(red);
  expect(Number(m?.[1])).toBeGreaterThan(150);
  expect(Number(m?.[2])).toBeLessThan(100);

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("werk itself");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 the Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  await expect(heading(p)).toHaveText("The invoice");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  const board = p.locator("[data-view='board'], [data-board], #board");
  await expect(board.first()).toBeVisible();
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(board.first()).toBeVisible();
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 the home view shows root and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.bodyEdited", { id: "root", why: "Root why" });
    card(down, "pay", "root", { title: "Customers pay online" });
    down.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How why", status: "decided", who: "me" });
    card(down, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toContainText("Root why");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toContainText("How why");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  for (const col of [what, how]) await expect(col.locator('[data-card] [data-role*="rollup"], [data-card] [data-role*="count"]').first()).toBeVisible();
});

test("17.5 without #how the right column shows an empty build-rules card", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "pay", "root"));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how.locator('[data-empty="true"]')).toBeVisible();
  await expect(how).toContainText("Build rules");
});
