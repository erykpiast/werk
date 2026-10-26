import { expect, test } from "@playwright/test";
import {
  dependsOn,
  decided,
  ghost,
  leftPane,
  real,
  serverWith,
} from "./g3-support.ts";

const ROOT_TITLE = "We build software with agents";

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
}) => {
  const server = await serverWith({
    events: [
      ...real("a"),
      ...real("b", { parent: "a" }),
      ...real("c", { parent: "b" }),
      ...real("d", { parent: "c" }),
    ],
  });
  try {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(server.url);
    const pane = leftPane(page);
    await expect(
      pane.getByRole("heading", { level: 1, name: ROOT_TITLE }),
    ).toBeVisible();
    expect((await pane.boundingBox())?.width).toBeLessThan(700);
    for (const id of ["a", "b", "c", "d"]) {
      await pane.locator("a.tile", { hasText: `Title ${id}` }).click();
      await expect(
        pane.getByRole("heading", { level: 1, name: `Title ${id}` }),
      ).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line).toContainText("… › Title c › Title d");
    await expect(line.locator("strong")).toHaveText("Title d");
    expect(
      await line.locator("strong").evaluate((e) => Number(getComputedStyle(e).fontWeight)),
    ).toBeGreaterThanOrEqual(600);
    expect((await line.boundingBox())?.height).toBeLessThan(40);

    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(ROOT_TITLE);
    for (const id of ["a", "b", "c", "d"])
      await expect(overlay).toContainText(`Title ${id}`);

    // The hover overlay lists the path, so the parent card is clicked there.
    await overlay.getByRole("button", { name: "Title c" }).click();
    await expect(
      pane.getByRole("heading", { level: 1, name: "Title c" }),
    ).toBeVisible();
    await expect(line.locator("strong")).toHaveText("Title c");
  } finally {
    await server.dispose();
  }
});

async function counts(page: import("@playwright/test").Page) {
  const out: Record<string, number> = {};
  const all = page.locator("[data-slot=count]");
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    out[(await el.getAttribute("data-kind")) as string] = Number(
      await el.textContent(),
    );
  }
  return out;
}

test("17.2 the header counts follow the open card", async ({ page }) => {
  const server = await serverWith({
    rootDecided: true,
    events: [
      ...decided("x"),
      ...real("p", { status: "proto" }),
      ...decided("c"),
      ...real("g", { parent: "c" }),
      ...decided("y"),
      dependsOn("y", "x"),
      { type: "node.reopened", id: "x", at: "2026-10-10T09:00:00.000Z" },
    ],
  });
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
    ).toBeVisible();
    await expect(page.locator("[data-slot=count][data-kind=total]")).toBeVisible();
    const c = await counts(page);
    expect(c.total).toBe(6);
    expect(c.open + c.proto + c.decided).toBe(c.total);
    expect(c.open).toBeGreaterThan(0);
    expect(c.proto).toBe(1);
    expect(c.decided).toBeGreaterThan(0);
    expect(c.stale).toBe(1);
    expect(c.postponed).toBeUndefined();
    expect(c.unchallenged === undefined || c.unchallenged > 0).toBe(true);
    for (const kind of ["open", "proto", "decided", "stale"]) {
      await expect(
        page.locator(`[data-slot=count][data-kind=${kind}]`),
      ).toHaveAttribute("title", new RegExp(kind));
    }

    await leftPane(page).locator("a.tile", { hasText: "Title c" }).click();
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Title c" }),
    ).toBeVisible();
    await expect(page.locator("[data-slot=count][data-kind=total]")).toHaveText("2");
    const sub = await counts(page);
    expect(sub.total).toBe(2);
    expect(sub.open + sub.decided).toBe(2);
    expect(sub.proto).toBeUndefined();
  } finally {
    await server.dispose();
  }
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
}) => {
  const others = [
    "werk-shots",
    "werk-board",
    "werk-chat",
    "werk-map",
    "werk-cli",
    "my-werk",
    "net-werk",
    "old-werk",
    "new-werk",
    "big-werk",
    "tiny-werk",
  ].flatMap((id) => real(id));
  const server = await serverWith({
    rootDecided: true,
    events: [
      ...decided("werk", { title: "The werk card" }),
      ...decided("basis"),
      ...others,
      ...decided("werk-late"),
      dependsOn("werk-late", "basis"),
      { type: "node.reopened", id: "basis", at: "2026-10-10T09:00:00.000Z" },
    ],
  });
  try {
    await page.goto(server.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await expect(box).toBeVisible();
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allTextContents();
    const lastPrefix = ids.map((i) => i.startsWith("werk")).lastIndexOf(true);
    const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
    expect(firstContains === -1 || lastPrefix < firstContains).toBe(true);
    for (const i of [0, 1]) {
      await expect(rows.nth(i).locator("[data-slot=dot]")).toBeVisible();
      await expect(rows.nth(i).locator("[data-slot=result-title]")).not.toBeEmpty();
    }
    // the stale card has a red dot
    const stale = page
      .getByRole("list", { name: "Search results" })
      .locator("li", { has: page.locator("code", { hasText: /^werk-late$/ }) });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");

    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-current]"),
    ).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  } finally {
    await server.dispose();
  }
});
