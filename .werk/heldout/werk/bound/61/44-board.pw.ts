import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import type { BrowserServer } from "./server.ts";

const LONG = "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const sleeper = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });
const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) => column(page, name).locator("[data-slot=ticket-card]");

const TICKET_TEXT = "title: Build it\ncites: root\nblocked_by: \nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n";

function seed(app: BrowserServer, pid: number | null) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(join(werk, "tickets", "r", "03.md"), TICKET_TEXT);
  writeFileSync(
    join(werk, "s1.jsonl"),
    jsonl(
      { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
      { at: "2026-10-25T10:00:07.000Z", event: { type: "assistant", message: { content: [{ type: "text", text: "Reading the ticket" }] } } },
    ),
  );
  const events: unknown[] = [
    { type: "ticket.planned", id: "r/01", title: "Done ticket" },
    { type: "ticket.moved", id: "r/01", to: "building" },
    { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "r/01" },
    { type: "ticket.planned", id: "r/02", title: LONG, blocked_by: ["r/05", "r/06"] },
    { type: "ticket.planned", id: "r/03", title: "Build it" },
    { type: "ticket.moved", id: "r/03", to: "building" },
    ...(pid === null ? [] : [{ type: "build.started", id: "r/03", session: "s1", pid, log: "s1.jsonl" }]),
    { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
    { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
    { type: "ticket.pass", id: "r/03", n: 3, result: "red" },
    { type: "ticket.planned", id: "r/04", title: "Blocked ticket", reason: "a cited card is stale" },
    { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
    { type: "ticket.moved", id: "r/05", to: "building" },
    { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
    { type: "ticket.planned", id: "r/06", title: "Open blocker" },
  ];
  writeFileSync(join(werk, "board.jsonl"), jsonl(...events));
}

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({ page, app }) => {
  seed(app, null);
  await page.goto(`${app.url}/board`);
  const heads = await page.locator("[data-slot=column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
  expect(heads).toEqual(["blocked", "ready", "building", "merging", "done"]);
  await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
  await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
  await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
  await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket|Open blocker/]);
  await expect(cardsIn(page, "Ready").first().locator("[data-slot=blockers]")).toHaveText(/2/);
  await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText(/3/);
  await page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
  const mv = app.werk("ticket", "move", "r/06", "building");
  expect(mv.code).toBe(0);
  await expect(cardsIn(page, "Building")).toHaveCount(2);
  await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({ page, app }) => {
  seed(app, null);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${app.url}/board`);
  const card = cardsIn(page, "Ready").filter({ hasText: "Import ticket" });
  const title = card.locator("[data-slot=ticket-title]");
  const natural = await title.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.cssText = "display:block;-webkit-line-clamp:unset;overflow:visible;max-height:none;width:" + el.clientWidth + "px";
    el.parentElement?.appendChild(clone);
    const lines = Math.round(clone.clientHeight / Number.parseFloat(getComputedStyle(clone).lineHeight));
    clone.remove();
    return lines;
  });
  expect(natural).toBeGreaterThanOrEqual(3);
  const clamp = await title.evaluate((el) => ({
    lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    cut: el.scrollHeight > el.clientHeight,
    overflow: getComputedStyle(el).textOverflow,
    mode: getComputedStyle(el).webkitLineClamp,
  }));
  expect(clamp.lines).toBe(2);
  expect(clamp.cut).toBe(true);
  expect(clamp.mode).toBe("2");
  await expect(title).toHaveAttribute("title", LONG);
  await card.click();
  const drawer = page.getByRole("region", { name: "Ticket drawer" });
  const id = drawer.locator("[data-slot=drawer-bar] code");
  const full = drawer.locator("[data-slot=drawer-title]");
  await expect(id).toHaveText("r/02");
  await expect(full).toHaveText(LONG);
  const [a, b] = [await id.boundingBox(), await full.boundingBox()];
  expect(a && b && b.y >= a.y + a.height - 1).toBe(true);
});

test("44.3 a building ticket pulses only while its session process is alive", async ({ page, app }) => {
  const proc = sleeper();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const firstLineLeft = () =>
      card.locator("[data-slot=ticket-title]").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects()[0]?.left ?? 0;
      });
    const withDot = await firstLineLeft();
    const dotBox = await dot.boundingBox();
    const cardBox = await card.boundingBox();
    expect(dotBox && cardBox && dotBox.x - cardBox.x < 24).toBe(true);
    expect(dotBox && withDot >= dotBox.x + dotBox.width).toBe(true);
    expect(dotBox && withDot - (dotBox.x + dotBox.width)).toBeLessThan(16);
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    expect(await firstLineLeft()).toBeLessThan(withDot);
    const noProc = await page.locator("[data-slot=ticket-card] [data-slot=live-dot]").count();
    expect(noProc).toBe(0);
  } finally {
    proc.kill();
  }
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({ page, app }) => {
  const proc = sleeper();
  try {
    seed(app, proc.pid as number);
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "node.edited", id: "root", who: "me", noBasis: "test" },
        { type: "criterion.added", id: "root", form: "revisit" },
        { type: "node.decided", id: "root" },
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
        { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    const heightA = (await log.boundingBox())?.height;
    const text = page.locator("[data-slot=ticket-text]");
    const [lb, tb] = [await log.boundingBox(), await text.boundingBox()];
    expect(lb && tb && lb.y < tb.y).toBe(true);
    await expect(log.locator("[data-slot=log-line] time").first()).toHaveText("2026-10-25 10:00:00");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      if (name === "Blockers") continue; // this ticket has no blocker
      await expect(side.getByLabel(name)).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Decisions" })).toContainText("#role-format");
    await expect(page.getByRole("region", { name: "Decisions" })).toContainText("proposal");
    expect(heightA).toBeGreaterThan(0);
    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/board/);
    await cardsIn(page, "Building").click();
    const side2 = page.getByRole("complementary", { name: "Ticket details" });
    await side2.getByRole("button").click();
    await expect(side2).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText("The ticket text of the building ticket.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({ page, app }) => {
  seed(app, null);
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
  for (const w of narrow.columns) expect(w).toBeGreaterThanOrEqual(200);
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
  expect(total).toBeGreaterThan(wide.client * 0.85);
});
