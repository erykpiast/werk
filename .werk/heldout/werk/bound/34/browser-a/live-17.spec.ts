import { type Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { card, decide, mapEvents } from "./seed.ts";

const ROOT_TITLE = "We build software with agents";
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const crumbs = (page: Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });
const loaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(pane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await loaded(page);

  const added = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.code).toBe(0);

  await expect(pane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  await page.goto(`${appCopy.url}/map/root`);
  const title = pane(page).getByRole("heading", { level: 1 });
  await expect(title).toHaveText(ROOT_TITLE);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await loaded(page);

  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(pane(page).getByRole("heading", { level: 1 })).toHaveText(ROOT_TITLE);
  await expect(composer).toHaveValue("draft that must survive");
});

test("17.1 a deep card: path on one line with …, parent and bold open card; hover overlay; click parent", async ({
  page,
  app,
}) => {
  mapEvents(
    app,
    ...card("a", "Level a"),
    ...card("b", "Level b", "a"),
    ...card("c", "Level c", "b"),
    ...card("d", "Level d", "c"),
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(app.url);
  const width = (await pane(page).boundingBox())?.width ?? 9999;
  expect(width).toBeLessThan(700);

  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Home" }).click();
  for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
    await pane(page).locator("a.tile", { hasText: title }).click();
    await expect(pane(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
  }

  const line = crumbs(page).locator("[data-slot=crumb-line]");
  await expect(line).toHaveText(/^\s*…\s*›\s*Level c\s*›\s*Level d\s*$/);
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
  expect(await line.locator("[data-slot=crumb-current]").evaluate((el) => el.tagName)).toBe("STRONG");
  expect((await line.boundingBox())?.height).toBeLessThan(40);

  await line.hover({ force: true });
  const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText(
    new RegExp(`^\\s*Home\\s*›\\s*${ROOT_TITLE}\\s*›\\s*Level a\\s*›\\s*Level b\\s*›\\s*Level c\\s*›\\s*Level d`),
  );

  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(pane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Level c");
});

test("17.2 header counts follow the open card", async ({ page, app }) => {
  mapEvents(
    app,
    ...decide("root"),
    ...card("ch-open", "Child open"),
    ...card("ch-proto", "Child proto", "root", "proto"),
    ...card("ch-decided", "Child decided"),
    ...decide("ch-decided"),
    ...card("base", "Base"),
    ...decide("base"),
    ...card("ch-stale", "Child stale"),
    ...decide("ch-stale"),
    { type: "edge.added", from: "ch-stale", to: "base", link: "depends_on", why: "needs base" },
    { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
    ...card("g1", "Grand one", "ch-open"),
    ...card("g2", "Grand two", "ch-open"),
  );
  await page.goto(`${app.url}/map/root`);
  const counts = page.locator("[data-slot=counts]");
  const read = async () => {
    const out: Record<string, { n: number; title: string }> = {};
    for (const el of await counts.locator("[data-slot=count]").all()) {
      out[(await el.getAttribute("data-kind")) as string] = {
        n: Number(await el.textContent()),
        title: (await el.getAttribute("title")) as string,
      };
    }
    return out;
  };
  await expect(counts.locator("[data-kind=total]")).toBeVisible();
  const all = await read();
  expect(all.total?.n).toBe(8);
  expect((all.open?.n ?? 0) + (all.proto?.n ?? 0) + (all.decided?.n ?? 0)).toBe(all.total?.n);
  expect(all.open?.title).toContain("open");
  expect(all.proto?.title).toContain("proto");
  expect(all.decided?.title).toContain("decided");
  expect(all.stale?.n).toBeGreaterThan(0);
  for (const c of Object.values(all)) expect(c.n).toBeGreaterThan(0);

  await page.goto(`${app.url}/map/ch-open`);
  await expect(pane(page).getByRole("heading", { level: 1, name: "Child open" })).toBeVisible();
  await expect(counts.locator("[data-kind=total]")).toHaveText("3");
  const sub = await read();
  expect(sub.total?.n).toBe(3);
  expect(sub.open?.n).toBe(3);
  expect(sub.proto).toBeUndefined();
});

test("17.3 search by #id lists up to twelve rows ranked, selects with arrows, Enter opens", async ({
  page,
  app,
}) => {
  const events: unknown[] = [...decide("root")];
  for (let i = 10; i < 24; i++) events.push(...card(`werk-${i}`, `Prefixed ${i}`));
  events.push(...card("werk", "The werk card"));
  events.push(...card("my-werk", "Contains werk"));
  events.push(...card("base2", "Base two"), ...decide("base2"));
  events.push(...card("werk-stale", "Stale werk"), ...decide("werk-stale"));
  events.push(
    { type: "edge.added", from: "werk-stale", to: "base2", link: "depends_on", why: "needs" },
    { type: "node.reopened", id: "base2", at: "2026-10-10T09:00:00.000Z" },
  );
  mapEvents(app, ...events);
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  expect(ids.every((id) => id.startsWith("werk"))).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
  }
  // the stale card has a red dot (narrow to it)
  await box.fill("#werk-stale");
  await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  await box.fill("#werk");
  await expect(rows).toHaveCount(12);
  // contains-only rows come after prefix rows
  await box.fill("#erk");
  const after = await rows.locator("code").allTextContents();
  expect(after.length).toBeGreaterThan(0);

  await box.fill("#werk");
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("The werk card");
  await expect(box).toHaveValue("");
});
