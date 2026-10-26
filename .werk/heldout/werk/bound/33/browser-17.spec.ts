import { appendLog, cardEv, decideRoot, decidedEv, expect, leftPane, serve, test } from "./browser-support.ts";

test("17.1 deep card breadcrumbs", async ({ page }) => {
  const s = await serve();
  try {
    appendLog(s.dir, cardEv("a", "root"), cardEv("b", "a"), cardEv("c", "b"), cardEv("d", "c", { title: "Deep d" }));
    page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(s.url);
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Home" }).click();
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Map" }).click();
    // open the deep card from the map: walk the tiles down
    for (const t of ["Title a", "Title b", "Title c", "Deep d"]) {
      await leftPane(page).locator("a.tile", { hasText: t }).first().click();
    }
    const pane = await leftPane(page).boundingBox();
    expect(pane?.width).toBeLessThan(700);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line).toHaveText(/^…\s*›\s*Title c\s*›\s*Deep d$/);
    await expect(line.locator("strong")).toHaveText("Deep d");
    expect(await line.locator("button").count()).toBe(1);
    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText(/^Home\s*›.*›\s*Title a\s*›\s*Title b\s*›\s*Title c\s*›\s*Deep d$/);
    await overlay.getByRole("button", { name: "Title c" }).click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Title c" })).toBeVisible();
    await expect(line.locator("strong")).toHaveText("Title c");
  } finally {
    await s.dispose();
  }
});

test("17.2 header counts", async ({ page }) => {
  const s = await serve();
  try {
    appendLog(
      s.dir,
      decideRoot,
      cardEv("o", "root"),
      cardEv("p", "root", { status: "proto" }),
      decidedEv("d", "root"),
      cardEv("d1", "d"),
      decidedEv("x", "root"),
      decidedEv("s", "root"),
      { type: "edge.added", from: "s", to: "x", link: "depends_on", why: "s takes x" },
      { type: "node.reopened", id: "x", at: "2026-10-10T09:00:00.000Z" },
    );
    await page.goto(`${s.url}/map/root`);
    const counts = page.locator("[data-slot=counts]");
    await expect(counts.locator("[data-slot=count]").first()).toBeVisible();
    const n = async (kind: string) => {
      const l = counts.locator(`[data-kind=${kind}]`);
      return (await l.count()) === 0 ? null : Number(await l.textContent());
    };
    await expect.poll(() => n("total")).not.toBeNull();
    const total = (await n("total")) as number;
    const open = (await n("open")) ?? 0;
    const proto = (await n("proto")) ?? 0;
    const decided = (await n("decided")) ?? 0;
    expect(open + proto + decided).toBe(total);
    expect(await n("stale")).toBe(1);
    await expect(counts.locator("[data-kind=open]")).toHaveAttribute("title", /open/);
    await expect(counts.locator("[data-kind=proto]")).toHaveAttribute("title", /proto/);
    await expect(counts.locator("[data-kind=decided]")).toHaveAttribute("title", /decided/);
    // a status with zero cards shows nothing: a map-wide check on a card with no proto
    await page.goto(`${s.url}/map/d`);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText("Title d");
    await expect(counts.locator("[data-kind=total]")).toHaveText("2");
    await expect(counts.locator("[data-kind=proto]")).toHaveCount(0);
    await expect(counts.locator("[data-kind=open]")).toHaveText("1");
    await expect(counts.locator("[data-kind=decided]")).toHaveText("1");
  } finally {
    await s.dispose();
  }
});

test("17.3 search box by id", async ({ page }) => {
  const s = await serve();
  try {
    const ev: unknown[] = [decideRoot];
    ev.push(cardEv("werk", "root", { title: "The werk card" }));
    for (let i = 0; i < 6; i++) ev.push(cardEv(`pre-werk-${i}`, "root"));
    for (let i = 0; i < 6; i++) ev.push(cardEv(`werk-${i}`, "root"));
    ev.push(decidedEv("base", "root"), decidedEv("werk-stale", "root"));
    ev.push({ type: "edge.added", from: "werk-stale", to: "base", link: "depends_on", why: "w" });
    ev.push({ type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" });
    appendLog(s.dir, ...ev);
    await page.goto(s.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).locator("li");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(12);
    expect(await rows.count()).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allTextContents();
    const firstContain = ids.findIndex((i) => !i.startsWith("werk"));
    const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
    expect(firstContain === -1 || lastPrefix < firstContain).toBe(true);
    await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
    await expect(rows.first().locator("[data-slot=result-title]")).toHaveText("The werk card");
    // stale row red: search narrowly
    await box.fill("#werk-stale");
    await expect(rows.first().locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    await box.fill("#werk");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] strong")).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  } finally {
    await s.dispose();
  }
});
