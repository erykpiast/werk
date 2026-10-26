import { expect, type Locator, type Page, test } from "@playwright/test";
import { card, decided, edge, refines, reopen } from "../events.ts";
import { type Server, startServer } from "./server.ts";

const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumbs" });
const squash = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

async function withServer(
  events: unknown[],
  body: (server: Server) => Promise<void>,
) {
  const server = await startServer({ events: events.flat() });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({ page }) => {
  await withServer(
    [
      card("root", { title: "Root" }),
      card("a", { title: "Level A" }),
      card("b", { title: "Level B" }),
      card("c", { title: "Level C" }),
      card("deep", { title: "Deep card" }),
      refines("a", "root"),
      refines("b", "a"),
      refines("c", "b"),
      refines("deep", "c"),
    ],
    async (server) => {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.goto(server.url);
      await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
      const width = await page.locator("#left-pane").evaluate((n) => n.clientWidth);
      expect(width).toBeLessThan(700);
      for (const title of ["Level A", "Level B", "Level C", "Deep card"]) {
        await pane(page).locator("a.tile", { hasText: title }).click();
        await expect(pane(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
      }
      const line = crumbs(page).locator("[data-slot=crumb-line]");
      expect(squash(await line.textContent())).toBe("… › Level C › Deep card");
      await expect(line.locator("strong")).toHaveText("Deep card");
      await crumbs(page).hover();
      const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
      await expect(overlay).toBeVisible();
      expect(squash(await overlay.textContent())).toBe("Root › Level A › Level B › Level C › Deep card");
      await overlay.getByRole("button", { name: "Level C" }).click();
      await expect(pane(page).getByRole("heading", { level: 1, name: "Level C" })).toBeVisible();
      await expect(crumbs(page).locator("[data-slot=crumb-line] strong")).toHaveText("Level C");
    },
  );
});

const countsOf = async (page: Page) => {
  const found: Record<string, { n: string; title: string }> = {};
  for (const el of await page.locator("[data-slot=count]").all()) {
    const kind = (await el.getAttribute("data-kind")) as string;
    found[kind] = { n: squash(await el.textContent()), title: (await el.getAttribute("title")) ?? "" };
  }
  return found;
};

test("17.2 the header counts follow the open card", async ({ page }) => {
  await withServer(
    [
      card("root", { title: "Root" }),
      card("o1", { title: "Open one" }),
      card("o1a", { title: "Open one A" }),
      card("o1b", { title: "Proto one B", status: "proto" }),
      card("p1", { title: "Proto one", status: "proto" }),
      decided("d1", { title: "Decided one" }),
      decided("x", { title: "Base x" }),
      card("s1", { title: "Stale one" }),
      refines("o1", "root"),
      refines("o1a", "o1"),
      refines("o1b", "o1"),
      refines("p1", "root"),
      refines("d1", "root"),
      refines("x", "root"),
      refines("s1", "root"),
      edge("s1", "x", "depends_on", "needs x"),
      reopen("x", { reason: "invalidated" }),
    ],
    async (server) => {
      await page.goto(server.url);
      await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
      await expect(page.locator("[data-slot=count][data-kind=total]")).toBeVisible();
      let counts = await countsOf(page);
      expect(counts.total?.n).toBe("8");
      expect(counts.open?.n).toBe("5");
      expect(counts.proto?.n).toBe("2");
      expect(counts.decided?.n).toBe("1");
      expect(Number(counts.open?.n) + Number(counts.proto?.n) + Number(counts.decided?.n)).toBe(8);
      expect(counts.stale?.n).toBe("1");
      expect(counts.open?.title).toMatch(/open/);
      expect(counts.proto?.title).toMatch(/proto/);
      expect(counts.decided?.title).toMatch(/decided/);
      await pane(page).locator("a.tile", { hasText: "Open one" }).first().click();
      await expect(pane(page).getByRole("heading", { level: 1, name: "Open one" })).toBeVisible();
      await expect(page.locator("[data-slot=count][data-kind=total]")).toHaveText("3");
      counts = await countsOf(page);
      expect(counts.open?.n).toBe("2");
      expect(counts.proto?.n).toBe("1");
      expect(counts.decided).toBeUndefined();
      expect(counts.stale).toBeUndefined();
    },
  );
});

test("17.3 a person finds a card by id and opens it from the search box", async ({ page }) => {
  const events: unknown[] = [card("root", { title: "Root" })];
  for (let i = 1; i <= 8; i++) {
    events.push(card(`my-werk-${i}`, { title: `Contains ${i}` }), refines(`my-werk-${i}`, "root"));
  }
  events.push(card("werk", { title: "Werk itself" }), refines("werk", "root"));
  events.push(decided("base", { title: "Base" }), refines("base", "root"));
  events.push(card("werk-stale", { title: "Stale werk" }), refines("werk-stale", "root"));
  for (let i = 1; i <= 4; i++) {
    events.push(card(`werk-0${i}`, { title: `Prefix ${i}` }), refines(`werk-0${i}`, "root"));
  }
  events.push(edge("werk-stale", "base", "depends_on", "needs base"), reopen("base", { reason: "invalidated" }));
  await withServer(events, async (server) => {
    await page.goto(server.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(12);
    await expect(rows.first().locator("code")).toHaveText("werk");
    const ids = await rows.locator("code").allTextContents();
    const starts = ids.map((id) => (id.startsWith("werk") ? 0 : 1));
    expect([...starts].sort()).toEqual(starts);
    for (const row of await rows.all()) {
      await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(row.locator("[data-slot=result-title]")).not.toBeEmpty();
      await expect(row.locator("code")).not.toBeEmpty();
    }
    const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
    const selected = async (r: Locator) => (await r.first().getAttribute("aria-current")) !== null;
    await box.press("ArrowDown");
    expect(await selected(rows.first())).toBe(false);
    await box.press("ArrowUp");
    expect(await selected(rows.first())).toBe(true);
    await box.press("Enter");
    await expect(pane(page).getByRole("heading", { level: 1, name: "Werk itself" })).toBeVisible();
    await expect(crumbs(page).locator("[data-slot=crumb-line] strong")).toHaveText("Werk itself");
    await expect(box).toHaveValue("");
  });
});

test("17.4 a person switches between the Map and Board tabs", async ({ page }) => {
  await withServer(
    [card("root", { title: "Root" }), card("child", { title: "Child card" }), refines("child", "root")],
    async (server) => {
      await page.goto(server.url);
      await pane(page).locator("a.tile", { hasText: "Child card" }).click();
      await expect(pane(page).getByRole("heading", { level: 1, name: "Child card" })).toBeVisible();
      const views = page.getByRole("navigation", { name: "Views" });
      await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
      await views.getByRole("button", { name: "Board" }).click();
      await expect(page).toHaveURL(/\/board$/);
      await expect(pane(page).getByRole("heading", { name: "Board" })).toBeVisible();
      await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
      await page.reload();
      await expect(pane(page).getByRole("heading", { name: "Board" })).toBeVisible();
      await views.getByRole("button", { name: "Map" }).click();
      await expect(pane(page).getByRole("heading", { level: 1, name: "Child card" })).toBeVisible();
    },
  );
});

async function columnsOf(page: Page, left: string, right: string) {
  const a = pane(page).getByRole("heading", { level: 1, name: left });
  const b = pane(page).getByRole("heading", { level: 1, name: right });
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();
  return page.evaluate(
    ([l, r]) => {
      const hs = [...document.querySelectorAll("#left-pane h1")] as HTMLElement[];
      const ha = hs.find((h) => h.textContent === l) as HTMLElement;
      const hb = hs.find((h) => h.textContent === r) as HTMLElement;
      let lca: HTMLElement | null = ha;
      while (lca && !lca.contains(hb)) lca = lca.parentElement;
      const branch = (h: HTMLElement) => {
        let n: HTMLElement = h;
        while (n.parentElement !== lca) n = n.parentElement as HTMLElement;
        return n.getBoundingClientRect();
      };
      const ba = branch(ha);
      const bb = branch(hb);
      return { aw: ba.width, bw: bb.width, ax: ba.x, bx: bb.x };
    },
    [left, right],
  );
}

test("17.5 the first screen shows the requirements and the build rules side by side", async ({ page }) => {
  const events = [
    card("root", { title: "Requirements", why: "What we need." }),
    card("r1", { title: "Req child one" }),
    card("r2", { title: "Req child two" }),
    refines("r1", "root"),
    refines("r2", "root"),
    card("how", { title: "Build rules", why: "How we build." }),
    card("h1", { title: "Rule child one" }),
    refines("h1", "how"),
  ];
  await withServer(events, async (server) => {
    await page.goto(server.url);
    const box = await columnsOf(page, "Requirements", "Build rules");
    expect(box.bx).toBeGreaterThan(box.ax);
    expect(Math.abs(box.aw - box.bw)).toBeLessThan(3);
    for (const text of ["What we need.", "How we build.", "Req child one", "Rule child one"]) {
      await expect(pane(page).getByText(text)).toBeVisible();
    }
    expect(await page.locator("[data-slot=count][data-kind=total]").count()).toBeGreaterThan(0);
  });
  await withServer(
    [card("root", { title: "Requirements", why: "What we need." }), card("r1", { title: "Req child one" }), refines("r1", "root")],
    async (server) => {
      await page.goto(server.url);
      await expect(pane(page).getByRole("heading", { level: 1, name: "Requirements" })).toBeVisible();
      await expect(pane(page).getByText(/build rules/i).first()).toBeVisible();
    },
  );
});
