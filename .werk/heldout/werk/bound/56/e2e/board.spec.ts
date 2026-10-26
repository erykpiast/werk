import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const LONG = "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });

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
      { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
      { at: "2026-10-25T10:00:07.000Z", event: { type: "assistant", message: { content: [{ type: "text", text: "Reading the ticket" }] } } },
      ...Array.from({ length: 30 }, (_, i) => ({
        at: `2026-10-25T10:01:${String(i).padStart(2, "0")}.000Z`,
        event: { type: "assistant", message: { content: [{ type: "text", text: `Step ${i}` }] } },
      })),
    ),
  );
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
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
    ),
  );
}
const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) => column(page, name).locator("[data-slot=ticket-card]");
const drawer = (page: Page) => page.getByRole("region", { name: "Ticket drawer" });

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const names = await page.locator("[data-slot=board] [data-slot=column]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("h2,h3")?.textContent ?? ""));
    expect(names.map((n) => n.toLowerCase().trim().split(/\s+/)[0])).toEqual(["blocked", "ready", "building", "merging", "done"]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");
    await page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
    const moved = app.werk("ticket", "move", "r/06", "building");
    expect(moved.code).toBe(0);
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").filter({ hasText: "Import ticket" });
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveAttribute("title", LONG);
    const clamp = await title.evaluate((el) => ({
      lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
      fullLines: Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    }));
    expect(clamp.fullLines).toBeGreaterThanOrEqual(3);
    expect(clamp.lines).toBe(2);
    expect(clamp.cut).toBe(true);
    await card.click();
    const heading = drawer(page).getByRole("heading", { name: LONG });
    await expect(heading).toBeVisible();
    const box = await drawer(page).boundingBox();
    const board = await page.locator("[data-slot=board]").boundingBox();
    expect((box?.y ?? 0)).toBeGreaterThanOrEqual((board?.y ?? 0) + (board?.height ?? 0) - 2);
    await expect(drawer(page)).toContainText("r/02");
    const idBox = await drawer(page).getByText("r/02", { exact: false }).first().boundingBox();
    const headBox = await heading.boundingBox();
    expect((idBox?.y ?? 0)).toBeLessThan(headBox?.y ?? 0);
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
    const dotBox = await dot.boundingBox();
    const cardBox = await card.boundingBox();
    expect((dotBox?.x ?? 0) - (cardBox?.x ?? 0)).toBeLessThan(30);
    expect((dotBox?.y ?? 0) - (cardBox?.y ?? 0)).toBeLessThan(30);
    const title = card.locator("[data-slot=ticket-title]");
    const firstLineX = () =>
      title.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode() as Text;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        return range.getBoundingClientRect().x - el.getBoundingClientRect().x;
      });
    const withDot = await firstLineX();
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 20000 });
    const without = await firstLineX();
    expect(withDot).toBeGreaterThan(without);
    expect(withDot - without).toBeLessThan(40);
    expect(without).toBeLessThan(2);
    // A building ticket with no running process never shows a dot.
    await expect(cardsIn(page, "Merging").locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
        { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    const logBox = await log.boundingBox();
    const textBox = await page.getByText("The ticket text of the building ticket.").boundingBox();
    expect((logBox?.y ?? 0)).toBeLessThan(textBox?.y ?? 0);
    expect(logBox?.height ?? 9999).toBeLessThan(500);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const word of [/cites/i, /block/i, /retr/i, /check/i, /stor/i, /touch/i]) await expect(side).toContainText(word);
    await expect(page.getByRole("region", { name: "Decisions" })).toContainText("#role-format");
    await expect(page.getByRole("region", { name: "Decisions" })).toContainText("proposal");
    await side.getByRole("link", { name: "#root" }).first().click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    await side.getByRole("button").click();
    await expect(side).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({ page, app }) => {
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
      cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    for (const w of narrow.cols) expect(w).toBeGreaterThanOrEqual(200);
    await column(page, "Done").scrollIntoViewIfNeeded();
    await expect(column(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    const wide = await board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    const total = wide.cols.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(wide.client * 0.85);
  } finally {
    proc.kill();
  }
});
