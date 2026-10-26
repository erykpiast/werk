import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { expect, serve, test, type Own } from "./browser-support.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });

function seed(s: Own, pid: number) {
  const werk = join(s.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  writeFileSync(
    join(werk, "s1.jsonl"),
    jsonl(
      { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
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

const col = (page: Page, name: string) => page.getByRole("region", { name });
const cards = (page: Page, name: string) =>
  col(page, name).locator("[data-slot=ticket-card]");

async function withBoard(
  fn: (s: Own, page: Page, proc: ChildProcess) => Promise<void>,
  page: Page,
  opts: { width?: number } = {},
) {
  const proc = builder();
  const s = await serve();
  try {
    seed(s, proc.pid as number);
    if (opts.width) await page.setViewportSize({ width: opts.width, height: 900 });
    await page.goto(`${s.url}/board`);
    await fn(s, page, proc);
  } finally {
    proc.kill();
    await s.dispose();
  }
}

test("44.1a columns, blocker count, retry count", async ({ page }) => {
  await withBoard(async () => {
    await expect(page.locator("[data-slot=column]")).toHaveCount(5);
    const names = await page
      .locator("[data-slot=column]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cards(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cards(page, "Building")).toHaveText([/Build it/]);
    await expect(cards(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cards(page, "Done")).toHaveText([/Done ticket/]);
    await expect(
      cards(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(cards(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");
  }, page);
});

test("44.1b a command line move of a ready ticket into building redraws the board", async ({ page }) => {
  await withBoard(async (s) => {
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    const moved = s.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(cards(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cards(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
    ).toBe(true);
  }, page);
});

test("44.2 long title cut on the card, full in tooltip and drawer", async ({ page }) => {
  await withBoard(async () => {
    const card = cards(page, "Ready").filter({ hasText: "Import ticket" });
    const title = card.locator("[data-slot=ticket-title]");
    const m = await title.evaluate((el) => ({
      lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
      full: Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      clamp: getComputedStyle(el).webkitLineClamp,
    }));
    expect(m.full).toBeGreaterThanOrEqual(3);
    expect(m.lines).toBe(2);
    expect(m.cut).toBe(true);
    expect(m.clamp).toBe("2");
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    const board = await page.locator("[data-slot=board]").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(board!.y + board!.height - 1);
    const id = drawer.locator("header code");
    const heading = drawer.getByRole("heading", { name: LONG });
    await expect(id).toHaveText("r/02");
    await expect(heading).toBeVisible();
    const ib = (await id.boundingBox())!;
    const hb = (await heading.boundingBox())!;
    expect(hb.y).toBeGreaterThanOrEqual(ib.y + ib.height - 1);
  }, page, { width: 1100 });
});

test("44.3 a building ticket pulses only while its process is alive", async ({ page }) => {
  await withBoard(async (s, _p, proc) => {
    // a second building ticket whose process is gone
    appendFileSync(
      join(s.dir, ".werk", "board.jsonl"),
      jsonl(
        { type: "ticket.planned", id: "r/08", title: "Dead builder" },
        { type: "ticket.moved", id: "r/08", to: "building" },
        { type: "build.started", id: "r/08", session: "s2", pid: 2147483000, log: "s1.jsonl" },
      ),
    );
    const live = cards(page, "Building").filter({ hasText: "Build it" });
    const dead = cards(page, "Building").filter({ hasText: "Dead builder" });
    await expect(live).toHaveCount(1);
    await expect(live.locator("[data-slot=live-dot]")).toBeVisible();
    await expect(dead.locator("[data-slot=live-dot]")).toHaveCount(0);
    const title = live.locator("[data-slot=ticket-title]");
    const dotBox = (await live.locator("[data-slot=live-dot]").boundingBox())!;
    const cardBox = (await live.boundingBox())!;
    expect(Math.abs(dotBox.x - cardBox.x)).toBeLessThan(20);
    const indent = await title.evaluate((el) => Number.parseFloat(getComputedStyle(el).textIndent));
    expect(indent).toBeGreaterThan(0);
    expect(indent).toBeLessThan(30);
    proc.kill();
    await expect(live.locator("[data-slot=live-dot]")).toHaveCount(0, { timeout: 20000 });
    const after = await title.evaluate((el) => Number.parseFloat(getComputedStyle(el).textIndent));
    expect(after).toBe(0);
  }, page);
});

test("44.4 drawer of a building ticket", async ({ page }) => {
  await withBoard(async (s) => {
    appendFileSync(
      join(s.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
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
    await cards(page, "Building").click();
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    expect(await log.locator("[data-slot=live-log-lines]").evaluate((e) => getComputedStyle(e).overflowY)).toMatch(/auto|scroll/);
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const label of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name: label })).toBeVisible();
    }
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goto(`${s.url}/board`);
    await cards(page, "Building").click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cards(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    appendFileSync(
      join(s.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(log).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveCount(1);
  }, page);
});

test("44.5 narrow pane scrolls sideways, wide pane fits", async ({ page }) => {
  await withBoard(async () => {
    const board = page.locator("[data-slot=board]");
    const m = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
      }));
    const narrow = await m();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(narrow.cols).toHaveLength(5);
    for (const w of narrow.cols) expect(w).toBeGreaterThanOrEqual(200);
    await board.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(col(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 900 });
    const wide = await m();
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    const sum = wide.cols.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(wide.client * 0.9);
    expect(Math.max(...wide.cols) - Math.min(...wide.cols)).toBeLessThan(2);
  }, page, { width: 600 });
});
