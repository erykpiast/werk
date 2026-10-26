import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { decided, link, open } from "../../src/map/mark-fixtures.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { startCopyServer } from "./own-server.ts";

const ROOT_TITLE = "We build software with agents";
const markLoaded = (page: Page) => page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false);
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });
const jsonl = (...events: unknown[]) => `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`;

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(left(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  expect(app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code).toBe(0);
  await expect(left(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  const server = await startCopyServer();
  try {
    await page.goto(server.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);
    const pidBefore = server.child.pid;
    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const text = readFileSync(routes, "utf8");
    expect(text).toContain("return json({ projects: entries(ctx.projects) });");
    writeFileSync(routes, text.replace("return json({ projects: entries(ctx.projects) });", "return json({ projects: entries(ctx.projects), edited: true });"));
    await expect
      .poll(async () => ((await (await fetch(`${server.origin}/api/projects`)).json()) as { edited?: boolean }).edited, { timeout: 30000 })
      .toBe(true);
    expect(server.output()).toMatch(/reusing the live server/);
    expect(server.child.pid).toBe(pidBefore);
    expect(server.child.exitCode).toBeNull();
    expect(server.werk("add", "after", "--title", "After edit", "--parent", "root").status).toBe(0);
    await expect(left(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await server.dispose();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page, appCopy }) => {
  await page.goto(`${appCopy.url}/map/root`);
  const heading = left(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(ROOT_TITLE);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  await expect(left(page).getByRole("heading", { level: 1 })).toHaveText(ROOT_TITLE);
  await expect(composer).toHaveValue("draft that must survive");
});

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page, app }) => {
  const add = (id: string, parent: string) =>
    expect(app.werk("add", id, "--title", `Level ${id}`, "--parent", parent).code).toBe(0);
  add("a", "root"); add("b", "a"); add("c", "b"); add("d", "c");
  for (const id of ["a", "b", "c", "d"]) expect(app.werk("accept", id, "--actor", "you").code).toBe(0);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(app.url);
  const pane = left(page);
  expect((await pane.boundingBox())?.width).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) await pane.locator("a.tile", { hasText: `Level ${id}` }).first().click();
  await expect(page).toHaveURL(/\/map\/d$/);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toContainText("…");
  await expect(line.locator("[data-slot=crumb-item]")).toHaveCount(2);
  await expect(line.locator("[data-slot=crumb-item]").first().getByRole("button")).toHaveText("Level c");
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
  await expect(line).toContainText("›");
  expect(await line.locator("[data-slot=crumb-current]").evaluate((el) => getComputedStyle(el).fontWeight)).toMatch(/^(bold|[6-9]00)$/);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Home");
  await expect(overlay).toContainText("Level d");
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(crumbs.locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Level c");
});

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  appendFileSync(
    join(app.dir, ".werk", "log.jsonl"),
    jsonl(
      { type: "node.edited", id: "root", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "root", form: "revisit" },
      { type: "node.decided", id: "root" },
      open("o1", { parent: "root", title: "Opened" }),
      open("p1", { parent: "root", title: "Proto", status: "proto" }),
      decided("d1", { parent: "root", title: "Dec" }),
      decided("d2", { parent: "root", title: "Dec two" }),
      open("sub", { parent: "root", title: "Sub" }),
      open("sub1", { parent: "sub", title: "Sub child" }),
      decided("dep"),
      link("o1", "dep"),
      { type: "node.reopened", id: "dep", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    ),
  );
  await page.goto(`${app.url}/map/root`);
  const counts = page.locator("[data-slot=counts]");
  const n = async (kind: string) => Number(await counts.locator(`[data-kind=${kind}]`).first().textContent());
  await expect(counts.locator("[data-kind=total]")).toBeVisible();
  const total = await n("total");
  const sum = (await n("open")) + (await n("proto")) + (await n("decided"));
  expect(sum).toBe(total);
  await expect(counts.locator("[data-kind=decided]")).toHaveAttribute("title", /decided/);
  await expect(counts.locator("[data-kind=open]")).toHaveAttribute("title", /open/);
  await expect(counts.locator("[data-kind=stale]")).toHaveAttribute("title", /stale/);
  await page.goto(`${app.url}/map/sub`);
  await expect.poll(async () => Number(await counts.locator("[data-kind=total]").textContent())).toBe(2);
  await expect(counts.locator("[data-kind=decided]")).toHaveCount(0);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page, app }) => {
  const evs: unknown[] = [
    open("werk", { parent: "root", title: "Werk itself" }),
    open("werk-b", { parent: "root", title: "B starts" }),
    open("werk-a", { parent: "root", title: "A starts" }),
    open("my-werk", { parent: "root", title: "Contains" }),
  ];
  for (let i = 0; i < 12; i++) evs.push(open(`werk-x${i}`, { parent: "root", title: `Filler ${i}` }));
  evs.push(open("dep"), decided("dep2"), link("my-werk", "dep2"), { type: "node.reopened", id: "dep2", at: "2026-10-10T09:00:00.000Z" });
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), jsonl(...evs));
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows.first()).toContainText("werk");
  expect(await rows.count()).toBeLessThanOrEqual(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastStarts = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  if (firstContains >= 0) expect(lastStarts).toBeLessThan(firstContains);
  await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
  await expect(rows.first().locator("[data-slot=result-title]")).toBeVisible();
  await box.fill("#my-werk");
  await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", /red|stale/);
  await box.fill("#werk");
  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Werk itself");
  await expect(box).toHaveValue("");
});
