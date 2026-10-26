// Held-out steps 17.1–17.5: the header, the search box, the tabs and the home view.
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

test("17.1", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (down) => {
    card(down, "a", "root");
    card(down, "b", "a");
    card(down, "c", "b");
    card(down, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const header = await p.locator("header").first().boundingBox();
  expect(header?.width ?? 0).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) await p.locator(`a[data-tile="${id}"]`).first().click();
  await expect(heading(p)).toHaveText("Card d");
  await expect(crumbs(p).locator('[data-role="cut"]')).toHaveText("…");
  const text = (await crumbs(p).innerText()).replace(/\s+/g, " ").trim();
  expect(text).toMatch(/…\s*›\s*Card c\s*›\s*Card d$/);
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const line = await crumbs(p).boundingBox();
  const seg = await current.boundingBox();
  expect(line?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);
  const full = p.locator('[data-role="crumbs-full"]');
  await crumbs(p).hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual([
    "Home",
    "Root",
    "Card a",
    "Card b",
    "Card c",
    "Card d",
  ]);
  await crumbs(p).getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
});

test("17.2", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "o", "root", { status: "open" });
    card(down, "pr", "root", { status: "proto" });
    card(down, "pr1", "pr");
    card(down, "base", "root");
    card(down, "x", "root");
    down.seed("edge.added", { from: "x", to: "base", type: "depends_on", why: "It reads base" });
    down.seed("node.reopened", { id: "base", reason: "invalidated", why: "The scope changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toBeVisible();
  const sum = async () => {
    let total = 0;
    for (const name of ["open", "proto", "decided"]) {
      const at = count(p, name);
      if ((await at.count()) > 0) total += Number(await at.textContent());
    }
    return total;
  };
  const total = Number(await count(p, "total").textContent());
  expect(total).toBe(6);
  expect(await sum()).toBe(total);
  for (const name of ["open", "proto", "decided"]) {
    await expect(count(p, name)).toHaveCount(1);
    await expect(count(p, name)).toHaveAttribute("title", new RegExp(name));
  }
  await count(p, "open").hover();
  await p.locator('a[data-tile="pr"]').click();
  await expect(heading(p)).toHaveText("Card pr");
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "proto")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "open")).toHaveCount(0);
  expect(await sum()).toBe(2);
});

test("17.3", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 10; i++) card(down, `werk-${i}`, "root", { title: `Starts ${i}` });
    for (let i = 1; i <= 5; i++) card(down, `x-werk-${i}`, "root", { title: `Contains ${i}` });
    card(down, "base", "root");
    down.seed("edge.added", { from: "werk-1", to: "base", type: "depends_on", why: "It reads base" });
    down.seed("node.reopened", { id: "base", reason: "invalidated", why: "The scope changed" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(12);
  expect(n).toBeGreaterThan(0);
  const ids = await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-id") ?? ""));
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContains >= 0) expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    const id = (await row.getAttribute("data-id")) ?? "";
    await expect(row).toContainText(id);
  }
  await expect(rows.first()).toContainText("werk v0");
  const stale = p.locator('[role="option"][data-id="werk-1"] [data-role="dot"]');
  await expect(stale).toHaveCount(1);
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  const current = crumbs(p).locator('[aria-current="page"]');
  await expect(current).toHaveText("werk v0");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "invoice", "root", { title: "The invoice" }));
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
  let w = await project(undefined, (down) => {
    card(down, "pay", "root", { title: "Customers pay online" });
    down.seed("node.added", {
      id: "how",
      kind: "card",
      title: "Build rules",
      why: "How we build it",
      status: "decided",
      who: "me",
    });
    card(down, "tests", "how", { title: "Tests run on Bun" });
    down.werk("propose", "root", "--why", "What we build");
    down.werk("accept", "root", "--actor", "you");
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  const left = await what.boundingBox();
  const right = await how.boundingBox();
  expect(Math.abs((left?.width ?? 0) - (right?.width ?? 0))).toBeLessThan(2);
  expect(left?.y).toBe(right?.y);
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(what.locator('[data-field="why"]')).toHaveText("What we build");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(what.locator("[data-count]").first()).toBeVisible();
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(how.locator('[data-field="why"]')).toHaveText("How we build it");
  await expect(how.locator("[data-count]").first()).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  stop();
  w = await project();
  await p.goto(`${w.url}/`);
  await expect(p.locator('[data-column="how"] [data-empty="true"]')).toBeVisible();
});
