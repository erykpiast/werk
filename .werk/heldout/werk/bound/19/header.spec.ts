import { expect, type Page, test } from "@playwright/test";
import { decided, open, reopen, link } from "../src/map/mark-fixtures.ts";
import { served } from "./server.ts";

const ROOT_TITLE = "We build software with agents";
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumbs" });

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page }) => {
  const s = await served();
  try {
    s.append(
      ...open("a", { title: "Level a", parent: "root" }),
      ...open("b", { title: "Level b", parent: "a" }),
      ...open("c", { title: "Level c", parent: "b" }),
      ...open("d", { title: "Level d", parent: "c" }),
    );
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(s.url);
    const pane = page.locator("#left-pane");
    expect((await pane.boundingBox())?.width).toBeLessThan(700);
    // open the deep card from the map: root -> a -> b -> c -> d, one tile at a time
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
      await mapPane(page).locator("a.tile", { hasText: t }).first().click();
      await expect(mapPane(page).getByRole("heading", { level: 1, name: t })).toBeVisible();
    }
    const line = crumbs(page).locator("[data-slot=crumb-line]");
    await expect(line).toContainText("…");
    await expect(line).toContainText("Level c");
    await expect(line).toContainText("›");
    await expect(line.locator("strong")).toHaveText("Level d");
    expect((await line.boundingBox())?.height).toBeLessThan(40);
    await line.hover({ force: true });
    const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"]) await expect(overlay).toContainText(t);
    await overlay.getByRole("button", { name: "Level c" }).click();
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(crumbs(page).locator("[data-slot=crumb-line] strong")).toHaveText("Level c");
  } finally {
    await s.dispose();
  }
});

test("17.2 the header counts follow the open card", async ({ page }) => {
  const s = await served();
  try {
    s.append(
      ...open("c-open", { title: "Open child", parent: "root" }),
      ...open("c-proto", { title: "Proto child", parent: "root", status: "proto" }),
      ...decided("base"),
      ...decided("c-decided", { title: "Decided child" }),
      { type: "edge.added", from: "c-decided", to: "root", link: "refines", why: "" },
      ...open("c-stale", { title: "Stale child", parent: "root" }),
      link("c-stale", "base", "depends_on"),
      reopen("base", { reason: "invalidated" }),
      ...open("g1", { title: "Grand one", parent: "c-open" }),
      ...open("g2", { title: "Grand two", parent: "c-open" }),
    );
    await page.goto(s.url);
    const counts = page.locator("[data-slot=counts] [data-slot=count]");
    await expect(counts.first()).toBeVisible();
    const read = async () =>
      Object.fromEntries(
        await counts.evaluateAll((els) => els.map((el) => [el.getAttribute("data-kind"), { n: Number(el.textContent), title: el.getAttribute("title") ?? "" }])),
      ) as Record<string, { n: number; title: string }>;
    const root = await read();
    expect(root.total).toBeDefined();
    expect(root.open.n + root.proto.n + root.decided.n).toBe(root.total.n);
    for (const kind of ["open", "proto", "decided"]) expect(root[kind]?.title.toLowerCase()).toContain(kind);
    expect(Object.values(root).every((c) => c.n > 0)).toBe(true);
    expect(root.stale?.n).toBe(1);
    await mapPane(page).locator("a.tile", { hasText: "Open child" }).first().click();
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "Open child" })).toBeVisible();
    await expect.poll(async () => (await read()).total?.n).toBe(3);
    const child = await read();
    expect(child.open.n).toBe(3);
    expect(child.total.n).not.toBe(root.total.n);
  } finally {
    await s.dispose();
  }
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page }) => {
  const s = await served();
  try {
    const ghosts: unknown[] = [];
    ghosts.push(...open("werk", { title: "Werk itself", parent: "root" }));
    for (let i = 0; i < 6; i++) ghosts.push(...open(`werk-p${i}`, { title: `Prefix ${i}`, parent: "root" }));
    for (let i = 0; i < 6; i++) ghosts.push(...open(`my-werk-${i}`, { title: `Contains ${i}`, parent: "root" }));
    ghosts.push(...decided("base2"));
    ghosts.push(...open("werk-stale", { title: "Stale one", parent: "root" }), link("werk-stale", "base2", "depends_on"), reopen("base2", { reason: "invalidated" }));
    s.append(...ghosts);
    await page.goto(s.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allInnerTexts();
    const lastPrefix = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
    const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
    expect(firstContains === -1 || lastPrefix < firstContains).toBe(true);
    for (const row of await rows.all()) {
      await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
      await expect(row.locator("code")).not.toHaveText("");
    }
    await box.fill("#werk-stale");
    await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    await box.fill("#werk");
    await box.press("ArrowDown");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(crumbs(page).locator("[data-slot=crumb-line] strong")).toHaveText("Werk itself");
    await expect(box).toHaveValue("");
  } finally {
    await s.dispose();
  }
});

test("17.4 a person switches between the Map and Board tabs", async ({ page }) => {
  const s = await served();
  try {
    s.append(...open("deep", { title: "Deep card", parent: "root" }));
    await page.goto(`${s.url}/map/deep`);
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "Deep card" })).toBeVisible();
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.locator("[data-slot=body]")).toContainText("Board");
    await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.locator("[data-slot=body]")).toContainText("Board");
    await views.getByRole("button", { name: "Map" }).click();
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "Deep card" })).toBeVisible();
  } finally {
    await s.dispose();
  }
});
