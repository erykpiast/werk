import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { decided, link, open } from "../../src/map/mark-fixtures.ts";
import { expect, test } from "./fixtures.ts";
import type { Server } from "./server.ts";

const ROOT_TITLE = "We build software with agents";

const seed = (app: Server, ...events: unknown[]) =>
  appendFileSync(
    join(app.dir, ".werk", "log.jsonl"),
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
const under = (parent: string, ...ids: string[]) =>
  ids.map((id) => ({
    type: "edge.added",
    from: id,
    to: parent,
    link: "refines",
    why: "w",
  }));

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const base = (url: string) => url.replace(/\/(map|board).*$/, "");

// ---- 14: live page -------------------------------------------------------

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const added = app.werk(
    "add",
    "fresh",
    "--title",
    "Fresh idea",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
  appCopy,
}) => {
  await page.goto(appCopy.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);
  const pidBefore = appCopy.pid();
  const routes = join(appCopy.appDir, "src", "serve", "routes.ts");
  const text = readFileSync(routes, "utf8");
  const needle = 'return json({ error: "not found" }, 404);\n  };\n}';
  expect(text).toContain(needle);
  const before = await fetch(`${appCopy.origin}/api/heldout-probe`);
  expect(await before.json()).toEqual({ error: "not found" });
  writeFileSync(
    routes,
    text.replace(needle, 'return json({ error: "edited response" }, 404);\n  };\n}'),
  );
  await expect
    .poll(() => appCopy.output(), { timeout: 20000 })
    .toMatch(/reusing the live server/);
  expect(appCopy.pid()).toBe(pidBefore);
  await expect
    .poll(
      async () =>
        (await (await fetch(`${appCopy.origin}/api/heldout-probe`)).json())
          .error,
      { timeout: 20000 },
    )
    .toBe("edited response");
  // still the same port and same process
  expect((await fetch(`${appCopy.origin}/api/projects`)).ok).toBe(true);
  expect(
    appCopy.werk("add", "after", "--title", "After edit", "--parent", "root")
      .code,
  ).toBe(0);
  await expect(leftPane(page).getByText("After edit")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  await page.goto(appCopy.url);
  const title = leftPane(page).getByRole("heading", { level: 1 });
  await expect(title).toHaveText(ROOT_TITLE);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(title).toHaveText(ROOT_TITLE);
  await expect(composer).toHaveValue("draft that must survive");
});

// ---- 17: navigation ------------------------------------------------------

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
  app,
}) => {
  seed(
    app,
    open("a", { title: "Level a" }),
    open("b", { title: "Level b" }),
    open("c", { title: "Level c" }),
    open("d", { title: "Level d" }),
    under("root", "a"),
    under("a", "b"),
    under("b", "c"),
    under("c", "d"),
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(base(app.url));
  const pane = leftPane(page);
  expect((await pane.boundingBox())?.width).toBeLessThan(700);
  for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
    await pane.locator("a.tile", { hasText: title }).click();
    await expect(
      pane.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toContainText("…");
  await expect(line).toContainText("›");
  const items = line.locator("[data-slot=crumb-item]");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Level c");
  await expect(items.nth(1)).toContainText("Level d");
  await expect(line.locator("strong")).toHaveText("Level d");
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"]) {
    await expect(overlay).toContainText(t);
  }
  // The overlay now covers the line and holds the same parent segment.
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(
    pane.getByRole("heading", { level: 1, name: "Level c" }),
  ).toBeVisible();
  await expect(crumbs.locator("[data-slot=crumb-line] strong")).toHaveText(
    "Level c",
  );
});

const SEED_COUNTS = [
  open("kopen", { title: "Kid open" }),
  open("g1", { title: "Grandkid" }),
  open("kproto", { title: "Kid proto", status: "proto" }),
  decided("kdec", { title: "Kid decided" }),
  decided("base", { title: "Base card" }),
  open("kstale", { title: "Kid stale" }),
  link("kstale", "base"),
  {
    type: "node.reopened",
    id: "base",
    reason: "invalidated",
    at: "2026-10-10T09:00:00.000Z",
  },
  under("root", "kopen", "kproto", "kdec", "kstale"),
  under("kopen", "g1"),
];

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  seed(app, ...SEED_COUNTS);
  await page.goto(app.url);
  const counts = page.locator("[data-slot=counts] [data-slot=count]");
  await expect(counts.first()).toBeVisible();
  const read = async () => {
    const out: Record<string, { n: number; title: string }> = {};
    for (const el of await counts.all()) {
      const kind = (await el.getAttribute("data-kind")) as string;
      out[kind] = {
        n: Number(await el.textContent()),
        title: (await el.getAttribute("title")) ?? "",
      };
    }
    return out;
  };
  const rootCounts = await read();
  expect(rootCounts.total).toBeDefined();
  const dots = ["open", "proto", "decided"].map((k) => rootCounts[k]?.n ?? 0);
  expect(dots.reduce((a, b) => a + b, 0)).toBe(rootCounts.total?.n as number);
  expect(rootCounts.stale?.n).toBe(1);
  expect(rootCounts.postponed).toBeUndefined();
  expect(rootCounts.unchallenged).toBeUndefined();
  expect(rootCounts.open?.title.toLowerCase()).toContain("open");
  expect(rootCounts.proto?.title.toLowerCase()).toContain("proto");
  expect(rootCounts.decided?.title.toLowerCase()).toContain("decided");
  for (const c of Object.values(rootCounts)) expect(c.n).toBeGreaterThan(0);

  await leftPane(page).locator("a.tile", { hasText: "Kid open" }).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Kid open" }),
  ).toBeVisible();
  await expect.poll(async () => (await read()).total?.n).toBe(2);
  const kidCounts = await read();
  expect(kidCounts.open?.n).toBe(2);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
  app,
}) => {
  const events: unknown[] = [open("werk", { title: "Werk card" })];
  for (let i = 1; i <= 10; i++)
    events.push(open(`werk-${i}`, { title: `Werk prefix ${i}` }));
  for (let i = 1; i <= 4; i++)
    events.push(open(`x-werk-${i}`, { title: `Contains ${i}` }));
  events.push(decided("basecard"), link("werk-1", "basecard"), {
    type: "node.reopened",
    id: "basecard",
    reason: "invalidated",
    at: "2026-10-10T09:00:00.000Z",
  });
  seed(app, ...events);
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list).toBeVisible();
  const rows = list.getByRole("listitem");
  expect(await rows.count()).toBeLessThanOrEqual(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
  const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
  if (firstContains !== -1) expect(lastPrefix).toBeLessThan(firstContains);
  for (const row of await rows.all()) {
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
    await expect(row.locator("code")).not.toHaveText("");
  }
  const stale = rows.filter({
    has: page.locator("code", { hasText: /^werk-1$/ }),
  });
  await expect(stale.locator("[data-slot=dot]")).toHaveAttribute(
    "data-color",
    "stale",
  );
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Werk card" }),
  ).toBeVisible();
  await expect(page.locator("[data-slot=crumb-line] strong")).toHaveText(
    "Werk card",
  );
  await expect(box).toHaveValue("");
});

test("17.4 a person switches between the Map and Board tabs", async ({
  page,
  app,
}) => {
  seed(app, open("deep", { title: "Deep card" }), under("root", "deep"));
  await page.goto(`${base(app.url)}/map/deep`);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Deep card" }),
  ).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page")).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.reload();
  await expect(page.locator(".board-page")).toBeVisible();
  await views.getByRole("button", { name: "Map" }).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Deep card" }),
  ).toBeVisible();
});
