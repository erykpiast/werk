import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type App, startApp } from "./app.ts";
import { decided, link, open } from "../src/map/mark-fixtures.ts";

const ROOT_TITLE = "We build software with agents";
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const still = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
/** The events that decide the fixture's root card, so cards below it can be decided. */
const decideRoot = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function withApp(
  options: Parameters<typeof startApp>[0],
  body: (app: App) => Promise<void>,
) {
  const app = await startApp(options);
  await app.start();
  try {
    await body(app);
  } finally {
    await app.dispose();
  }
}

test("14.1 a card added from the command line appears with no reload", async ({ page }) => {
  await withApp({}, async (app) => {
    await page.goto(app.url);
    await expect(left(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    await composer(page).fill("half a thought");
    await mark(page);
    const r = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(left(page).getByText("Fresh idea")).toBeVisible();
    expect(await still(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  });
});

test("14.2 a server edit changes a response and the live page stays connected", async ({ page }) => {
  await withApp({ appCopy: true }, async (app) => {
    await page.goto(app.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const pid = app.pid;
    const before = await (await fetch(`${app.origin}/api/projects`)).json();
    expect(before.edited).toBeUndefined();
    const routes = join(app.appDir, "src", "serve", "routes.ts");
    const text = readFileSync(routes, "utf8");
    expect(text).toContain("return json({ projects: entries(ctx.projects) });");
    writeFileSync(
      routes,
      text.replace(
        "return json({ projects: entries(ctx.projects) });",
        "return json({ projects: entries(ctx.projects), edited: true });",
      ),
    );
    await expect
      .poll(async () => (await (await fetch(`${app.origin}/api/projects`)).json()).edited, {
        timeout: 20000,
      })
      .toBe(true);
    expect(app.output()).toMatch(/reusing the live server/);
    expect(app.pid).toBe(pid);
    expect(app.exited()).toBe(false);
    expect(app.output().match(/listening|serving|http:\/\//gi)?.length ?? 0).toBeLessThan(3);
    const r = app.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(left(page).getByText("After edit")).toBeVisible();
    expect(await still(page)).toBe(true);
  });
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  await withApp({ appCopy: true }, async (app) => {
    await page.goto(app.url);
    const title = left(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    await composer(page).fill("draft that must survive");
    await mark(page);
    const entry = join(app.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => still(page), { timeout: 20000 }).toBe(false);
    await expect(left(page).getByRole("heading", { level: 1 })).toHaveText(titleText ?? "");
    await expect(composer(page)).toHaveValue("draft that must survive");
  });
});

const link0 = (id: string, parent: string) => `/map/${id}`;
void link0;

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page }) => {
  await withApp({}, async (app) => {
    for (const [id, parent] of [["a", "root"], ["b", "a"], ["c", "b"], ["d", "c"]] as const) {
      expect(app.werk("add", id, "--title", `Level ${id}`, "--parent", parent).code).toBe(0);
      expect(app.werk("accept", id, "--actor", "you").code).toBe(0);
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(app.url);
    const pane = left(page);
    await expect(pane.getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    expect((await pane.boundingBox())?.width).toBeLessThan(700);
    // open the deep card from the map: follow the tiles down
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
      await pane.locator("a.tile", { hasText: t }).first().click();
      await expect(pane.getByRole("heading", { level: 1, name: t })).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line).toContainText("…");
    await expect(line).toContainText("Level c");
    await expect(line.locator("strong")).toHaveText("Level d");
    await expect(line).toContainText("›");
    expect((await line.boundingBox())?.height).toBeLessThan(40);
    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"])
      await expect(overlay).toContainText(t);
    // The overlay opens on hover and covers the line, so the person clicks the parent where the pointer lands.
    await overlay.getByRole("button", { name: "Level c" }).click();
    await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(line.locator("strong")).toHaveText("Level c");
  });
});

test("17.2 the header counts follow the open card", async ({ page }) => {
  await withApp({}, async (app) => {
    const child = (id: string) => ({ type: "node.edited", id, parent: "root" });
    void child;
    const under = (id: string, extra: Record<string, unknown> = {}) => open(id, { parent: "root", ...extra });
    app.log(
      ...decideRoot,
      ...under("co"),
      ...open("co1", { parent: "co" }),
      ...open("co2", { parent: "co" }),
      ...under("cp", { status: "proto" }),
      ...decided("cd", { parent: "root" }),
      ...decided("base", { parent: "root" }),
      ...under("cs"),
      link("cs", "base"),
      { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
    );
    await page.goto(app.url);
    await expect(left(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    const counts = page.locator("[data-slot=counts] [data-slot=count]");
    await expect(counts.first()).toBeVisible();
    const read = async () => {
      const out: Record<string, { n: number; title: string }> = {};
      for (const c of await counts.all())
        out[(await c.getAttribute("data-kind")) ?? "?"] = {
          n: Number(await c.textContent()),
          title: (await c.getAttribute("title")) ?? "",
        };
      return out;
    };
    const rootCounts = await read();
    expect(rootCounts.total?.n).toBe(8);
    expect(rootCounts.open?.n).toBeGreaterThan(0);
    expect(rootCounts.proto?.n).toBe(1);
    expect(rootCounts.decided?.n).toBe(2);
    expect(rootCounts.stale?.n).toBe(1);
    expect((rootCounts.open?.n ?? 0) + (rootCounts.proto?.n ?? 0) + (rootCounts.decided?.n ?? 0)).toBe(
      rootCounts.total?.n ?? -1,
    );
    expect(rootCounts.postponed).toBeUndefined();
    expect(rootCounts.open?.title).toMatch(/open/);
    expect(rootCounts.proto?.title).toMatch(/proto/);
    expect(rootCounts.decided?.title).toMatch(/decided/);
    expect(rootCounts.stale?.title).toMatch(/stale/);
    await page.goto(`${app.url}/map/co`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Title co" })).toBeVisible();
    await expect.poll(async () => (await read()).total?.n).toBe(3);
  });
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page }) => {
  await withApp({}, async (app) => {
    const ids = ["werk"];
    for (let i = 0; i < 11; i++) ids.push(`werk-${String(i).padStart(2, "0")}`);
    for (const x of ["xwerk", "framework", "networks"]) ids.push(x);
    // containing rows are written first so the order does not come from the log
    const order = [...ids.slice(12), ...ids.slice(0, 12)];
    app.log(...decideRoot, ...order.flatMap((id) => open(id, { parent: "root" })));
    // one stale card among the rows: a decided basis was reopened after the card took it
    app.log(
      ...decided("werk-base", { parent: "root" }),
      ...open("werk-stale", { parent: "root" }),
      link("werk-stale", "werk-base"),
      { type: "node.reopened", id: "werk-base", at: "2026-10-10T09:00:00.000Z" },
    );
    await page.goto(app.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await box.fill("#werk");
    const list = page.getByRole("list", { name: "Search results" });
    await expect(list).toBeVisible();
    const rows = list.getByRole("listitem");
    expect(await rows.count()).toBeLessThanOrEqual(12);
    expect(await rows.count()).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const idsShown = await list.locator("code").allTextContents();
    let seenContains = false;
    for (const id of idsShown) {
      if (!id.startsWith("werk")) seenContains = true;
      else expect(seenContains).toBe(false);
    }
    await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
    await expect(rows.first().locator("[data-slot=result-title]")).not.toHaveText("");
    // the stale card: search narrowly to see its row
    await box.fill("#werk-stale");
    const stale = list.getByRole("listitem").filter({ hasText: "werk-stale" });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    const bg = await stale.locator("[data-slot=dot]").evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
    expect((r ?? 0) > (g ?? 0) + 60 && (r ?? 0) > (b ?? 0) + 60).toBe(true);
    await box.fill("#werk");
    await box.press("ArrowDown");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("strong")).toHaveText("Title werk");
    await expect(box).toHaveValue("");
  });
});

test("17.4 a person switches between the Map and Board tabs", async ({ page }) => {
  await withApp({}, async (app) => {
    app.log(...open("seats", { title: "We charge per seat", parent: "root" }));
    await page.goto(`${app.url}/map/seats`);
    const pane = left(page);
    await expect(pane.getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(left(page).getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(left(page).getByRole("heading", { name: "Board" })).toBeVisible();
    await views.getByRole("button", { name: "Map" }).click();
    await expect(left(page).getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  });
});
