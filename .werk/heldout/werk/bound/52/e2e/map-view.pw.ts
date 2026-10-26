import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { type Srv, startServer } from "../server.ts";

const ROOT_TITLE = "We build software with agents";
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });
const mark = (page: Page) => page.evaluate(() => { (window as any).loaded = true; });
const still = (page: Page) => page.evaluate(() => (window as any).loaded === true).catch(() => false);

async function withServer(body: (s: Srv) => Promise<void>, opts: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer(opts);
  await s.start();
  try {
    await body(s);
  } finally {
    await s.dispose();
  }
}

const card = (id: string, extra: Record<string, unknown> = {}) => [
  { type: "node.proposed", id, kind: "card", title: `Title ${id}`, status: "open", parent: "root", ...extra },
  { type: "node.accepted", id, actor: "you" },
];

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({ page }) => {
  await withServer(async (s) => {
    await page.goto(s.url);
    await expect(left(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(page);
    const r = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(left(page).getByText("Fresh idea")).toBeVisible();
    expect(await still(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });
});

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page }) => {
  await withServer(async (s) => {
    await page.goto(s.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const owner = () => execFileSync("lsof", ["-nP", `-iTCP:${s.port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim();
    const before = owner();
    const before2 = await (await fetch(`${s.origin}/api/projects`)).json();
    expect(before2.edited).toBeUndefined();
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const text = readFileSync(routes, "utf8");
    expect(text).toContain("return json({ projects: entries(ctx.projects) });");
    writeFileSync(routes, text.replace("return json({ projects: entries(ctx.projects) });", "return json({ projects: entries(ctx.projects), edited: true });"));
    await expect.poll(async () => (await (await fetch(`${s.origin}/api/projects`)).json()).edited, { timeout: 20000 }).toBe(true);
    expect(s.output()).toContain("reusing the live server");
    expect(owner()).toBe(before);
    expect(s.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
    await expect(left(page).getByText("After edit")).toBeVisible();
    expect(await still(page)).toBe(true);
  }, { appCopy: true });
});

test("14.3 in dev a client edit that cannot apply in place reloads and keeps the draft", async ({ page }) => {
  await withServer(async (s) => {
    await page.goto(s.url);
    const title = left(page).getByRole("heading", { level: 1 });
    await expect(title).toHaveText(ROOT_TITLE);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await mark(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => still(page), { timeout: 30000 }).toBe(false);
    await expect(left(page).getByRole("heading", { level: 1 })).toHaveText(ROOT_TITLE);
    await expect(composer).toHaveValue("draft that must survive");
  }, { appCopy: true });
});

test("17.1 deep card, breadcrumbs, overlay and click on the parent", async ({ page }) => {
  await withServer(async (s) => {
    s.appendLog(card("a"), card("b", { parent: "a" }), card("c", { parent: "b" }), card("d", { parent: "c" }));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(s.url);
    const pane = await page.locator("#left-pane").boundingBox();
    expect(pane!.width).toBeLessThan(700);
    for (const id of ["a", "b", "c", "d"]) {
      await left(page).locator("a.tile", { hasText: `Title ${id}` }).click();
      await expect(left(page).getByRole("heading", { level: 1, name: `Title ${id}` })).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    const text = (await line.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toBe("… › Title c › Title d");
    await expect(line.locator("strong")).toHaveText("Title d");
    expect(await line.locator("strong").evaluate((e) => Number(getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
    const before = await line.boundingBox();
    expect(before!.height).toBeLessThan(40);
    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    const full = (await overlay.innerText()).replace(/\s+/g, " ");
    for (const t of [ROOT_TITLE, "Title a", "Title b", "Title c", "Title d"]) expect(full).toContain(t);
    expect(full.indexOf(ROOT_TITLE)).toBeLessThan(full.indexOf("Title a"));
    // A person clicks the parent segment where it sits in the one-line path: a real mouse click at its place.
    await page.mouse.move(5, 400);
    await expect(overlay).toBeHidden();
    const parentBox = (await line.getByRole("button", { name: "Title c" }).boundingBox())!;
    await page.mouse.click(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2);
    await expect(page).toHaveURL(/\/map\/c$/, { timeout: 5000 });
    await expect(left(page).getByRole("heading", { level: 1, name: "Title c" })).toBeVisible();
    await expect(line.locator("strong")).toHaveText("Title c");
  });
});

test("17.2 header counts follow the open card", async ({ page }) => {
  await withServer(async (s) => {
    s.appendLog(
      card("o"), card("o1", { parent: "o" }),
      card("p", { status: "proto" }),
      card("d", { status: "decided" }),
      card("x", { status: "decided", parent: undefined }),
      card("s", { status: "decided" }),
      { type: "edge.added", from: "s", to: "x", link: "depends_on", why: "needs x" },
      { type: "node.reopened", id: "x", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    );
    await page.goto(s.url);
    await expect(left(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    const counts = page.locator("[data-slot=counts] [data-slot=count]");
    await expect(counts.first()).toBeVisible();
    const read = async () => {
      const out: Record<string, number> = {};
      for (const el of await counts.all()) out[(await el.getAttribute("data-kind"))!] = Number(await el.innerText());
      return out;
    };
    const c = await read();
    expect(c.total).toBe(6);
    expect(c.open! + c.proto! + c.decided!).toBe(c.total);
    expect(c.stale).toBe(1);
    expect(c.open).toBeGreaterThan(0);
    expect(c.proto).toBeGreaterThan(0);
    expect(c.decided).toBeGreaterThan(0);
    for (const kind of ["open", "proto", "decided"]) {
      await expect(page.locator(`[data-slot=count][data-kind=${kind}]`)).toHaveAttribute("title", new RegExp(kind));
    }
    await left(page).locator("a.tile", { hasText: "Title o" }).first().click();
    await expect(left(page).getByRole("heading", { level: 1, name: "Title o" })).toBeVisible();
    await expect.poll(read).toMatchObject({ total: 2 });
    const c2 = await read();
    expect(c2.proto).toBeUndefined();
    expect(c2.decided).toBeUndefined();
  });
});

test("17.3 find a card by id from the search box", async ({ page }) => {
  await withServer(async (s) => {
    const events: unknown[] = [card("werk")];
    for (let i = 0; i < 6; i++) events.push(card(`xwerk${i}`), card(`werk-${i}`));
    events.push(card("old", { status: "decided" }));
    events.push(card("werk-stale", { status: "decided" }));
    events.push({ type: "edge.added", from: "werk-stale", to: "old", link: "depends_on", why: "r" });
    events.push({ type: "node.reopened", id: "old", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" });
    s.appendLog(events);
    await page.goto(s.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(12);
    expect(await rows.count()).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allInnerTexts();
    const firstContain = ids.findIndex((i) => !i.startsWith("werk"));
    const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
    expect(firstContain === -1 || lastPrefix < firstContain).toBe(true);
    await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
    await expect(rows.first().locator("[data-slot=result-title]")).toHaveText("Title werk");
    // the stale card's row: widen the list by narrowing the query
    await box.fill("#werk-stale");
    const dot = page.getByRole("list", { name: "Search results" }).getByRole("listitem").first().locator("[data-slot=dot]");
    await expect(dot).toHaveAttribute("data-color", "stale");
    const bg = await dot.evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r, g, b] = bg.match(/\d+(\.\d+)?/g)!.map(Number);
    expect(r).toBeGreaterThan(g * 1.5);
    expect(r).toBeGreaterThan(b * 1.5);
    await box.fill("#werk");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("strong")).toHaveText("Title werk");
    await expect(box).toHaveValue("");
  });
});

test("17.4 Map and Board tabs", async ({ page }) => {
  await withServer(async (s) => {
    s.appendLog(card("a"));
    await page.goto(`${s.url}/map/a`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Title a" })).toBeVisible();
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    await views.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    expect(new URL(page.url()).pathname.endsWith("/board")).toBe(true);
    await expect(page.locator("[data-slot=board]")).toBeVisible();
    await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.locator("[data-slot=board]")).toBeVisible();
    await views.getByRole("button", { name: "Map" }).click();
    await expect(left(page).getByRole("heading", { level: 1, name: "Title a" })).toBeVisible();
  });
});
