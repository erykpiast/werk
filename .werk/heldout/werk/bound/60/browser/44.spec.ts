import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess =>
  spawn("sleep", ["300"], { stdio: "ignore" });

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
        blocked_by: ["r/01", "r/06", "r/07"],
      },
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
        pid,
        log: "s1.jsonl",
      },
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
      { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
    ),
  );
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

test("44.1 columns, counts, and a command line move", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const names = await page
      .locator("[data-slot=column]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([
      /Import ticket/,
      /Open blocker/,
      /Open blocker two/,
    ]);
    await expect(
      cardsIn(page, "Ready").first().locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(
      cardsIn(page, "Building").locator("[data-slot=retries]"),
    ).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    const moved = app.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(
      cardsIn(page, "Building").filter({ hasText: "Open blocker" }),
    ).toHaveCount(2);
    await expect(
      cardsIn(page, "Ready").filter({ hasText: /^Open blocker$/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { loaded?: boolean }).loaded,
      ),
    ).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 long title clamps, tooltip, drawer header", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    const info = await title.evaluate((el) => {
      const cs = getComputedStyle(el);
      const lh = Number.parseFloat(cs.lineHeight);
      return {
        lines: Math.round(el.clientHeight / lh),
        full: Math.round(el.scrollHeight / lh),
        cut: el.scrollHeight > el.clientHeight,
        clamp: cs.webkitLineClamp,
        overflow: cs.overflow,
      };
    });
    expect(info.full).toBeGreaterThanOrEqual(3);
    expect(info.lines).toBe(2);
    expect(info.clamp).toBe("2");
    expect(info.cut).toBe(true);
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const bar = drawer.locator("[data-slot=drawer-bar]");
    const h = drawer.locator("[data-slot=drawer-title]");
    await expect(bar).toContainText("r/02");
    await expect(h).toHaveText(LONG);
    const [b, t] = await Promise.all([bar.boundingBox(), h.boundingBox()]);
    expect(t!.y).toBeGreaterThanOrEqual(b!.y + b!.height - 1);
    const drawerBox = await drawer.boundingBox();
    const boardBox = await page.locator("[data-slot=board]").boundingBox();
    expect(drawerBox!.y).toBeGreaterThanOrEqual(
      boardBox!.y + boardBox!.height - 2,
    );
  } finally {
    proc.kill();
  }
});

test("44.3 pulse only while process is alive", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    const title = card.locator("[data-slot=ticket-title]");
    await expect(dot).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const dotBox = (await dot.boundingBox())!;
    expect(dotBox.x - cardBox.x).toBeLessThan(20);
    expect(dotBox.y - cardBox.y).toBeLessThan(20);
    const withDot = await title.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects()[0].left;
    });
    expect(withDot).toBeGreaterThanOrEqual(dotBox.x + dotBox.width - 1);
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const without = await title.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects()[0].left;
    });
    expect(without).toBeLessThan(withDot);
    // a building ticket with no running process never shows a dot
    await expect(
      cardsIn(page, "Merging").locator("[data-slot=live-dot]"),
    ).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 drawer of a building ticket", async ({ page, app }) => {
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
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    const lh = await log
      .locator("[data-slot=live-log-lines]")
      .evaluate((e) => getComputedStyle(e).height);
    expect(Number.parseFloat(lh)).toBeGreaterThan(0);
    const logBox = (await log.boundingBox())!;
    const textBox = (await page
      .locator("[data-slot=ticket-text]")
      .boundingBox())!;
    expect(logBox.y).toBeLessThan(textBox.y);
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const k of [
      "Cites",
      "Blockers",
      "Retries",
      "Checks",
      "Stories",
      "Touches",
    ])
      await expect(side.getByLabel(k, { exact: true }).first()).toBeVisible();
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await side.getByRole("link", { name: "#root" }).first().click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goBack();
    await expect(page.locator("[data-slot=board]")).toBeVisible();
    if ((await cardsIn(page, "Building").getAttribute("aria-pressed")) !== "true")
      await cardsIn(page, "Building").click();
    await page
      .getByRole("complementary", { name: "Ticket details" })
      .getByRole("button")
      .click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveAttribute("data-mode", "rail");
    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText(
      "The ticket text of the building ticket.",
    );
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 narrow pane scrolls, wide pane shares width", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    const m = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cols: [...el.querySelectorAll("[data-slot=column]")].map(
          (c) => c.getBoundingClientRect().width,
        ),
      }));
    const narrow = await m();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(narrow.cols).toHaveLength(5);
    for (const w of narrow.cols) expect(w).toBeGreaterThanOrEqual(200);
    await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(column(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    const wide = await m();
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    const sum = wide.cols.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(wide.client * 0.9);
  } finally {
    proc.kill();
  }
});
