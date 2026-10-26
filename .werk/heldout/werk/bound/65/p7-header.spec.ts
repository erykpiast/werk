import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";
import { mapPane } from "./p7-support.ts";

const ROOT_TITLE = "We build software with agents";
const AT = "2026-10-10T09:00:00.000Z";

async function withApp(body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer();
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

/** Hand-written log lines, the way a person or an agent could append them. */
function append(s: BrowserServer, events: Record<string, unknown>[]) {
  appendFileSync(
    join(s.dir, ".werk", "log.jsonl"),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}
const real = (id: string, parent: string, title: string, status = "open") => [
  { type: "node.proposed", id, kind: "card", title, status, parent },
  { type: "node.accepted", id, actor: "you" },
];
const decided = (id: string, parent: string, title: string) => [
  ...real(id, parent, title),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const decideRoot = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];
const dependsOn = (from: string, to: string) => ({
  type: "edge.added",
  from,
  to,
  link: "depends_on",
  why: `${from} takes ${to}`,
});

const crumbs = (page: Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
}) => {
  await withApp(async (server) => {
    append(server, [
      ...real("a", "root", "Level a"),
      ...real("b", "a", "Level b"),
      ...real("c", "b", "Level c"),
      ...real("d", "c", "Level d"),
    ]);
    await page.setViewportSize({ width: 1000, height: 800 });
    console.log("m1");
    await page.goto(server.url);
    console.log("m2");
    const pane = mapPane(page);
    await expect(pane.getByRole("heading", { level: 1 })).toBeVisible();
    console.log("m3");
    const width = (await pane.boundingBox())?.width ?? 9999;
    expect(width).toBeLessThan(700);

    const views = page.getByRole("navigation", { name: "Views" });
    await views.getByRole("button", { name: "Home" }).click();
    console.log("m4");
    await views.getByRole("button", { name: "Map" }).click();
    console.log("m5");
    for (const title of ["Level a", "Level b", "Level c", "Level d"]) {
      await pane.locator("a.tile", { hasText: title }).click();
      await expect(
        pane.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
    }

    const line = crumbs(page).locator("[data-slot=crumb-line]");
    await expect(line).toContainText("…");
    console.log("m6");
    const text = ((await line.textContent()) ?? "").replace(/\s+/g, " ").trim();
    expect(text).toBe("… › Level c › Level d");
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText(
      "Level d",
    );
    expect(
      await line.locator("[data-slot=crumb-current]").evaluate((el) => {
        const w = getComputedStyle(el).fontWeight;
        return Number(w) >= 600 || w === "bold";
      }),
    ).toBe(true);
    expect((await line.boundingBox())?.height).toBeLessThan(40);

    await line.hover({ force: true });
    console.log("m7");
    const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    console.log("m8");
    const full = ((await overlay.textContent()) ?? "").replace(/\s+/g, " ");
    for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"]) {
      expect(full).toContain(t);
    }
    expect(full.indexOf(ROOT_TITLE)).toBeLessThan(full.indexOf("Level a"));
    expect(full.indexOf("Level c")).toBeLessThan(full.indexOf("Level d"));

    // The person moves the pointer off the path, then clicks the parent card in the path.
    await page.mouse.move(5, 5);
    console.log("m9");
    await expect(overlay).toBeHidden();
    console.log("m10");
    await line.getByRole("button", { name: "Level c" }).click();
    console.log("m11");
    await expect(
      pane.getByRole("heading", { level: 1, name: "Level c" }),
    ).toBeVisible();
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText(
      "Level c",
    );
  });
});

test("17.2 the header counts follow the open card", async ({ page }) => {
  await withApp(async (server) => {
    append(server, [
      ...decideRoot,
      ...real("o", "root", "Open child"),
      ...real("o1", "o", "Grandchild proto", "proto"),
      ...real("p", "root", "Proto child", "proto"),
      ...decided("d", "root", "Decided child"),
      ...decided("d2", "root", "Soon rejected"),
      ...decided("s", "root", "Goes stale"),
      dependsOn("s", "d2"),
      { type: "node.reopened", id: "d2", reason: "rejected", at: AT, why: "no" },
    ]);
    await page.goto(server.url);
    const counts = page.locator("[data-slot=counts]");
    await expect(counts.locator("[data-slot=count]").first()).toBeVisible();
    const read = async () => {
      const out: Record<string, { n: number; title: string }> = {};
      for (const el of await counts.locator("[data-slot=count]").all()) {
        out[(await el.getAttribute("data-kind")) ?? "?"] = {
          n: Number(await el.textContent()),
          title: (await el.getAttribute("title")) ?? "",
        };
      }
      return out;
    };
    const root = await read();
    // 7 cards: open o, d2; proto o1, p; decided root, d, s.
    expect(root.total?.n).toBe(7);
    expect(root.open?.n).toBe(2);
    expect(root.proto?.n).toBe(2);
    expect(root.decided?.n).toBe(3);
    expect((root.open?.n ?? 0) + (root.proto?.n ?? 0) + (root.decided?.n ?? 0)).toBe(
      root.total?.n,
    );
    expect(root.stale?.n).toBe(1);
    expect(root.postponed).toBeUndefined();
    expect(root.open?.title).toMatch(/open/i);
    expect(root.proto?.title).toMatch(/proto/i);
    expect(root.decided?.title).toMatch(/decided/i);
    expect(root.stale?.title).toMatch(/stale/i);

    await mapPane(page).locator("a.tile", { hasText: "Open child" }).click();
    await expect(
      mapPane(page).getByRole("heading", { level: 1, name: "Open child" }),
    ).toBeVisible();
    await expect(counts.locator('[data-kind="total"]')).toHaveText("2");
    const child = await read();
    expect(child.open?.n).toBe(1);
    expect(child.proto?.n).toBe(1);
    expect(child.decided).toBeUndefined();
  });
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
}) => {
  await withApp(async (server) => {
    const events: Record<string, unknown>[] = [
      ...decideRoot,
      ...decided("base", "root", "Base card"),
      ...decided("werk", "root", "The werk card"),
      ...decided("werk-b", "root", "Stale werk card"),
      dependsOn("werk-b", "base"),
      ...real("werk-a", "root", "Werk A"),
      ...real("werk-c", "root", "Werk C"),
    ];
    for (let i = 1; i <= 10; i++)
      events.push(...real(`x-werk-${i}`, "root", `Contains ${i}`));
    events.push({ type: "node.reopened", id: "base", reason: "rejected", at: AT, why: "no" });
    append(server, events);

    await page.goto(server.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).locator("li");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeLessThanOrEqual(12);
    expect(count).toBe(12);
    const ids = await rows.locator("code").allTextContents();
    expect(ids[0]).toBe("werk");
    const startsWith = ids.map((id) => id.startsWith("werk"));
    const firstContain = startsWith.indexOf(false);
    expect(firstContain).toBeGreaterThan(0);
    expect(startsWith.slice(firstContain).every((v) => !v)).toBe(true);
    expect(startsWith.filter(Boolean)).toHaveLength(4);
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
      await expect(row.locator("code")).not.toHaveText("");
    }
    const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-b$/ }) });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute(
      "data-color",
      "stale",
    );
    const rgb = await stale
      .locator("[data-slot=dot]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    const other = rows.filter({ has: page.locator("code", { hasText: /^werk$/ }) });
    await expect(other.locator("[data-slot=dot]")).not.toHaveAttribute(
      "data-color",
      "stale",
    );

    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(
      mapPane(page).getByRole("heading", { level: 1, name: "The werk card" }),
    ).toBeVisible();
    await expect(
      crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
    ).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  });
});
