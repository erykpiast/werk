import {
  card,
  decidedCard,
  type Ev,
  expect,
  leftPane,
  test,
} from "./a-support.ts";

const crumbs = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });
const counts = (page: import("@playwright/test").Page) =>
  page.locator("[data-slot=counts] [data-slot=count]");

const ROOT = "We build software with agents";

test("17.1 a deep card: breadcrumbs on one line, overlay on hover, click on the parent", async ({
  page,
  srv,
}) => {
  const s = await srv({
    events: [
      ...card("root", ROOT),
      ...card("a", "Level a", "root"),
      ...card("b", "Level b", "a"),
      ...card("c", "Level c", "b"),
      ...card("d", "Level d", "c"),
    ],
  });
  await page.goto(s.url);
  const pane = leftPane(page);
  await expect(pane.getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  const width = await pane.evaluate((el) => el.clientWidth);
  expect(width).toBeLessThan(700);

  for (const [from, title] of [
    ["a", "Level a"],
    ["b", "Level b"],
    ["c", "Level c"],
    ["d", "Level d"],
  ]) {
    await pane.locator("a.tile", { hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`/map/${from}$`));
  }
  await expect(pane.getByRole("heading", { level: 1, name: "Level d" })).toBeVisible();

  const line = crumbs(page).locator("[data-slot=crumb-line]");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("… › Level c › Level d");
  const box = await line.boundingBox();
  expect(box?.height).toBeLessThan(40);
  const current = line.locator("[data-slot=crumb-current]");
  await expect(current).toHaveText("Level d");
  expect(await current.evaluate((el) => el.tagName)).toBe("STRONG");
  // The parent is a plain button, not bold.
  const parentBtn = line.getByRole("button", { name: "Level c" });
  expect(
    Number(await parentBtn.evaluate((el) => getComputedStyle(el).fontWeight)),
  ).toBeLessThan(
    Number(await current.evaluate((el) => getComputedStyle(el).fontWeight)),
  );
  // The separators are ›
  const seps = await line.locator("[aria-hidden=true]").allInnerTexts();
  expect(seps.join("|")).toContain("›");

  await line.hover({ force: true });
  const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
  expect(full).toBe(`${ROOT} › Level a › Level b › Level c › Level d`);

  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  const cur = crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]");
  await expect(cur).toHaveText("Level c");
  expect(await cur.evaluate((el) => el.tagName)).toBe("STRONG");
});

function staleMap(): Ev[] {
  return [
    ...decidedCard("root", ROOT),
    ...decidedCard("base", "The base", "root"),
    ...decidedCard("dep", "The dependant", "root"),
    {
      type: "edge.added",
      from: "dep",
      to: "base",
      link: "depends_on",
      why: "dep needs base",
    },
    { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
    ...card("pro", "A proto card", "root", "proto"),
    ...card("pro1", "A proto leaf", "pro", "proto"),
  ];
}

test("17.2 the header counts follow the open card", async ({ page, srv }) => {
  const s = await srv({ events: staleMap() });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  await expect(counts(page).first()).toBeVisible();
  const read = async () => {
    const out: Record<string, { n: number; title: string }> = {};
    for (const el of await counts(page).all()) {
      out[(await el.getAttribute("data-kind")) as string] = {
        n: Number(await el.innerText()),
        title: (await el.getAttribute("title")) ?? "",
      };
    }
    return out;
  };
  const c = await read();
  expect(c.total).toBeDefined();
  expect(c.open && c.proto && c.decided).toBeTruthy();
  expect(c.stale).toBeDefined();
  expect(c.open.n + c.proto.n + c.decided.n).toBe(c.total.n);
  expect(c.total.n).toBe(5);
  expect(c.open.title).toMatch(/open/);
  expect(c.proto.title).toMatch(/proto/);
  expect(c.decided.title).toMatch(/decided/);
  expect(c.stale.title).toMatch(/stale/);
  // No count for a status with zero cards.
  expect(c.postponed).toBeUndefined();
  expect(c.unchallenged).toBeUndefined();
  // Hover shows the title (attribute) for each.
  for (const el of await counts(page).all()) {
    await el.hover();
    expect(await el.getAttribute("title")).toBeTruthy();
  }

  await leftPane(page).locator("a.tile", { hasText: "A proto card" }).click();
  await expect(page).toHaveURL(/\/map\/pro$/);
  await expect
    .poll(async () => JSON.stringify(Object.keys(await read()).sort()))
    .toBe(JSON.stringify(["proto", "total"]));
  const sub = await read();
  expect(sub.total.n).toBe(2);
  expect(sub.proto.n).toBe(2);
});

test("17.3 search by id lists at most twelve rows, ranked, with dots, and Enter opens the card", async ({
  page,
  srv,
}) => {
  const events: Ev[] = [
    ...decidedCard("root", ROOT),
    ...card("werk", "The werk card", "root"),
    ...decidedCard("base", "The base", "root"),
    ...decidedCard("werk-stale", "A stale werk card", "root"),
    {
      type: "edge.added",
      from: "werk-stale",
      to: "base",
      link: "depends_on",
      why: "needs base",
    },
    { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
  ];
  // Contains-only ids come first in the log, to show that rank beats log order.
  for (let i = 1; i <= 6; i++) events.push(...card(`my-werk-${i}`, `Contains ${i}`, "root"));
  for (let i = 1; i <= 8; i++) events.push(...card(`werk-${i}`, `Prefix ${i}`, "root"));
  const s = await srv({ events });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBe(12);
  const ids = await rows.locator("code").allInnerTexts();
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastPrefix = ids.reduce((acc, id, i) => (id.startsWith("werk") ? i : acc), -1);
  expect(firstContains === -1 || firstContains > lastPrefix).toBe(true);
  expect(ids.filter((id) => id.startsWith("werk")).length).toBe(10);
  // Each row: a dot, a title, an id.
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
    await expect(row.locator("code")).not.toHaveText("");
  }
  const staleRow = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  await expect(staleRow.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  const dotRgb = await staleRow
    .locator("[data-slot=dot]")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const plainDot = await rows
    .nth(0)
    .locator("[data-slot=dot]")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(dotRgb).not.toBe(plainDot);
  const [r, g, b] = (dotRgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(100);
  expect(b).toBeLessThan(100);

  await expect(rows.first()).toHaveAttribute("aria-current", /.+/);
  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", /.+/);
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", /.+/);
  await expect(rows.nth(1)).not.toHaveAttribute("aria-current", /.+/);

  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "The werk card" })).toBeVisible();
  const cur = crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]");
  await expect(cur).toHaveText("The werk card");
  expect(await cur.evaluate((el) => el.tagName)).toBe("STRONG");
  await expect(box).toHaveValue("");
});

test("17.4 the Map and Board tabs switch the view", async ({ page, srv }) => {
  const s = await srv({
    events: [...card("root", ROOT), ...card("seats", "We charge per seat", "root")],
  });
  await page.goto(`${s.url}/map/seats`);
  const pane = leftPane(page);
  await expect(pane.getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await expect(views.getByRole("button", { name: "Board" })).not.toHaveAttribute("aria-current", "page");

  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(pane.locator(".board-page")).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page).toHaveURL(/\/board$/);
  await expect(pane.locator(".board-page")).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");

  await views.getByRole("button", { name: "Map" }).click();
  await expect(page).toHaveURL(/\/map\/seats$/);
  await expect(pane.getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
});

test("17.5 the home screen shows #root and #how side by side", async ({ page, srv }) => {
  const s = await srv({
    events: [
      ...card("root", ROOT),
      ...card("r1", "Requirement one", "root"),
      ...card("r2", "Requirement two", "root"),
      ...card("how", "How we build"),
      ...card("h1", "Rule one", "how"),
      ...card("h2", "Rule two", "how"),
    ],
  });
  // The home address of the project.
  await page.goto(s.url);
  const pane = leftPane(page);
  await expect(pane.getByText(ROOT).first()).toBeVisible();
  const bodyText = await pane.innerText();
  expect(bodyText).toContain("How we build");
  expect(bodyText).toContain("Why how");
  expect(bodyText).toContain("Rule one");
  expect(bodyText).toContain("Requirement one");
});
