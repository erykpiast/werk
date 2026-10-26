import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { type BrowserServer, expect, jsonl, test } from "./support.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

/** A process that lives until the test kills it: the builder of a building ticket. */
function builder(): ChildProcess {
  return spawn("sleep", ["300"], { stdio: "ignore" });
}

const decideRoot = () => [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];

const TICKET_TEXT =
  "title: Build it\ncites: root\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n";

/** Board log: one ticket in every column. r/02 has two open blockers, r/03 has three red passes and a live builder. */
function seed(s: BrowserServer, pid: number | null) {
  const werk = join(s.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(join(werk, "tickets", "r", "03.md"), TICKET_TEXT);
  const t = (n: number, s2: string) => ({
    at: `2026-10-25T10:00:${String(n).padStart(2, "0")}.000Z`,
    event: s2,
  });
  const lines = [
    { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
  ];
  for (let i = 1; i <= 12; i++) {
    lines.push({
      at: `2026-10-25T10:00:${String(i).padStart(2, "0")}.000Z`,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: `Step ${i} of the work` }] },
      },
    } as never);
  }
  void t;
  writeFileSync(join(werk, "s1.jsonl"), jsonl(...lines));
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      {
        type: "ticket.planned",
        id: "r/02",
        title: LONG,
        blocked_by: ["r/06", "r/07"],
      },
      { type: "ticket.planned", id: "r/03", title: "Build it", blocked_by: ["r/01"] },
      { type: "ticket.moved", id: "r/03", to: "building" },
      ...(pid === null
        ? []
        : [
            {
              type: "build.started",
              id: "r/03",
              session: "s1",
              pid,
              log: "s1.jsonl",
            },
          ]),
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
      { type: "ticket.planned", id: "r/06", title: "Open blocker" },
      { type: "ticket.planned", id: "r/07", title: "Another blocker" },
    ),
  );
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

/** The drawer of the building ticket is open: it stays open across the tabs, and a reload closes it. */
async function ensureDrawer(page: Page) {
  const card = cardsIn(page, "Building");
  await expect(card).toBeVisible();
  const drawer = page.getByRole("region", { name: "Ticket drawer" });
  const shown = await drawer
    .waitFor({ timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) await card.click();
  await expect(drawer).toBeVisible();
}

async function withBoard(
  make: (o?: { seed?: (s: BrowserServer) => void }) => Promise<BrowserServer>,
  extra: (s: BrowserServer) => void = () => {},
  alive = true,
) {
  const proc = alive ? builder() : null;
  const s = await make({
    seed: (srv) => {
      seed(srv, proc ? (proc.pid as number) : null);
      extra(srv);
    },
  });
  return { s, proc };
}

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make);
  try {
    await page.goto(`${s.url}/board`);
    const cols = page.locator("[data-slot=column]");
    await expect(cols).toHaveCount(5);
    expect(await cols.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Blocked",
      "Ready",
      "Building",
      "Merging",
      "Done",
    ]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([/Import ticket/, /Open blocker/, /Another blocker/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
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
    const moved = s.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(cardsIn(page, "Building")).toHaveCount(2);
    await expect(
      column(page, "Ready").locator("[data-slot=ticket-card]", { hasText: "Open blocker" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
    ).toBe(true);
  } finally {
    proc?.kill();
  }
});

// Informational: the same redraw, with the move written to the board log by hand
// because the command line has no ticket move.
test("44.1b the board redraws without a reload when the board log moves a ticket", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make);
  try {
    await page.goto(`${s.url}/board`);
    await expect(cardsIn(page, "Ready")).toHaveCount(3);
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    appendFileSync(
      join(s.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/06", to: "building", actor: "you" }),
    );
    await expect(cardsIn(page, "Building")).toHaveCount(2);
    await expect(cardsIn(page, "Ready")).toHaveCount(2);
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
    ).toBe(true);
  } finally {
    proc?.kill();
  }
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make);
  try {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${s.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveText(LONG);
    const m = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      return {
        shown: Math.round(el.clientHeight / lh),
        natural: Math.round(el.scrollHeight / lh),
        cut: el.scrollHeight > el.clientHeight,
        overflow: getComputedStyle(el).overflow,
        ellipsis: getComputedStyle(el).textOverflow,
        clamp: getComputedStyle(el).webkitLineClamp,
      };
    });
    // The column is narrow: the full title needs at least four lines.
    expect(m.natural).toBeGreaterThanOrEqual(4);
    expect(m.shown).toBe(2);
    expect(m.cut).toBe(true);
    expect(m.clamp).toBe("2");
    // The tooltip is the title attribute.
    await title.hover();
    await expect(title).toHaveAttribute("title", LONG);

    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const board = page.locator("[data-slot=board]");
    const bb = (await board.boundingBox())!;
    const db = (await drawer.boundingBox())!;
    expect(db.y).toBeGreaterThanOrEqual(bb.y + bb.height - 2);
    const id = drawer.locator("[data-slot=drawer-bar] code");
    const heading = drawer.getByRole("heading", { name: LONG });
    await expect(id).toHaveText("r/02");
    await expect(heading).toBeVisible();
    const ib = (await id.boundingBox())!;
    const hb = (await heading.boundingBox())!;
    expect(hb.y).toBeGreaterThanOrEqual(ib.y + ib.height - 1);
  } finally {
    proc?.kill();
  }
});

/** The x of the first character of the title, in the card. */
const firstLineLeft = (page: Page) =>
  page
    .locator("[data-column=building] [data-slot=ticket-title]")
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      const text = el.firstChild as Text;
      range.setStart(text, 0);
      range.setEnd(text, 1);
      return range.getBoundingClientRect().left;
    });

test("44.3 a building ticket pulses only while its session process is alive", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make, (srv) => {
    // r/08 is building and its session names a process that does not run.
    appendFileSync(
      join(srv.dir, ".werk", "board.jsonl"),
      jsonl(
        { type: "ticket.planned", id: "r/08", title: "No process" },
        { type: "ticket.moved", id: "r/08", to: "building" },
      ),
    );
  });
  try {
    await page.goto(`${s.url}/board`);
    const alive = cardsIn(page, "Building").filter({ hasText: "Build it" });
    const idle = cardsIn(page, "Building").filter({ hasText: "No process" });
    const dot = alive.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    await expect(idle.locator("[data-slot=live-dot]")).toHaveCount(0);
    const cardBox = (await alive.boundingBox())!;
    const dotBox = (await dot.boundingBox())!;
    expect(dotBox.x - cardBox.x).toBeLessThan(24);
    expect(dotBox.y - cardBox.y).toBeLessThan(24);
    const withDot = await alive
      .locator("[data-slot=ticket-title]")
      .evaluate((el) => {
        const range = document.createRange();
        const text = el.firstChild as Text;
        range.setStart(text, 0);
        range.setEnd(text, 1);
        return range.getBoundingClientRect().left;
      });
    expect(withDot).toBeGreaterThan(dotBox.x + dotBox.width - 1);
    expect(withDot - (dotBox.x + dotBox.width)).toBeLessThan(20);

    // Kill the builder from outside. Nothing writes a session end.
    proc?.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const without = await alive
      .locator("[data-slot=ticket-title]")
      .evaluate((el) => {
        const range = document.createRange();
        const text = el.firstChild as Text;
        range.setStart(text, 0);
        range.setEnd(text, 1);
        return range.getBoundingClientRect().left;
      });
    expect(without).toBeLessThan(withDot);
    const cardNow = (await alive.boundingBox())!;
    // The title sits at the card's left padding, as in a card with no process.
    const idleLeft = await idle.locator("[data-slot=ticket-title]").evaluate((el) => {
      const range = document.createRange();
      const text = el.firstChild as Text;
      range.setStart(text, 0);
      range.setEnd(text, 1);
      return range.getBoundingClientRect().left;
    });
    expect(Math.abs(without - cardNow.x - (idleLeft - (await idle.boundingBox())!.x))).toBeLessThan(2);
    await expect(idle.locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc?.kill();
  }
  void firstLineLeft;
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make, (srv) => {
    appendFileSync(
      join(srv.dir, ".werk", "log.jsonl"),
      jsonl(
        ...decideRoot(),
        {
          type: "obligation.opened",
          id: "o1",
          ticket: "r/03",
          cites: ["root"],
        },
        {
          type: "node.proposed",
          id: "role-format",
          kind: "card",
          title: "The role is a plain word",
          status: "open",
          parent: "root",
          obligation: "o1",
        },
      ),
    );
  });
  try {
    await page.goto(`${s.url}/board`);
    await cardsIn(page, "Building").click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = drawer.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines).toHaveCount(13);
    // A fixed-height log above the ticket text.
    const lb = (await log.boundingBox())!;
    const tb = (await drawer.locator("[data-slot=ticket-text]").boundingBox())!;
    expect(lb.y + lb.height).toBeLessThanOrEqual(tb.y + 1);
    const scroller = log.locator("[data-slot=live-log-lines]");
    const overflow = await scroller.evaluate((el) => ({
      h: el.clientHeight,
      sh: el.scrollHeight,
      ov: getComputedStyle(el).overflowY,
    }));
    expect(overflow.sh).toBeGreaterThan(overflow.h);
    expect(["auto", "scroll"]).toContain(overflow.ov);
    await expect(lines.first().locator("time")).toHaveText("2026-10-25 10:00:00");
    await expect(lines.nth(1)).toContainText("agent: Step 1 of the work");
    await expect(drawer.getByText("The ticket text of the building ticket.")).toBeVisible();

    const side = drawer.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    const decisions = side.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("region", { name: "Cites" }).getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);

    // Back on the board, open the drawer again and fold the sidebar.
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board/);
    await ensureDrawer(page);
    const side2 = page.getByRole("complementary", { name: "Ticket details" });
    await expect(side2).toHaveAttribute("data-mode", "full");
    await side2.getByRole("button").click();
    await expect(side2).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await ensureDrawer(page);
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    // The ticket leaves building: the log goes, the text and the sidebar stay.
    appendFileSync(
      join(s.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "merging", actor: "loop" }),
    );
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc?.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({
  page,
  make,
}) => {
  const { s, proc } = await withBoard(make);
  try {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${s.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(board).toBeVisible();
    const sizes = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        overflow: getComputedStyle(el).overflowX,
        columns: [...el.querySelectorAll("[data-slot=column]")].map(
          (c) => c.getBoundingClientRect().width,
        ),
      }));
    const narrow = await sizes();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(["auto", "scroll"]).toContain(narrow.overflow);
    expect(narrow.columns).toHaveLength(5);
    for (const w of narrow.columns) expect(w).toBeGreaterThanOrEqual(200);

    const done = column(page, "Done");
    await board.hover();
    await page.mouse.wheel(2000, 0);
    await expect
      .poll(async () => {
        const d = (await done.boundingBox())!;
        const b = (await board.boundingBox())!;
        return d.x + d.width <= b.x + b.width + 1;
      })
      .toBe(true);

    await page.setViewportSize({ width: 1600, height: 800 });
    await expect
      .poll(async () => {
        const w = await sizes();
        return w.scroll <= w.client;
      })
      .toBe(true);
    const wide = await sizes();
    const total = wide.columns.reduce((a, b) => a + b, 0);
    // The five columns share the full width (gaps and padding aside).
    expect(total).toBeGreaterThan(wide.client * 0.85);
    const min = Math.min(...wide.columns);
    const max = Math.max(...wide.columns);
    expect(max - min).toBeLessThan(2);
  } finally {
    proc?.kill();
  }
});
