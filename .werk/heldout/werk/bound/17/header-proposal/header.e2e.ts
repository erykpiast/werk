// Held-out steps 17.1–17.5: the header of the left pane and the home view.
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

test("17.1 a deep card shows a cut path and the overlay, and a parent crumb opens the parent", async ({ page: p }) => {
  await p.setViewportSize({ width: 1100, height: 800 });
  const w = await project(undefined, (down) => {
    card(down, "a", "root");
    card(down, "b", "a");
    card(down, "c", "b");
    card(down, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const pane = await p.locator("#left-pane").boundingBox();
  expect(pane?.width ?? 9999).toBeLessThan(700);
  await p.locator('[data-column="what"] a[data-tile="a"]').click();
  await expect(heading(p)).toHaveText("Card a");
  await p.locator('a[data-tile="b"]').click();
  await expect(heading(p)).toHaveText("Card b");
  await p.locator('a[data-tile="c"]').click();
  await expect(heading(p)).toHaveText("Card c");
  await p.locator('a[data-tile="d"]').click();
  await expect(heading(p)).toHaveText("Card d");

  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  // The visible order of the line: the cut, the parent, the open card.
  const texts = (await line.locator("> span, > button").allTextContents()).map((t) => t.trim());
  expect(texts).toEqual(["…", "›", "Card c", "›", "Card d"]);
  const last = line.locator('[aria-current="page"]');
  await expect(last).toHaveText("Card d");
  expect(Number(await last.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await last.boundingBox();
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
  await line.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2 the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "o", "root", { status: "open" });
    card(down, "pp", "root", { status: "proto" });
    card(down, "d", "root");
    card(down, "dd", "d");
    card(down, "x", "d");
    card(down, "s", "root");
    down.seed("edge.added", { from: "s", to: "dd", type: "depends_on", why: "It reads dd" });
    down.seed("node.reopened", { id: "dd", reason: "invalidated", why: "changed" });
  });
  await p.goto(`${w.url}/map/root`);
  const check = async () => {
    await expect(count(p, "total")).toBeVisible();
    const total = Number(await count(p, "total").locator('[data-role="value"]').textContent());
    let sum = 0;
    for (const name of ["open", "proto", "decided"]) {
      const at = count(p, name);
      if ((await at.count()) === 0) continue;
      const value = Number(await at.locator('[data-role="value"]').textContent());
      expect(value).toBeGreaterThan(0);
      expect((await at.getAttribute("title")) ?? "").toContain(name);
      await at.hover();
      sum += value;
    }
    expect(sum).toBe(total);
    return total;
  };
  const rootTotal = await check();
  expect(rootTotal).toBe(7);
  for (const name of ["open", "proto", "decided"]) await expect(count(p, name)).toHaveCount(1);

  await p.locator('a[data-tile="d"]').click();
  await expect(heading(p)).toHaveText("Card d");
  await expect(count(p, "total").locator('[data-role="value"]')).toHaveText("3");
  expect(await check()).toBe(3);
  await expect(count(p, "proto")).toHaveCount(0);
});

test("17.3 a # search lists at most twelve rows, prefix first, and Enter opens #werk", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", { id: "base", kind: "card", title: "Base", parent: "root", status: "decided", who: "me" });
    card(down, "x-werk-1", "root", { title: "Contains one" });
    card(down, "x-werk-2", "root", { title: "Contains two" });
    card(down, "x-werk-3", "root", { title: "Contains three" });
    card(down, "x-werk-4", "root", { title: "Contains four" });
    card(down, "x-werk-5", "root", { title: "Contains five" });
    for (let i = 1; i <= 8; i++) card(down, `werk-${i}`, "root", { title: `Starts ${i}` });
    card(down, "werk", "root", { title: "werk itself" });
    down.seed("edge.added", { from: "werk-2", to: "base", type: "depends_on", why: "It reads base" });
    down.seed("node.reopened", { id: "base", reason: "invalidated", why: "The scope changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBeGreaterThan(9);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContain = ids.findIndex((id) => !id.startsWith("werk"));
  const lastPrefix = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  expect(firstContain === -1 || lastPrefix < firstContain).toBe(true);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(ids[i] as string);
  }
  await expect(rows.nth(0)).toContainText("werk itself");
  const dot = p.locator('[role="option"][data-id="werk-2"] [data-role="dot"]');
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk itself");
  await expect(search(p)).toHaveValue("");
});

test("17.4 the Board and Map tabs", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/root`);
  await p.locator('a[data-tile="invoice"]').click();
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

test("17.5 the home view shows the root and the build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "pay", "root", { title: "Customers pay online" });
    card(down, "ship", "root", { title: "Orders ship" });
    down.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "How we build",
      status: "decided",
      who: "me",
    });
    card(down, "tests", "how", { title: "Tests run on Bun" });
    card(down, "lint", "how", { title: "Lint with Biome" });
    down.werk("propose", "root", "--why", "What we build");
    down.werk("accept", "root", "--actor", "you");
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(how.getByRole("heading", { level: 2 })).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("What we build");
  await expect(what.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(what.locator('a[data-tile="ship"]')).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How we build");
  await expect(how.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(how.locator('a[data-tile="lint"]')).toBeVisible();
  stop();

  const bare = await project(undefined, (down) => card(down, "pay", "root"));
  await p.goto(`${bare.url}/`);
  const empty = p.locator('[data-column="how"] [data-empty="true"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Build rules");
});
