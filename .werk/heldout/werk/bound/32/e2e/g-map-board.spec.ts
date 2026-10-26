import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  decided,
  jsonl,
  type MapServer,
  open,
  ROOT_DECIDED,
  startMapServer,
} from "./support-map.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

let server: MapServer;
const procs: ChildProcess[] = [];
test.afterEach(async () => {
  for (const p of procs.splice(0)) p.kill();
  await server?.dispose();
});

/** A process that lives until the test kills it. */
function builder(): ChildProcess {
  const p = spawn("sleep", ["300"], { stdio: "ignore" });
  procs.push(p);
  return p;
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

const planned = (n: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id: `r/${n}`,
  title,
  ...extra,
});
const moved = (n: string, to: string, actor?: string) => ({
  type: "ticket.moved",
  id: `r/${n}`,
  to,
  ...(actor ? { actor } : {}),
});
const doneTicket = (n: string, title: string) => [
  planned(n, title),
  moved(n, "building"),
  moved(n, "merging", "loop"),
  { type: "ticket.merge", id: `r/${n}` },
];
const pass = (n: string, k: number, result = "red") => ({
  type: "ticket.pass",
  id: `r/${n}`,
  n: k,
  result,
});

/** One ticket in each column, for 44.1 and 44.5. */
const FIVE = [
  ...doneTicket("01", "Done ticket"),
  planned("02", "Waits for two", { blocked_by: ["r/06", "r/07"] }),
  planned("03", "Tried three times"),
  moved("03", "building"),
  pass("03", 1),
  pass("03", 2),
  pass("03", 3),
  planned("04", "Blocked ticket", { reason: "a cited card is stale" }),
  planned("05", "Merging ticket"),
  moved("05", "building"),
  moved("05", "merging", "loop"),
  planned("06", "First open blocker"),
  planned("07", "Second open blocker"),
  planned("08", "Ready to build"),
];

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({
  page,
}) => {
  server = await startMapServer({ log: [ROOT_DECIDED], board: FIVE });
  await server.start();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`${server.url}/board`);

  const headings = await page
    .locator("[data-slot=column] h3")
    .evaluateAll((hs) => hs.map((h) => h.firstChild?.textContent?.trim()));
  expect(headings).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
  await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
  await expect(cardsIn(page, "Ready")).toHaveText([
    /Waits for two/,
    /First open blocker/,
    /Second open blocker/,
    /Ready to build/,
  ]);
  await expect(cardsIn(page, "Building")).toHaveText([/Tried three times/]);
  await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
  await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
  await expect(
    cardsIn(page, "Ready").first().locator("[data-slot=blockers]"),
  ).toHaveText("⊘2");
  await expect(
    cardsIn(page, "Building").locator("[data-slot=retries]"),
  ).toHaveText("↻3");

  await page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
  // The CLI has no verb that moves a ticket (only `ticket restore`), so this appends the event
  // that a move writes, with the actor "you".
  const help = server.werk("ticket", "move", "r/08", "building");
  expect(help.code).not.toBe(0);
  appendFileSync(
    join(server.dir, ".werk", "board.jsonl"),
    jsonl(moved("08", "building", "you")),
  );
  await expect(cardsIn(page, "Building")).toHaveCount(2);
  await expect(cardsIn(page, "Building").filter({ hasText: "Ready to build" })).toHaveCount(1);
  await expect(cardsIn(page, "Ready").filter({ hasText: "Ready to build" })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
  ).toBe(true);
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({
  page,
}) => {
  server = await startMapServer({
    log: [ROOT_DECIDED],
    board: [planned("02", LONG)],
  });
  await server.start();
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${server.url}/board`);
  const card = cardsIn(page, "Ready").first();
  const title = card.locator("[data-slot=ticket-title]");
  await expect(title).toBeVisible();
  const m = await title.evaluate((el) => {
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      shown: Math.round(el.clientHeight / lh),
      needed: Math.round(el.scrollHeight / lh),
      clamp: getComputedStyle(el).webkitLineClamp,
    };
  });
  expect(m.needed).toBeGreaterThanOrEqual(4);
  expect(m.shown).toBe(2);
  expect(m.clamp).toBe("2");
  await title.hover();
  // A native tooltip is not in the page; its text is the title attribute.
  await expect(title).toHaveAttribute("title", LONG);

  await card.click();
  const drawer = page.getByRole("region", { name: "Ticket drawer" });
  await expect(drawer).toBeVisible();
  const board = await page.locator("[data-slot=board]").boundingBox();
  const box = await drawer.boundingBox();
  expect((box?.y ?? 0) >= (board?.y ?? 0) + (board?.height ?? 0) - 1).toBe(true);
  const id = drawer.locator("header code");
  const full = drawer.getByRole("heading", { name: LONG });
  await expect(id).toHaveText("r/02");
  await expect(full).toHaveText(LONG);
  const idBox = await id.boundingBox();
  const fullBox = await full.boundingBox();
  expect((fullBox?.y ?? 0) >= (idBox?.y ?? 0) + (idBox?.height ?? 0) - 1).toBe(true);
});

/** The left of the first line of the title text, and the left of the title element. */
const textLeft = (title: Locator) =>
  title.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return {
      text: range.getClientRects()[0]?.left ?? Number.NaN,
      element: el.getBoundingClientRect().left,
    };
  });

test("44.3 a building ticket pulses only while its session process is alive", async ({
  page,
}) => {
  const alive = builder();
  const gone = spawn("sleep", ["300"], { stdio: "ignore" });
  const gonePid = gone.pid as number;
  gone.kill();
  await new Promise((r) => gone.once("exit", r));
  server = await startMapServer({
    log: [ROOT_DECIDED],
    files: { ".werk/s1.jsonl": "", ".werk/s2.jsonl": "" },
    board: [
      planned("03", "Live builder"),
      moved("03", "building"),
      {
        type: "build.started",
        id: "r/03",
        session: "s1",
        pid: alive.pid,
        log: "s1.jsonl",
      },
      planned("04", "Dead builder"),
      moved("04", "building"),
      {
        type: "build.started",
        id: "r/04",
        session: "s2",
        pid: gonePid,
        log: "s2.jsonl",
      },
      planned("05", "No builder at all"),
      moved("05", "building"),
    ],
  });
  await server.start();
  await page.goto(`${server.url}/board`);
  const live = cardsIn(page, "Building").filter({ hasText: "Live builder" });
  const dot = live.locator("[data-slot=live-dot]");
  await expect(dot).toBeVisible();
  // A building ticket with no running process never shows a dot.
  await expect(
    cardsIn(page, "Building").filter({ hasText: "Dead builder" }).locator("[data-slot=live-dot]"),
  ).toHaveCount(0);
  await expect(
    cardsIn(page, "Building").filter({ hasText: "No builder at all" }).locator("[data-slot=live-dot]"),
  ).toHaveCount(0);

  const cardBox = (await live.boundingBox()) as { x: number; y: number };
  const dotBox = (await dot.boundingBox()) as {
    x: number;
    y: number;
    width: number;
  };
  expect(dotBox.x - cardBox.x).toBeLessThan(24);
  expect(dotBox.y - cardBox.y).toBeLessThan(24);
  const title = live.locator("[data-slot=ticket-title]");
  const before = await textLeft(title);
  const gap = before.text - (dotBox.x + dotBox.width);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(16);
  expect(before.text).toBeGreaterThan(before.element + 4);

  alive.kill();
  await expect(dot).toHaveCount(0, { timeout: 15000 });
  const after = await textLeft(title);
  expect(Math.abs(after.text - after.element)).toBeLessThan(1);
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({
  page,
}) => {
  const alive = builder();
  const lines = Array.from({ length: 60 }, (_, i) => ({
    at: `2026-10-25T10:${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}.000Z`,
    event: {
      type: "assistant",
      message: { content: [{ type: "text", text: `Step number ${i}` }] },
    },
  }));
  server = await startMapServer({
    log: [
      ROOT_DECIDED,
      decided("cited", { parent: "root", title: "A cited card" }),
      { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["cited"] },
      {
        type: "node.proposed",
        id: "role-format",
        kind: "card",
        title: "The role is a plain word",
        status: "open",
        parent: "root",
        obligation: "o1",
      },
    ],
    files: {
      ".werk/s1.jsonl": jsonl(...lines),
      ".werk/tickets/r/03.md":
        "title: Build it\ncites: cited\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Checks\n\n- `make test`\n",
    },
    board: [
      ...doneTicket("01", "Done blocker"),
      ...doneTicket("02", "Second done blocker"),
      planned("03", "Build it", { blocked_by: ["r/01", "r/02"] }),
      moved("03", "building"),
      {
        type: "build.started",
        id: "r/03",
        session: "s1",
        pid: alive.pid,
        log: "s1.jsonl",
      },
      pass("03", 1),
      pass("03", 2),
    ],
  });
  await server.start();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`${server.url}/board`);
  const card = cardsIn(page, "Building");
  await card.click();
  const drawer = page.getByRole("region", { name: "Ticket drawer" });
  const log = drawer.getByRole("region", { name: "Live log" });
  await expect(log).toBeVisible();
  const linesBox = log.locator("[data-slot=live-log-lines]");
  await expect(log.locator("[data-slot=log-line]")).toHaveCount(60);
  const dims = await linesBox.evaluate((el) => ({
    h: el.clientHeight,
    s: el.scrollHeight,
  }));
  expect(dims.s).toBeGreaterThan(dims.h);
  const logBox = (await log.boundingBox()) as { y: number; height: number };
  const textBox = (await drawer
    .locator("[data-slot=ticket-text]")
    .boundingBox()) as { y: number };
  expect(logBox.y + logBox.height).toBeLessThanOrEqual(textBox.y + 1);
  await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
  await expect(log.locator("[data-slot=log-line]").first()).toContainText(
    "agent: Step number 0",
  );

  const side = drawer.getByRole("complementary", { name: "Ticket details" });
  for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
    await expect(side.getByRole("region", { name })).toBeVisible();
  }
  await expect(side.getByRole("region", { name: "Cites" })).toContainText("#cited");
  await expect(side.getByRole("region", { name: "Blockers" })).toContainText("r/01");
  await expect(side.getByRole("region", { name: "Blockers" })).toContainText("r/02");
  await expect(side.getByRole("region", { name: "Retries" })).toContainText("2");
  await expect(side.getByRole("region", { name: "Checks" })).toContainText("make test");
  await expect(side.getByRole("region", { name: "Stories" })).toContainText("77");
  await expect(side.getByRole("region", { name: "Touches" })).toContainText("board view");
  const decisions = side.getByRole("region", { name: "Decisions" });
  await expect(decisions).toContainText("#role-format");
  await expect(decisions).toContainText("proposal");

  await side.getByRole("link", { name: "#cited" }).click();
  await expect(page).toHaveURL(/\/map\/cited$/);

  await page.goBack();
  await expect(cardsIn(page, "Building")).toHaveCount(1);
  if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0)
    await cardsIn(page, "Building").click();
  await page
    .getByRole("complementary", { name: "Ticket details" })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("complementary", { name: "Ticket details" }),
  ).toHaveAttribute("data-mode", "rail");
  await page.reload();
  if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0)
    await cardsIn(page, "Building").click();
  await expect(
    page.getByRole("complementary", { name: "Ticket details" }),
  ).toHaveAttribute("data-mode", "rail");

  // The ticket leaves building: the log goes, the text and the sidebar stay.
  appendFileSync(
    join(server.dir, ".werk", "board.jsonl"),
    jsonl(moved("03", "ready", "you")),
  );
  await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
  await expect(page.locator("[data-slot=ticket-text]")).toContainText(
    "The ticket text of the building ticket.",
  );
  const rail = page.getByRole("complementary", { name: "Ticket details" });
  await expect(rail).toBeVisible();
  await rail.getByRole("button").click();
  await expect(rail.getByRole("region", { name: "Cites" })).toContainText("#cited");
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({
  page,
}) => {
  server = await startMapServer({ log: [ROOT_DECIDED], board: FIVE });
  await server.start();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(`${server.url}/board`);
  const board = page.locator("[data-slot=board]");
  await expect(board).toBeVisible();
  const measure = () =>
    board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      right: el.getBoundingClientRect().right,
      left: el.getBoundingClientRect().left,
      columns: [...el.querySelectorAll("[data-slot=column]")].map((c) => {
        const r = c.getBoundingClientRect();
        return { w: r.width, left: r.left, right: r.right };
      }),
    }));
  const narrow = await measure();
  expect(narrow.scroll).toBeGreaterThan(narrow.client);
  expect(narrow.columns).toHaveLength(5);
  for (const c of narrow.columns) expect(c.w).toBeGreaterThanOrEqual(200);
  const done = column(page, "Done");
  expect((await done.boundingBox())?.x).toBeGreaterThan(600 - 50);
  await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const end = await measure();
  const lastColumn = end.columns[4] as { right: number };
  expect(lastColumn.right).toBeLessThanOrEqual(end.right + 1);
  await expect(done.locator("h3")).toBeInViewport();

  await page.setViewportSize({ width: 1600, height: 800 });
  await expect
    .poll(async () => {
      const m = await measure();
      return m.scroll <= m.client;
    })
    .toBe(true);
  const wide = await measure();
  const first = wide.columns[0] as { left: number };
  const last = wide.columns[4] as { right: number };
  expect(Math.abs(first.left - wide.left)).toBeLessThan(2);
  expect(wide.right - last.right).toBeLessThan(4);
  const widths = wide.columns.map((c) => c.w);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
});
