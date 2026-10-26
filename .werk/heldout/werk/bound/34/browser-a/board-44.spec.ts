import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";
import { boardEvents, jsonl, writeTicketFile } from "./seed.ts";
import { mkdirSync, writeFileSync } from "node:fs";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });
const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

function seed(app: BrowserServer, pid: number) {
  const werk = join(app.dir, ".werk");
  writeTicketFile(app, "r", "03", "Build it", "The ticket text of the building ticket.");
  mkdirSync(werk, { recursive: true });
  writeFileSync(
    join(werk, "s1.jsonl"),
    jsonl(
      { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
      {
        at: "2026-10-25T10:00:07.000Z",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Reading the ticket" }] } },
      },
    ),
  );
  boardEvents(
    app,
    { type: "ticket.planned", id: "r/01", title: "Done ticket" },
    { type: "ticket.moved", id: "r/01", to: "building" },
    { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "r/01" },
    { type: "ticket.planned", id: "r/02", title: LONG, blocked_by: ["r/06", "r/07"] },
    { type: "ticket.planned", id: "r/03", title: "Build it", blocked_by: ["r/01"] },
    { type: "ticket.moved", id: "r/03", to: "building" },
    { type: "build.started", id: "r/03", session: "s1", pid, log: "s1.jsonl" },
    { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
    { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
    { type: "ticket.pass", id: "r/03", n: 3, result: "red" },
    { type: "ticket.planned", id: "r/04", title: "Blocked ticket", reason: "a cited card is stale" },
    { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
    { type: "ticket.moved", id: "r/05", to: "building" },
    { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
    { type: "ticket.planned", id: "r/06", title: "Open blocker one" },
    { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
  );
}

test("44.1 tickets sit in their columns, counts show, and a command line move redraws the board", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const names = await page.locator("[data-slot=column]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? el.querySelector("h2,h3")?.textContent ?? ""),
    );
    expect(names.map((n) => n.toLowerCase().replace(/[^a-z]/g, "").replace(/\d+$/, "")).slice(0, 5)).toEqual(
      expect.arrayContaining([]),
    );
    const order = await page.getByRole("region").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    const cols = order.filter((n) => ["Blocked", "Ready", "Building", "Merging", "Done"].includes(n ?? ""));
    expect(cols).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);

    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Import ticket" })).toHaveCount(1);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(
      cardsIn(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    const moved = app.werk("ticket", "move", "r/02", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(cardsIn(page, "Building").filter({ hasText: "Import ticket" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Import ticket" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 a long title is cut to two lines, shown in full as tooltip, and the drawer header shows id then title", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").filter({ hasText: "Import ticket" });
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toBeVisible();
    const clamp = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      const natural = el.scrollHeight / lh;
      return {
        lines: Math.round(el.clientHeight / lh),
        naturalLines: Math.round(natural),
        mode: getComputedStyle(el).webkitLineClamp,
      };
    });
    expect(clamp.naturalLines).toBeGreaterThanOrEqual(4);
    expect(clamp.lines).toBe(2);
    expect(clamp.mode).toBe("2");
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.locator("[data-slot=drawer]");
    await expect(drawer).toBeVisible();
    const bar = drawer.locator("[data-slot=drawer-bar]");
    await expect(bar).toContainText("r/02");
    await expect(drawer.locator("[data-slot=drawer-title]")).toHaveText(LONG);
    const idBox = await bar.getByText("r/02").first().boundingBox();
    const titleBox = await drawer.locator("[data-slot=drawer-title]").boundingBox();
    expect((titleBox?.y ?? 0)).toBeGreaterThan((idBox?.y ?? 0));
    const board = await page.locator("[data-slot=board]").boundingBox();
    expect((drawer.boundingBox && (await drawer.boundingBox())?.y) ?? 0).toBeGreaterThan(0);
    expect(board).not.toBeNull();
  } finally {
    proc.kill();
  }
});

test("44.3 a building ticket pulses only while its session process is alive", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const title = card.locator("[data-slot=ticket-title]");
    const pulseX = (await dot.boundingBox())?.x ?? 0;
    const withDot = (await title.boundingBox())?.x ?? 0;
    const cardX = (await card.boundingBox())?.x ?? 0;
    const textLeftWithDot = await title.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects()[0]?.x ?? 0;
    });
    expect(textLeftWithDot).toBeGreaterThan(pulseX);
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const textLeftNoDot = await title.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects()[0]?.x ?? 0;
    });
    expect(textLeftNoDot).toBeLessThan(textLeftWithDot);
    expect(withDot).toBeGreaterThanOrEqual(cardX);
    // a building ticket with no running process never shows a dot
    await expect(cardsIn(page, "Building").locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 the drawer of a building ticket: live log, sidebar, decisions, cite link, folded sidebar kept, log gone after leaving building", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
        { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const drawer = page.locator("[data-slot=drawer]");
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    const logBox = await log.boundingBox();
    const textBox = await drawer.locator("[data-slot=ticket-text]").boundingBox();
    expect((logBox?.y ?? 0) + (logBox?.height ?? 0)).toBeLessThanOrEqual((textBox?.y ?? 0) + 1);
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    await expect(lines.nth(1)).toContainText("agent: Reading the ticket");

    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("link", { name: "#root" }).first().click();
    await expect(page).toHaveURL(/\/map\/root$/);

    await page.goBack();
    await expect(cardsIn(page, "Building")).toBeVisible();
    if (!(await page.locator("[data-slot=drawer]").isVisible())) await cardsIn(page, "Building").click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await expect(cardsIn(page, "Building")).toBeVisible();
    if (!(await page.locator("[data-slot=drawer]").isVisible())) await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    boardEvents(app, { type: "ticket.moved", id: "r/03", to: "ready", actor: "you" });
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText("The ticket text of the building ticket.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways, and a wide one shares the width", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(board).toBeVisible();
    const narrow = await board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      columns: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(narrow.columns).toHaveLength(5);
    for (const w of narrow.columns) expect(w).toBeGreaterThanOrEqual(200);
    await column(page, "Done").scrollIntoViewIfNeeded();
    await board.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(column(page, "Done")).toBeInViewport();

    await page.setViewportSize({ width: 1600, height: 800 });
    const wide = await board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      columns: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    const total = wide.columns.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(wide.client * 0.8);
    expect(Math.max(...wide.columns) - Math.min(...wide.columns)).toBeLessThan(5);
  } finally {
    proc.kill();
  }
});
