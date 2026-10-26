// Held-out steps 17.1–17.5: header, breadcrumbs, counts, search box, tabs, home.
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
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const width = await p.locator("header").first().evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(700);
  await p.locator('[data-column="what"] a[data-tile="a"]').click();
  await expect(heading(p)).toHaveText("Card a");
  for (const id of ["b", "c", "d"]) {
    await p.locator(`a[data-tile="${id}"]`).click();
    await expect(heading(p)).toHaveText(`Card ${id}`);
  }
  const line = crumbs(p);
  const parts = await line.evaluate((el) =>
    Array.from(el.children).map((c) => ({ text: c.textContent, current: c.getAttribute("aria-current") })),
  );
  expect(parts.map((x) => x.text)).toEqual(["…", "›", "Card c", "›", "Card d"]);
  expect(parts[4]?.current).toBe("page");
  const fw = await line.locator('[aria-current="page"]').evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(fw).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await line.locator('[aria-current="page"]').boundingBox();
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
  await line.locator('[data-crumb="c"]').click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(line.locator('[aria-current="page"]')).toHaveText("Card c");
  expect((await line.locator("[data-crumb]").allTextContents()).at(-1)).toBe("Card c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "o", "root", { status: "open" });
    card(d, "pr", "root", { status: "proto" });
    card(d, "pr1", "pr", { status: "open" });
    card(d, "x", "root");
    card(d, "s", "root");
    d.seed("edge.added", { from: "s", to: "x", type: "depends_on", why: "s needs x" });
    d.seed("node.reopened", { id: "x", reason: "invalidated", why: "x changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await expect(count(p, "stale")).toHaveCount(1);
  const total = Number(await count(p, "total").locator('[data-role="value"]').textContent());
  let sum = 0;
  for (const name of ["open", "proto", "decided"]) {
    const at = count(p, name);
    if ((await at.count()) > 0) {
      const v = Number(await at.locator('[data-role="value"]').textContent());
      expect(v).toBeGreaterThan(0);
      sum += v;
      await at.hover();
      await expect(at).toHaveAttribute("title", new RegExp(name));
    }
  }
  expect(await count(p, "open").count()).toBe(1);
  expect(await count(p, "proto").count()).toBe(1);
  expect(await count(p, "decided").count()).toBe(1);
  expect(sum).toBe(total);
  expect(total).toBe(6);

  await p.locator('a[data-tile="pr"]').click();
  await expect(heading(p)).toHaveText("Card pr");
  await expect(count(p, "total").locator('[data-role="value"]')).toHaveText("2");
  await expect(count(p, "open").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "proto").locator('[data-role="value"]')).toHaveText("1");
  await expect(count(p, "decided")).toHaveCount(0);
  await expect(count(p, "stale")).toHaveCount(0);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk itself" });
    for (let i = 1; i <= 8; i++) card(d, `werk-s${i}`, "root", { title: `Starts ${i}` });
    for (let i = 1; i <= 8; i++) card(d, `c${i}-werk`, "root", { title: `Contains ${i}` });
    card(d, "base", "root", { title: "Base" });
    d.seed("edge.added", { from: "werk-s1", to: "base", type: "depends_on", why: "needs base" });
    d.seed("node.reopened", { id: "base", reason: "invalidated", why: "base changed" });
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
  if (firstContain >= 0) expect(lastStart).toBeLessThan(firstContain);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row).toContainText(id);
  }
  await expect(rows.first()).toContainText("werk itself");
  const staleDot = p.locator('[role="option"][data-id="werk-s1"] [data-role="dot"]');
  await expect(staleDot).toHaveCount(1);
  expect(await staleDot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");

  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("werk itself");
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
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("17.5", async ({ page: p }) => {
  let w = await project(undefined, (d) => {
    d.seed("node.bodyEdited", { id: "root", why: "What we make" });
    card(d, "pay", "root", { title: "Customers pay" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", why: "How we build", status: "decided", who: "me" });
    card(d, "tests", "how", { title: "Tests on Bun" });
    card(d, "lint", "how", { title: "Lint with Biome" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
  await expect(what.locator("h2").first()).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("What we make");
  await expect(what.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator("h2").first()).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How we build");
  await expect(how.locator('[data-role="rollup"]')).toContainText("3 cards");
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  await expect(how.locator('a[data-tile="lint"]')).toBeVisible();
  stop();
  w = await project(undefined, (d) => card(d, "pay", "root"));
  await p.goto(`${w.url}/`);
  const empty = p.locator('[data-column="how"] article');
  await expect(empty).toHaveAttribute("data-empty", "true");
  await expect(empty.locator("h2")).toHaveText("Build rules");
});
