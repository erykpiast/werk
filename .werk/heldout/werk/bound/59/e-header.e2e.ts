// Held-out steps 17.1 - 17.5: the header and the home view.
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
  await p.setViewportSize({ width: 900, height: 800 });
  const w = await project(undefined, (down) => {
    card(down, "a", "root");
    card(down, "b", "a");
    card(down, "c", "b");
    card(down, "d", "c");
  });
  await p.goto(`${w.url}/`);
  // Left pane narrower than 700px.
  const pane = await p.locator("#header").boundingBox();
  expect(pane?.width ?? 0).toBeLessThan(700);
  await p.locator('[data-column="what"] a[data-tile="a"]').click();
  for (const id of ["b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  const texts = (await line.innerText()).split(/\s*›\s*/).map((s) => s.trim());
  expect(texts).toEqual(["…", "Card c", "Card d"]);
  const bold = await line.locator('[aria-current="page"]').evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(bold).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await line.locator('[aria-current="page"]').boundingBox();
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
  await line.locator('button[data-crumb="c"]').click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(line.locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "x", "root", { title: "Basis" });
    card(down, "o", "root", { status: "open" });
    card(down, "pr", "root", { status: "proto" });
    card(down, "dd", "root");
    card(down, "s", "root");
    card(down, "s1", "s", { status: "open" });
    down.seed("edge.added", { from: "s", to: "x", type: "depends_on", why: "It reads the basis" });
    down.seed("node.reopened", { id: "x", reason: "invalidated", why: "The basis changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const total = Number(await count(p, "total").locator('[data-role="value"]').textContent());
  expect(total).toBe(7);
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    await expect(at).toHaveCount(1);
    const n = Number(await at.locator('[data-role="value"]').textContent());
    expect(n).toBe(12);
    sum += n;
    await at.hover();
    expect(await at.getAttribute("title")).toContain(name);
  }
  expect(sum).toBe(total);
  await expect(count(p, "stale")).toHaveCount(1);
  expect(await count(p, "stale").getAttribute("title")).toContain("stale");

  await p.locator('a[data-tile="s"]').click();
  await expect(heading(p)).toHaveText("Card s");
  await expect(count(p, "total").locator('[data-role="value"]')).toHaveText("2");
  await expect(count(p, "open").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "decided").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3 search box by id", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "vi-werk", "root", { title: "Notes on werk" });
    card(down, "my-werk-notes", "root", { title: "My notes" });
    card(down, "our-werk", "root", { title: "Our werk" });
    card(down, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 9; i++) card(down, `werk-${String(i).padStart(2, "0")}`, "werk", { title: `Part ${i}` });
    card(down, "basis", "root", { title: "Basis" });
    down.seed("edge.added", { from: "werk-01", to: "basis", type: "depends_on", why: "It reads the basis" });
    down.seed("node.reopened", { id: "basis", reason: "invalidated", why: "The basis changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toHaveAttribute("data-id", "werk");
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBeGreaterThan(0);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  expect(firstContain).toBe(10);
  expect(ids.slice(firstContain).every((id) => !id.startsWith("werk"))).toBe(true);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(ids[i] ?? "");
  }
  await expect(rows.first()).toContainText("werk v0");
  const stale = p.locator('[role="option"][data-id="werk-01"] [data-role="dot"]');
  await expect(stale).toHaveCount(1);
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("werk v0");
  expect(await last.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "invoice", "root", { title: "The invoice" }));
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
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5 home shows requirements and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.retitled", { id: "root", title: "Root" });
    card(down, "pay", "root", { title: "Customers pay online" });
    down.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "How it is built",
      status: "decided",
      who: "me",
    });
    card(down, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How it is built");
  await expect(what.locator('[data-role="rollup"]')).toBeVisible();
  await expect(how.locator('[data-role="rollup"]')).toBeVisible();
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const left = await what.boundingBox();
  const right = await how.boundingBox();
  expect(left?.y).toBe(right?.y);
  expect(Math.abs((left?.width ?? 0) - (right?.width ?? 0))).toBeLessThan(2);
});

test("17.5 home with no #how shows an empty build-rules card", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how.locator('article[data-empty="true"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
});
