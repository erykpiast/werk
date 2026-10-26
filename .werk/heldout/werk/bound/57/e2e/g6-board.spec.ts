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
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });

function seed(app: BrowserServer, pid: number) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\nBuilding text.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
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
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      { type: "ticket.planned", id: "r/02", title: LONG, blocked_by: ["r/06", "r/07"] },
      { type: "ticket.planned", id: "r/03", title: "Build it" },
      { type: "ticket.moved", id: "r/03", to: "building" },
      { type: "build.started", id: "r/03", session: "s1", pid, log: "s1.jsonl" },
      { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 3, result: "red" },
      { type: "ticket.planned", id: "r/04", title: "Blocked ticket", reason: "a cited card is stale" },
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

test("44.1 columns, counts, command line move redraws", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const heads = await page.locator("[data-slot=column] > h3").allTextContents();
    expect(heads.map((h) => h.trim().split(/\s/)[0])).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");
    await page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
    const moved = app.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker" })).toHaveCount(2);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker" })).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 long title cut, tooltip, drawer header", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").filter({ hasText: "Import ticket" });
    const title = card.locator("[data-slot=ticket-title]");
    const info = await title.evaluate((el) => ({
      lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
      clamp: getComputedStyle(el).webkitLineClamp,
      natural: el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(info.lines).toBe(2);
    expect(info.cut).toBe(true);
    expect(info.clamp).toBe("2");
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const boardBox = await page.locator("[data-slot=board]").boundingBox();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox!.y).toBeGreaterThanOrEqual(boardBox!.y + boardBox!.height - 1);
    const idBox = await drawer.locator("[data-slot=drawer-bar] code").boundingBox();
    const titleBox = await drawer.locator("[data-slot=drawer-title]").boundingBox();
    expect(titleBox!.y).toBeGreaterThan(idBox!.y);
    await expect(drawer.locator("[data-slot=drawer-title]")).toHaveText(LONG);
    await expect(drawer.locator("[data-slot=drawer-bar] code")).toHaveText("r/02");
  } finally {
    proc.kill();
  }
});

test("44.3 dot only while process alive", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const firstLineX = () => card.locator("[data-slot=ticket-title]").evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild as Node, 0);
      r.setEnd(el.firstChild as Node, 1);
      return r.getBoundingClientRect().x;
    });
    const t1 = await firstLineX();
    const c1 = await card.boundingBox();
    expect(t1 - c1!.x).toBeGreaterThan(0);
    const dotBox = await dot.boundingBox();
    expect(dotBox!.x - c1!.x).toBeLessThan(20);
    expect(dotBox!.y - c1!.y).toBeLessThan(20);
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const t2 = await firstLineX();
    expect(t2).toBeLessThan(t1);
    // a building ticket with no running process never shows a dot
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.planned", id: "r/08", title: "Idle" }, { type: "ticket.moved", id: "r/08", to: "building" }));
    await expect(cardsIn(page, "Building").filter({ hasText: "Idle" })).toHaveCount(1);
    await expect(page.locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 drawer of building ticket", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    appendFileSync(join(app.dir, ".werk", "log.jsonl"), jsonl(
      { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
      { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
    ));
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    const lb = await log.locator("[data-slot=live-log-lines]").evaluate((el) => ({ h: el.clientHeight, o: getComputedStyle(el).overflowY }));
    expect(lb.h).toBeGreaterThan(0);
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      if (name === "Blockers") continue; // r/03 has no blockers
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    // the log sits above the ticket text
    const lg = await log.boundingBox();
    const tx = await page.locator("[data-slot=ticket-text]").boundingBox();
    expect(lg!.y).toBeLessThan(tx!.y);
    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText("Building text.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 narrow pane scrolls sideways", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    const s = await board.evaluate((el) => ({
      scroll: el.scrollWidth, client: el.clientWidth,
      cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    expect(s.scroll).toBeGreaterThan(s.client);
    for (const w of s.cols) expect(w).toBeGreaterThanOrEqual(200);
    await board.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(column(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    const w = await board.evaluate((el) => ({
      scroll: el.scrollWidth, client: el.clientWidth,
      cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect()),
    }));
    expect(w.scroll).toBeLessThanOrEqual(w.client);
    const total = w.cols.reduce((a, c) => a + c.width, 0);
    expect(total).toBeGreaterThan(w.client * 0.9);
  } finally {
    proc.kill();
  }
});
