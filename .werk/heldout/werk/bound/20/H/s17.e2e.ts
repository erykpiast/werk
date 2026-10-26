// Held-out steps 17.1-17.5: breadcrumbs, header counts, the search box, the tabs and the home view.
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, parent: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...fields });
}

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("17.1", async ({ page: p }) => {
  await p.setViewportSize({ width: 900, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const header = await p.locator("header").first().boundingBox();
  expect(header?.width ?? 9999).toBeLessThan(700);
  await p.locator('a[data-tile="a"]').click();
  await p.locator('a[data-tile="b"]').click();
  await p.locator('a[data-tile="c"]').click();
  await p.locator('a[data-tile="d"]').click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  const text = (await line.innerText()).replace(/\s+/g, "");
  expect(text).toBe("…›Cardc›Cardd");
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await current.boundingBox();
  expect(box?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

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

  await line.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("Card c");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "o", "root", { status: "open" });
    card(d, "o2", "o", { status: "open" });
    card(d, "pr", "root", { status: "proto" });
    card(d, "d1", "root");
    card(d, "d2", "root");
    d.seed("edge.added", { from: "d2", to: "d1", type: "depends_on", why: "It reads d1" });
    d.seed("node.reopened", { id: "d1", reason: "rejected", why: "Wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toBeVisible();
  const total = Number(await count(p, "total").locator('[data-role="value"]').textContent());
  expect(total).toBe(6);
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) > 0) sum += Number(await at.textContent());
  }
  expect(sum).toBe(total);
  for (const name of ["open", "proto", "decided"]) await expect(count(p, name)).toHaveCount(1);
  await expect(count(p, "stale")).toHaveCount(1);
  for (const shown of await p.locator("#header [data-count]").all()) {
    expect(Number(await shown.textContent())).toBeGreaterThan(0);
  }
  await expect(count(p, "paused")).toHaveCount(0);
  for (const name of ["open", "proto", "decided", "stale"]) {
    await count(p, name).hover();
    await expect(count(p, name)).toHaveAttribute("title", new RegExp(name));
  }

  await p.locator('a[data-tile="o"]').click();
  await expect(heading(p)).toHaveText("Card o");
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "open")).toHaveText("2");
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk itself" });
    for (const s of "abcdefghij") card(d, `werk-${s}`, "root", { title: `Werk part ${s}` });
    for (const id of ["vi-werk", "x-werk", "y-werk"]) card(d, id, "root");
    d.seed("edge.added", { from: "werk-a", to: "werk-b", type: "depends_on", why: "It reads b" });
    d.seed("node.reopened", { id: "werk-b", reason: "rejected", why: "Wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id") ?? ""));
  expect(ids.length).toBeLessThanOrEqual(12);
  expect(ids[0]).toBe("werk");
  const lastStart = Math.max(...ids.map((id, i) => (id.startsWith("werk") ? i : -1)));
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContain !== -1) expect(lastStart).toBeLessThan(firstContain);
  for (const row of await rows.all()) {
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row.locator('[data-role="dot"]')).toBeVisible();
    await expect(row).toContainText(id);
    const title = id === "werk" ? "werk itself" : id.startsWith("werk-") ? `Werk part ${id.slice(5)}` : `Card ${id}`;
    await expect(row).toContainText(title);
  }
  const stale = p.locator('[role="option"][data-id="werk-a"] [data-role="dot"]');
  const red = await stale.evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(red);
  expect(m).not.toBeNull();
  if (m) {
    expect(Number(m[1])).toBeGreaterThan(150);
    expect(Number(m[2])).toBeLessThan(100);
    expect(Number(m[3])).toBeLessThan(100);
  }

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(heading(p)).toHaveText("werk itself");
  const last = crumbs(p).locator('[aria-current="page"]');
  await expect(last).toHaveText("werk itself");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
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

test("17.5", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.bodyEdited", { id: "root", why: "Why the root holds" });
    card(d, "pay", "root", { title: "Customers pay online" });
    d.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "Why the rules hold",
      status: "decided",
      who: "me",
    });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("Why the root holds");
  await expect(what.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("Why the rules hold");
  await expect(how.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await stop();

  const bare = await project(undefined, (d) => card(d, "pay", "root"));
  await p.goto(`${bare.url}/`);
  const empty = p.locator('[data-column="how"] article');
  await expect(empty).toHaveAttribute("data-empty", "true");
  await expect(empty).toContainText("Build rules");
});
