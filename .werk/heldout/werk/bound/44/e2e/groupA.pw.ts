import { type ChildProcess, spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const ROOT_TITLE = "We build software with agents";

const jsonl = (...events: unknown[]) =>
  `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`;

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const heading = (page: Page, name?: string) =>
  leftPane(page).getByRole("heading", { level: 1, name });

const appendMap = (app: BrowserServer, ...events: unknown[]) =>
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), jsonl(...events));
const appendBoard = (app: BrowserServer, ...events: unknown[]) =>
  appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl(...events));

// ---- map event builders (the same shapes as src/map/mark-fixtures.ts) ----
const card = (
  id: string,
  parent: string | null,
  status: "open" | "proto" = "open",
  title = `Title ${id}`,
) => [
  {
    type: "node.proposed",
    id,
    kind: "card",
    title,
    status,
    ...(parent ? { parent } : {}),
  },
  { type: "node.accepted", id, actor: "you" },
];
const decide = (id: string) => [
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const dependsOn = (from: string, to: string) => ({
  type: "edge.added",
  from,
  to,
  link: "depends_on",
  why: `${from} takes ${to}`,
});
const reopen = (id: string) => ({
  type: "node.reopened",
  id,
  at: "2026-10-10T09:00:00.000Z",
});

// ---------------------------------------------------------------- 14.1
test("14.1 A card added from the command line appears on the open page without a reload", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(heading(page, ROOT_TITLE)).toBeVisible();
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

// ---------------------------------------------------------------- 14.2
test("14.2 In dev, a server edit changes a response and the live page stays connected", async () => {
  const server = await startBrowserServer({ appCopy: true });
  let child: ChildProcess | undefined;
  let output = "";
  const browser = await (await import("@playwright/test")).chromium.launch();
  try {
    const env = {
      ...cleanEnv(process.env),
      WERK_OPEN: "true",
      WERK_DEV: "1",
      WERK_HOME: server.home,
    };
    const port = new URL(server.origin).port;
    child = spawn(
      "bun",
      [join(server.appDir, "src", "cli.ts"), "serve", "--port", port],
      { cwd: server.dir, env },
    );
    for (const s of [child.stdout, child.stderr])
      s?.on("data", (c) => {
        output += String(c);
      });
    await expect
      .poll(
        async () =>
          (await fetch(`${server.origin}/api/projects`).catch(() => null))
            ?.ok === true,
        { timeout: 30000 },
      )
      .toBe(true);
    await expect.poll(() => output).toMatch(/serving on .*\(pid (\d+)\)/);
    const pidBefore = Number(/\(pid (\d+)\)/.exec(output)?.[1]);

    const page = await browser.newPage();
    await page.goto(server.url);
    await expect(heading(page, ROOT_TITLE)).toBeVisible();
    await markLoaded(page);

    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const source = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(source).toContain(needle);
    writeFileSync(
      routes,
      source.replace(
        needle,
        'return json({ projects: entries(ctx.projects), edited: "yes" });',
      ),
    );

    await expect
      .poll(() => output, { timeout: 20000 })
      .toMatch(/reusing the live server/);
    expect(output).toContain(`on port ${port}`);
    // The same process: no second "serving" line, and the first pid is alive.
    expect(output.match(/serving on/g)).toHaveLength(1);
    expect(() => process.kill(pidBefore, 0)).not.toThrow();
    await expect
      .poll(
        async () => {
          const res = await fetch(`${server.origin}/api/projects`).catch(
            () => null,
          );
          return ((await res?.json()) as { edited?: string } | undefined)
            ?.edited;
        },
        { timeout: 20000 },
      )
      .toBe("yes");

    expect(
      server.werk("add", "after", "--title", "After edit", "--parent", "root")
        .code,
    ).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({
      timeout: 20000,
    });
    expect(await stillLoaded(page)).toBe(true);
  } catch (error) {
    console.log("server output:\n", output);
    throw error;
  } finally {
    await browser.close();
    child?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await server.dispose();
  }
});

// ---------------------------------------------------------------- 14.3
test("14.3 In dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  expect(
    appCopy.werk("add", "idea", "--title", "A card title", "--parent", "root")
      .code,
  ).toBe(0);
  await page.goto(`${appCopy.url}/map/idea`);
  await expect(heading(page, "A card title")).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);

  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(heading(page, "A card title")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});

// ---------------------------------------------------------------- 17.x
const crumbs = (page: Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });

test("17.1 A person opens a deep card and follows the breadcrumbs back", async ({
  page,
  app,
}) => {
  appendMap(
    app,
    card("a", "root"),
    card("b", "a"),
    card("c", "b"),
    card("d", "c"),
  );
  // Give the left pane less than 700px.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(app.url);
  await expect(heading(page, ROOT_TITLE)).toBeVisible();
  const paneWidth = () =>
    leftPane(page).evaluate((el) => (el as HTMLElement).clientWidth);
  const chrome = 1100 - (await paneWidth());
  await page.setViewportSize({ width: chrome + 650, height: 800 });
  expect(await paneWidth()).toBeLessThan(700);

  // Home, then the deep card from the map, tile by tile.
  for (const [id] of [["a"], ["b"], ["c"], ["d"]] as const) {
    await leftPane(page).locator(`a.tile[data-card-id="${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/map/${id}$`));
  }
  await expect(heading(page, "Title d")).toBeVisible();

  const line = crumbs(page).locator("[data-slot=crumb-line]");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("… › Title c › Title d");
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  const current = line.locator("[data-slot=crumb-current]");
  await expect(current).toHaveText("Title d");
  expect(
    await current.evaluate((el) => Number(getComputedStyle(el).fontWeight)),
  ).toBeGreaterThanOrEqual(600);
  expect(await line.locator("strong").count()).toBe(1);

  await line.hover({ force: true });
  const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
  expect(full).toBe(`${ROOT_TITLE} › Title a › Title b › Title c › Title d`);

  await overlay.getByRole("button", { name: "Title c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(heading(page, "Title c")).toBeVisible();
  await page.mouse.move(5, 500);
  const after = crumbs(page).locator("[data-slot=crumb-line]");
  await expect(after.locator("[data-slot=crumb-current]")).toHaveText(
    "Title c",
  );
  expect(await after.locator("strong").count()).toBe(1);
});

/** Root decided; open o1; proto p1 with two open children; decided dec1; open base; decided st that is stale. */
function seedCounts(app: BrowserServer) {
  appendMap(
    app,
    decide("root"),
    card("o1", "root"),
    card("p1", "root", "proto"),
    card("p1a", "p1"),
    card("p1b", "p1"),
    card("dec1", "root"),
    decide("dec1"),
    card("base", "root"),
    decide("base"),
    card("st", "root"),
    dependsOn("st", "base"),
    decide("st"),
    reopen("base"),
  );
}

test("17.2 The header counts follow the open card", async ({ page, app }) => {
  seedCounts(app);
  await page.goto(`${app.url}/map/root`);
  await expect(heading(page, ROOT_TITLE)).toBeVisible();
  const counts = page.locator("[data-slot=counts] [data-slot=count]");
  const read = async () =>
    Object.fromEntries(
      await counts.evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute("data-kind"),
          {
            n: Number(el.textContent),
            title: el.getAttribute("title") ?? "",
          },
        ]),
      ),
    ) as Record<string, { n: number; title: string }>;
  await expect(counts.first()).toBeVisible();
  const root = await read();
  // root(decided) o1 p1 p1a p1b dec1 base st = 8 cards
  expect(root.total?.n).toBe(8);
  expect(root.open?.n).toBe(4);
  expect(root.proto?.n).toBe(1);
  expect(root.decided?.n).toBe(3);
  expect(
    (root.open?.n ?? 0) + (root.proto?.n ?? 0) + (root.decided?.n ?? 0),
  ).toBe(root.total?.n);
  expect(root.stale?.n).toBe(1);
  expect(root.open?.title).toMatch(/open/);
  expect(root.proto?.title).toMatch(/proto/);
  expect(root.decided?.title).toMatch(/decided/);

  // A subtree with no decided card shows no decided count.
  await leftPane(page).locator('a.tile[data-card-id="p1"]').click();
  await expect(heading(page, "Title p1")).toBeVisible();
  await expect(counts.first()).toBeVisible();
  await expect.poll(async () => (await read()).total?.n).toBe(3);
  const sub = await read();
  expect(sub.open?.n).toBe(2);
  expect(sub.proto?.n).toBe(1);
  expect(sub.decided).toBeUndefined();
  expect(sub.stale).toBeUndefined();
});

test("17.3 A person finds a card by id and opens it from the search box", async ({
  page,
  app,
}) => {
  const events: unknown[] = [
    decide("root"),
    ...card("werk", "root", "open", "The werk card"),
    ...card("base", "root"),
    ...decide("base"),
  ];
  for (let i = 1; i <= 7; i++) events.push(...card(`werk-${i}`, "root"));
  for (let i = 1; i <= 7; i++) events.push(...card(`x${i}-werk`, "root"));
  // werk-stale is stale and has an id that starts with "werk".
  events.push(...card("werk-stale", "root"));
  events.push(dependsOn("werk-stale", "base"), reopen("base"));
  appendMap(app, ...events);
  // base has to be decided before the edge and the reopen: rebuild in order.
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list).toBeVisible();
  const rows = list.locator("li");
  expect(await rows.count()).toBe(12);
  const first = rows.first();
  await expect(first.locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  const lastPrefix = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContains !== -1) expect(lastPrefix).toBeLessThan(firstContains);
  expect(ids.some((id) => !id.startsWith("werk"))).toBe(true);
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toBeEmpty();
    await expect(row.locator("code")).not.toBeEmpty();
  }
  const stale = list.locator("li", {
    has: page.locator("code", { hasText: /^werk-stale$/ }),
  });
  const dot = stale.locator("[data-slot=dot]");
  await expect(dot).toHaveAttribute("data-color", "stale");
  const rgb = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number) as [
    number,
    number,
    number,
  ];
  expect(r).toBeGreaterThan(g + 50);
  expect(r).toBeGreaterThan(b + 50);

  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");

  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(heading(page, "The werk card")).toBeVisible();
  await expect(crumbs(page).locator("strong")).toHaveText("The werk card");
  await expect(box).toHaveValue("");
});

test("17.4 A person switches between the Map and Board tabs", async ({
  page,
  app,
}) => {
  appendMap(app, ...card("k", "root", "open", "Card k"));
  await page.goto(`${app.url}/map/k`);
  await expect(heading(page, "Card k")).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  const tab = (name: string) => views.getByRole("button", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await expect(tab("Board")).not.toHaveAttribute("aria-current", "page");

  await tab("Board").click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator("[data-slot=board]")).toBeVisible();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await expect(tab("Map")).not.toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator("[data-slot=board]")).toBeVisible();

  await tab("Map").click();
  await expect(heading(page, "Card k")).toBeVisible();
  await expect(page).toHaveURL(/\/map\/k$/);
});

// ---------------------------------------------------------------- 44.x
const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

function builder(): ChildProcess {
  return spawn("sleep", ["300"], { stdio: "ignore" });
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

function writeTicket(
  app: BrowserServer,
  number: string,
  body: string,
  head = "cites: root\nblocked_by: \nstories: 77\ntouches: board view",
) {
  const dir = join(app.dir, ".werk", "tickets", "r");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${number}.md`), `title: T\n${head}\n\n${body}\n`);
}

/** Pane width helper: sets the viewport so the map pane is `width` wide. */
async function paneWidthIs(page: Page, width: number) {
  const pane = () =>
    page
      .getByRole("region", { name: "Map pane" })
      .evaluate((el) => (el as HTMLElement).clientWidth);
  const now = page.viewportSize()?.width ?? 1280;
  const chrome = now - (await pane());
  await page.setViewportSize({ width: width + chrome, height: 800 });
  await expect.poll(pane).toBe(width);
}

test("44.1 Tickets appear in their columns and a command line move redraws the board", async ({
  page,
  app,
}) => {
  mkdirSync(join(app.dir, ".werk"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      {
        type: "ticket.planned",
        id: "r/02",
        title: "Two blockers",
        blocked_by: ["r/06", "r/07"],
      },
      { type: "ticket.planned", id: "r/03", title: "Tried three times" },
      { type: "ticket.moved", id: "r/03", to: "building" },
      { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 3, result: "red" },
      {
        type: "ticket.planned",
        id: "r/04",
        title: "Blocked ticket",
        reason: "a cited card is stale",
      },
      { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
      { type: "ticket.moved", id: "r/05", to: "building" },
      { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
      { type: "ticket.planned", id: "r/06", title: "Open blocker one" },
      { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
    ),
  );
  await page.goto(`${app.url}/board`);
  const names = await page
    .locator("[data-slot=column]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
  await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
  await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
  await expect(cardsIn(page, "Ready")).toHaveText([
    /Two blockers/,
    /Open blocker one/,
    /Open blocker two/,
  ]);
  await expect(cardsIn(page, "Building")).toHaveText([/Tried three times/]);
  await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
  await expect(
    cardsIn(page, "Ready").first().locator("[data-slot=blockers]"),
  ).toHaveText("⊘2");
  await expect(
    cardsIn(page, "Building").locator("[data-slot=retries]"),
  ).toHaveText("↻3");

  await markLoaded(page);
  // The command line: the only verb that touches tickets is `werk ticket`.
  const moved = app.werk(
    "ticket",
    "move",
    "r/02",
    "building",
    "--actor",
    "you",
  );
  expect(moved.code, `werk ticket move: ${moved.stderr}`).toBe(0);
  await expect(cardsIn(page, "Building")).toHaveCount(2);
  await expect(
    cardsIn(page, "Building").filter({ hasText: "Two blockers" }),
  ).toHaveCount(1);
  await expect(
    cardsIn(page, "Ready").filter({ hasText: "Two blockers" }),
  ).toHaveCount(0);
  expect(await stillLoaded(page)).toBe(true);
});

test("44.2 A long title is cut on the card and shown in full in the drawer", async ({
  page,
  app,
}) => {
  mkdirSync(join(app.dir, ".werk"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "board.jsonl"),
    jsonl({ type: "ticket.planned", id: "r/02", title: LONG }),
  );
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`${app.url}/board`);
  const ticket = cardsIn(page, "Ready").first();
  const title = ticket.locator("[data-slot=ticket-title]");
  await expect(title).toBeVisible();
  const m = await title.evaluate((el) => {
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      natural: Math.round(el.scrollHeight / lh),
      shown: Math.round(el.clientHeight / lh),
      clamp: getComputedStyle(el).webkitLineClamp,
    };
  });
  // Precondition: the column is narrow enough for four lines.
  expect(m.natural).toBe(4);
  expect(m.shown).toBe(2);
  expect(m.clamp).toBe("2");
  expect(
    await title.evaluate((el) => getComputedStyle(el).textOverflow),
  ).toBeDefined();
  // A tooltip shows the full title.
  await expect(title).toHaveAttribute("title", LONG);

  await ticket.click();
  const drawer = page.getByRole("region", { name: "Ticket drawer" });
  await expect(drawer).toBeVisible();
  const boardBox = await page.locator("[data-slot=board]").boundingBox();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.y ?? 0).toBeGreaterThanOrEqual(
    (boardBox?.y ?? 0) + (boardBox?.height ?? 0) - 1,
  );
  const id = await drawer.locator("[data-slot=drawer-bar] code").boundingBox();
  const full = drawer.getByRole("heading", { name: LONG });
  await expect(full).toBeVisible();
  const fullBox = await full.boundingBox();
  await expect(drawer.locator("[data-slot=drawer-bar] code")).toHaveText(
    /r\/02/,
  );
  expect(fullBox?.y ?? 0).toBeGreaterThanOrEqual(
    (id?.y ?? 0) + (id?.height ?? 0) - 1,
  );
  // The full title is not cut in the drawer.
  expect(
    await full.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
});

test("44.3 A building ticket pulses only while its session process is alive", async ({
  page,
  app,
}) => {
  const proc = builder();
  const dead = spawn("true", [], { stdio: "ignore" });
  await new Promise((r) => dead.once("exit", r));
  try {
    mkdirSync(join(app.dir, ".werk"), { recursive: true });
    writeFileSync(
      join(app.dir, ".werk", "s1.jsonl"),
      jsonl({
        at: "2026-10-25T10:00:00.000Z",
        event: { type: "system", subtype: "init" },
      }),
    );
    writeFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl(
        { type: "ticket.planned", id: "r/03", title: LONG },
        { type: "ticket.moved", id: "r/03", to: "building" },
        {
          type: "build.started",
          id: "r/03",
          session: "s1",
          pid: proc.pid,
          log: "s1.jsonl",
        },
        {
          type: "ticket.planned",
          id: "r/04",
          title: "Building with no process",
        },
        { type: "ticket.moved", id: "r/04", to: "building" },
        {
          type: "build.started",
          id: "r/04",
          session: "s1",
          pid: dead.pid,
          log: "s1.jsonl",
        },
      ),
    );
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`${app.url}/board`);
    const live = cardsIn(page, "Building").filter({ hasText: "Import ticket" });
    const none = cardsIn(page, "Building").filter({
      hasText: "Building with no process",
    });
    const dot = live.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    await expect(none).toHaveCount(1);
    await expect(none.locator("[data-slot=live-dot]")).toHaveCount(0);

    const geometry = (cardLoc: typeof live) =>
      cardLoc.evaluate((c) => {
        const t = c.querySelector("[data-slot=ticket-title]") as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(t);
        const firstLine = range.getClientRects()[0] as DOMRect;
        const d = c.querySelector("[data-slot=live-dot]");
        const cr = c.getBoundingClientRect();
        const dr = d?.getBoundingClientRect();
        return {
          lineLeft: firstLine.left,
          titleLeft: t.getBoundingClientRect().left,
          cardLeft: cr.left,
          cardTop: cr.top,
          dotLeft: dr ? dr.left : null,
          dotRight: dr ? dr.right : null,
          dotTop: dr ? dr.top : null,
        };
      });
    const before = await geometry(live);
    expect(before.dotLeft).not.toBeNull();
    // top-left corner of the card
    expect((before.dotLeft ?? 0) - before.cardLeft).toBeLessThan(20);
    expect((before.dotTop ?? 0) - before.cardTop).toBeLessThan(20);
    // the first line starts a few pixels to the right of the dot
    const gap = before.lineLeft - (before.dotRight ?? 0);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(12);

    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const after = await geometry(live);
    expect(after.lineLeft).toBeCloseTo(after.titleLeft, 0);
    expect(after.lineLeft).toBeLessThan(before.lineLeft);
    await expect(none.locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 The drawer of a building ticket shows the live log, the sidebar and the decisions", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    const werk = join(app.dir, ".werk");
    appendMap(
      app,
      decide("root"),
      ...card("basis", "root", "open", "A decided basis"),
      ...decide("basis"),
    );
    writeTicket(
      app,
      "03",
      "## What to build\n\nThe ticket text of the building ticket.\n\n## Checks\n\n- `make test`",
      "cites: basis\nblocked_by: r/01\nstories: 77\ntouches: board view",
    );
    const events = [
      {
        at: "2026-10-25T10:00:00.000Z",
        event: { type: "system", subtype: "init" },
      },
    ];
    for (let i = 0; i < 40; i++) {
      events.push({
        at: `2026-10-25T10:${String(Math.floor(i / 2)).padStart(2, "0")}:${String((i % 2) * 20).padStart(2, "0")}.000Z`,
        event: {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: { command: `echo ${i}` },
              },
            ],
          },
        } as never,
      });
    }
    writeFileSync(join(werk, "s1.jsonl"), jsonl(...events));
    writeFileSync(
      join(werk, "board.jsonl"),
      jsonl(
        { type: "ticket.planned", id: "r/01", title: "Earlier ticket" },
        { type: "ticket.moved", id: "r/01", to: "building" },
        { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
        { type: "ticket.merge", id: "r/01" },
        {
          type: "ticket.planned",
          id: "r/03",
          title: "Build it",
          blocked_by: ["r/01"],
        },
        { type: "ticket.moved", id: "r/03", to: "building" },
        {
          type: "build.started",
          id: "r/03",
          session: "s1",
          pid: proc.pid,
          log: "s1.jsonl",
        },
        { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
        { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
      ),
    );
    appendMap(
      app,
      { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["basis"] },
      {
        type: "node.proposed",
        id: "role-format",
        kind: "card",
        title: "The role is a plain word",
        status: "open",
        parent: "root",
        obligation: "o1",
      },
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();

    const log = page.getByRole("region", { name: "Live log" });
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines).toHaveCount(41);
    const scroller = log.locator("[data-slot=live-log-lines]");
    const dims = await scroller.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
      overflow: getComputedStyle(el).overflowY,
    }));
    expect(dims.scroll).toBeGreaterThan(dims.client);
    expect(["auto", "scroll"]).toContain(dims.overflow);
    const text = page.locator("[data-slot=ticket-text]");
    await expect(text).toContainText("The ticket text of the building ticket.");
    const lb = await log.boundingBox();
    const tb = await text.boundingBox();
    expect((lb?.y ?? 0) + (lb?.height ?? 0)).toBeLessThanOrEqual(tb?.y ?? 0);
    const first = lines.first();
    await expect(first.locator("time")).toHaveText(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/,
    );
    await expect(lines.nth(1)).toContainText("tool Bash echo 0");

    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of [
      "Cites",
      "Blockers",
      "Retries",
      "Checks",
      "Stories",
      "Touches",
    ]) {
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("link", { name: "#basis" }).click();
    await expect(page).toHaveURL(/\/map\/basis$/);
    await expect(heading(page, "A decided basis")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Views" })
      .getByRole("button", { name: "Board" })
      .click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(cardsIn(page, "Building")).toHaveCount(1);
    // The board remembers the open ticket: click the card only when the drawer is shut.
    if (
      !(await page
        .getByRole("region", { name: "Ticket drawer" })
        .isVisible())
    )
      await cardsIn(page, "Building").click();
    const side2 = page.getByRole("complementary", { name: "Ticket details" });
    await side2.getByRole("button").click();
    await expect(side2).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveAttribute("data-mode", "rail");

    // The ticket leaves building.
    appendBoard(app, {
      type: "ticket.moved",
      id: "r/03",
      to: "ready",
      actor: "you",
    });
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText(
      "The ticket text of the building ticket.",
    );
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveCount(1);
  } finally {
    proc.kill();
  }
});

test("44.5 A narrow pane scrolls the board sideways and keeps columns readable", async ({
  page,
  app,
}) => {
  mkdirSync(join(app.dir, ".werk"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      { type: "ticket.planned", id: "r/02", title: "Ready ticket" },
      { type: "ticket.planned", id: "r/03", title: "Building ticket" },
      { type: "ticket.moved", id: "r/03", to: "building" },
      {
        type: "ticket.planned",
        id: "r/04",
        title: "Blocked ticket",
        reason: "stale",
      },
      { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
      { type: "ticket.moved", id: "r/05", to: "building" },
      { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
    ),
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${app.url}/board`);
  const board = page.locator("[data-slot=board]");
  await expect(board).toBeVisible();
  await paneWidthIs(page, 600);
  const measure = () =>
    board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      columns: [...el.querySelectorAll("[data-slot=column]")]
        .map((c) => c.getBoundingClientRect())
        .map((r) => ({ w: r.width, l: r.left, r: r.right })),
    }));
  const narrow = await measure();
  expect(narrow.scroll).toBeGreaterThan(narrow.client);
  expect(narrow.columns).toHaveLength(5);
  for (const c of narrow.columns) expect(c.w).toBeGreaterThanOrEqual(200);
  await expect(cardsIn(page, "Done")).toHaveCount(1);
  await board.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(cardsIn(page, "Done").first()).toBeInViewport();

  await paneWidthIs(page, 1600);
  const wide = await measure();
  expect(wide.scroll).toBeLessThanOrEqual(wide.client);
  const widths = wide.columns.map((c) => c.w);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  const sum = widths.reduce((a, b) => a + b, 0);
  // five columns share the full width (gaps and page padding aside)
  expect(sum).toBeGreaterThan(wide.client * 0.9);
});
