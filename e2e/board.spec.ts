import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";
import type { BrowserServer } from "./support/server.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

/** A process that lives until the test kills it. */
function builder(): ChildProcess {
  return spawn("sleep", ["300"], { stdio: "ignore" });
}

/** A project whose board log holds one ticket in each column, and a live builder for r/03. */
function seed(app: BrowserServer, pid: number) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  writeFileSync(
    join(werk, "s1.jsonl"),
    jsonl(
      {
        at: "2026-10-25T10:00:00.000Z",
        event: { type: "system", subtype: "init" },
      },
      {
        at: "2026-10-25T10:00:07.000Z",
        event: {
          type: "assistant",
          message: { content: [{ type: "text", text: "Reading the ticket" }] },
        },
      },
    ),
  );
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
        blocked_by: ["r/01", "r/06"],
      },
      { type: "ticket.planned", id: "r/03", title: "Build it" },
      { type: "ticket.moved", id: "r/03", to: "building" },
      {
        type: "build.started",
        id: "r/03",
        session: "s1",
        pid,
        log: "s1.jsonl",
      },
      { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
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
    ),
  );
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

test("each ticket of the board log shows in its column, and a move from the command line redraws the board", async ({
  page,
  app,
  evidence,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([
      /Import ticket/,
      /Open blocker/,
    ]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await evidence(page, "board");

    // r/02 waits for r/06, which is not done: one open blocker. r/03 has two red passes.
    await expect(
      cardsIn(page, "Ready").first().locator("[data-slot=blockers]"),
    ).toHaveText("⊘1");
    await expect(
      cardsIn(page, "Building").locator("[data-slot=retries]"),
    ).toHaveText("↻2");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.archived", id: "r/06" }),
    );
    await expect(cardsIn(page, "Ready")).toHaveCount(1);
    expect(app.werk("ticket", "restore", "r/06").code).toBe(0);
    await expect(cardsIn(page, "Ready")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => (window as unknown as { loaded?: boolean }).loaded,
      ),
    ).toBe(true);
  } finally {
    proc.kill();
  }
});

test("a long title shows two lines and an ellipsis, and the drawer shows it in full", async ({
  page,
  app,
  evidence,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`${app.url}/board`);
    const title = cardsIn(page, "Ready")
      .first()
      .locator("[data-slot=ticket-title]");
    await expect(title).toHaveAttribute("title", LONG);
    const clamp = await title.evaluate((el) => ({
      lines: Math.round(
        el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight),
      ),
      cut: el.scrollHeight > el.clientHeight,
      mode: getComputedStyle(el).webkitLineClamp,
    }));
    expect(clamp).toEqual({ lines: 2, cut: true, mode: "2" });
    await cardsIn(page, "Ready").first().click();
    await expect(page.getByRole("heading", { name: LONG })).toBeVisible();
    await evidence(page, "board-drawer");
  } finally {
    proc.kill();
  }
});

test("a building ticket pulses only while its session process is alive, and its drawer shows the live log", async ({
  page,
  app,
  evidence,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const dot = cardsIn(page, "Building").locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((el) => getComputedStyle(el).position)).toBe(
      "absolute",
    );

    await cardsIn(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    await expect(log).toContainText("agent: Reading the ticket");
    await expect(
      page.getByText("The ticket text of the building ticket."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Ticket drawer" })
        .locator("[data-slot=live-dot]"),
    ).toBeVisible();
    await evidence(page, "board-live-log");

    // The board log never says the session ended. Only the dead process stops the pulse.
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    await expect(
      page
        .getByRole("region", { name: "Ticket drawer" })
        .locator("[data-slot=live-dot]"),
    ).toHaveCount(0);

    // The log goes when the ticket leaves building.
    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(log).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("the toggles of the drawer are kept across a reload", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const side = page.getByRole("complementary", { name: "Ticket details" });
    await side.getByRole("button").click();
    await expect(side).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveAttribute("data-mode", "rail");
    await page.getByRole("button", { name: "Expand log" }).click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveCount(0);
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(
      page.getByRole("button", { name: "Shrink log" }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("a ticket whose build proposed a card lists that card in Decisions, and a click on a cite opens the card", async ({
  page,
  app,
  evidence,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
      jsonl(
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
        { type: "obligation.opened", id: "o2", ticket: "r/01", cites: [] },
        { type: "obligation.closed", id: "o2", cards: ["root"] },
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await evidence(page, "board-decisions");

    expect(app.werk("accept", "role-format", "--actor", "you").code).toBe(0);
    await expect(decisions).toContainText("accepted");

    await cardsIn(page, "Done").click();
    await expect(page.getByRole("region", { name: "Decisions" })).toContainText(
      "No new card. Followed #root.",
    );
    await page
      .getByRole("region", { name: "Ticket drawer" })
      .getByRole("link", { name: "#root" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/map\/root$/);
  } finally {
    proc.kill();
  }
});

test("at 600 pixels wide the board scrolls sideways and no column is under 200 pixels", async ({
  page,
  app,
  evidence,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(board).toBeVisible();
    const sizes = await board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      overflow: getComputedStyle(el).overflowX,
      columns: [...el.querySelectorAll("[data-slot=column]")].map(
        (c) => c.getBoundingClientRect().width,
      ),
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(sizes.overflow).toBe("auto");
    expect(sizes.columns).toHaveLength(5);
    for (const width of sizes.columns)
      expect(width).toBeGreaterThanOrEqual(200);
    await evidence(page, "board-narrow");
  } finally {
    proc.kill();
  }
});
