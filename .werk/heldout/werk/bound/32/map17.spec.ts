import { expect, test } from "@playwright/test";
import {
  card,
  dependsOn,
  leftPane,
  reopen,
  serverWithLog,
} from "./support.ts";

test.use({ viewport: { width: 900, height: 800 } });

test("17.1 deep card: breadcrumbs on one line, overlay on hover, parent click", async ({
  page,
}) => {
  const server = await serverWithLog([
    ...card("root", null, "decided", "Root"),
    ...card("l1", "root", "open", "Level one"),
    ...card("l2", "l1", "open", "Level two"),
    ...card("l3", "l2", "open", "Level three"),
    ...card("l4", "l3", "open", "Level four"),
  ]);
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    const width = await leftPane(page).evaluate((el) => el.clientWidth);
    expect(width).toBeLessThan(700);
    for (const title of ["Level one", "Level two", "Level three", "Level four"]) {
      await leftPane(page).locator("a.tile", { hasText: title }).click();
      await expect(
        leftPane(page).getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    expect((await line.boundingBox())?.height).toBeLessThan(40);
    await expect(line).toContainText("…");
    await expect(line).toContainText("Level three");
    await expect(
      line.locator("[data-slot=crumb-current]"),
    ).toHaveText("Level four");
    expect(
      await line
        .locator("[data-slot=crumb-current]")
        .evaluate((el) => el.tagName),
    ).toBe("STRONG");
    expect((await line.innerText()).replace(/\s+/g, " ").trim()).toBe(
      "… › Level three › Level four",
    );
    await expect(line).not.toContainText("Level two");

    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    for (const t of ["Root", "Level one", "Level two", "Level three", "Level four"])
      await expect(overlay).toContainText(t);

    await overlay.getByRole("button", { name: "Level three" }).click();
    await expect(page).toHaveURL(/\/map\/l3$/);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Level three" }),
    ).toBeVisible();
    await expect(
      crumbs.locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
    ).toHaveText("Level three");
  } finally {
    await server.dispose();
  }
});

const count = (page: import("@playwright/test").Page, kind: string) =>
  page.locator(`[data-slot=count][data-kind=${kind}]`);

test("17.2 header counts follow the open card", async ({ page }) => {
  const server = await serverWithLog([
    ...card("root", null, "decided", "Root"),
    ...card("o1", "root", "open", "Open child"),
    ...card("o1a", "o1", "open", "Open grandchild"),
    ...card("p1", "root", "proto", "Proto child"),
    ...card("d1", "root", "decided", "Decided one"),
    ...card("d2", "root", "decided", "Decided two"),
    dependsOn("d2", "d1"),
    reopen("d1"),
  ]);
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    await expect(count(page, "total")).toBeVisible();
    const n = async (kind: string) => Number(await count(page, kind).innerText());
    const total = await n("total");
    const open = await n("open");
    const proto = await n("proto");
    const decided = await n("decided");
    console.log("root counts", { total, open, proto, decided });
    expect(open + proto + decided).toBe(total);
    await expect(count(page, "stale")).toBeVisible();
    for (const kind of ["total", "open", "proto", "decided"]) {
      const title = await count(page, kind).getAttribute("title");
      if (kind !== "total") expect(title?.toLowerCase()).toContain(kind);
    }
    await expect(count(page, "unchallenged").or(count(page, "postponed"))).toHaveCount(
      (await count(page, "unchallenged").count()) +
        (await count(page, "postponed").count()),
    );

    await leftPane(page).locator("a.tile", { hasText: "Open child" }).click();
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Open child" }),
    ).toBeVisible();
    await expect(count(page, "total")).toHaveText("2");
    await expect(count(page, "open")).toHaveText("2");
    await expect(count(page, "proto")).toHaveCount(0);
    await expect(count(page, "decided")).toHaveCount(0);
  } finally {
    await server.dispose();
  }
});

test("17.3 search by id with # lists, orders, marks stale, navigates with keys, opens", async ({
  page,
}) => {
  const events = [
    ...card("root", null, "decided", "Root"),
    ...card("werk", "root", "open", "The werk card"),
    ...card("base", "root", "decided", "Base card"),
    ...card("werk-stale", "root", "decided", "Stale werk card"),
    dependsOn("werk-stale", "base"),
    reopen("base"),
  ];
  // contains first in the log, so ranking (not log order) must put prefix rows first
  for (let i = 0; i < 5; i++) events.push(...card(`x-werk-${i}`, "root", "open", `Contains ${i}`));
  for (let i = 0; i < 8; i++) events.push(...card(`werk-${i}`, "root", "open", `Prefix ${i}`));
  const server = await serverWithLog(events);
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const list = page.getByRole("list", { name: "Search results" });
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allInnerTexts();
    const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
    const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
    expect(firstContains).toBeGreaterThan(lastPrefix);
    for (let i = 0; i < 12; i++) {
      const row = rows.nth(i);
      await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
      await expect(row.locator("code")).not.toHaveText("");
    }
    const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    expect(
      await stale.locator("[data-slot=dot]").evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toMatch(/rgb\(\s*(2[0-9]{2}|1[7-9][0-9]),\s*[0-9]{1,2},/);

    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");

    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumbs" })
        .locator("[data-slot=crumb-current]"),
    ).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  } finally {
    await server.dispose();
  }
});
