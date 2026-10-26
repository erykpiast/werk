import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });

let app: BrowserServer;
test.beforeEach(async () => {
  app = await startBrowserServer({});
  await app.start();
});
test.afterEach(async () => {
  await app.dispose();
});

/**
 * Tickets in blocked (r/04), ready (r/02 with two open blockers r/06 and r/07, long title), building (r/03,
 * three red passes, live builder), merging (r/05) and done (r/01). Many session log lines for r/03.
 */
function seed(pid: number | null, logLines = 60) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  const lines: unknown[] = [
    { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
  ];
  for (let i = 0; i < logLines; i++) {
    lines.push({
      at: `2026-10-25T10:${String(Math.floor((i + 1) / 60)).padStart(2, "0")}:${String((i + 1) % 60).padStart(2, "0")}.000Z`,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: `Step number ${i}` }] },
      },
    });
  }
  writeFileSync(join(werk, "s1.jsonl"), jsonl(...lines));
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
      ...(pid === null
        ? []
        : [{ type: "build.started", id: "r/03", session: "s1", pid, log: "s1.jsonl" }]),
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
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({ page }) => {
  const proc = builder();
  try {
    seed(proc.pid as number);
    await page.goto(`${app.url}/board`);
    await expect(page.locator("[data-slot=column]")).toHaveCount(5);
    const names = await page
      .locator("[data-slot=column]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([/Import ticket/, /Open blocker one/, /Open blocker two/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Ready").first().locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    // `werk ticket move` does not exist (see 27.1); the move is the board-log event a person's move writes.
    const moved = app.werk("ticket", "move", "r/06", "building");
    if (moved.code !== 0) {
      appendFileSync(
        join(app.dir, ".werk", "board.jsonl"),
        jsonl({ type: "ticket.moved", id: "r/06", to: "building", actor: "you" }),
      );
    }
    await expect(cardsIn(page, "Building")).toHaveCount(2);
    await expect(cardsIn(page, "Ready")).toHaveText([/Import ticket/, /Open blocker two/]);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({ page }) => {
  const proc = builder();
  try {
    seed(proc.pid as number);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    const m = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.cssText = "display:block;overflow:visible;-webkit-line-clamp:none;height:auto;max-height:none;";
      el.parentElement?.appendChild(clone);
      const full = Math.round(clone.getBoundingClientRect().height / lh);
      clone.remove();
      return {
        fullLines: full,
        shownLines: Math.round(el.clientHeight / lh),
        cut: el.scrollHeight > el.clientHeight,
        clamp: getComputedStyle(el).webkitLineClamp,
      };
    });
    expect(m.fullLines).toBeGreaterThanOrEqual(4);
    expect(m).toMatchObject({ shownLines: 2, cut: true, clamp: "2" });
    await title.hover();
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const boardBox = await page.locator("[data-slot=board]").boundingBox();
    const drawerBox = await drawer.boundingBox();
    expect((drawerBox?.y ?? 0) + 1).toBeGreaterThanOrEqual((boardBox?.y ?? 0) + (boardBox?.height ?? 0));
    const id = drawer.locator("header code");
    const heading = drawer.getByRole("heading", { name: LONG });
    await expect(id).toHaveText("r/02");
    await expect(heading).toBeVisible();
    const idBox = await id.boundingBox();
    const headBox = await heading.boundingBox();
    expect((idBox?.y ?? 0) + (idBox?.height ?? 0)).toBeLessThanOrEqual((headBox?.y ?? 0) + 1);
  } finally {
    proc.kill();
  }
});

test("44.3 a building ticket pulses only while its session process is alive", async ({ page }) => {
  const proc = builder();
  try {
    seed(proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const pos = () =>
      card.evaluate((c) => {
        const title = c.querySelector("[data-slot=ticket-title]") as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(title);
        const first = range.getClientRects()[0] as DOMRect;
        const d = c.querySelector("[data-slot=live-dot]")?.getBoundingClientRect();
        return {
          textLeft: first.left,
          cardLeft: c.getBoundingClientRect().left,
          dotLeft: d?.left ?? null,
          dotRight: d?.right ?? null,
          dotTop: d?.top ?? null,
          cardTop: c.getBoundingClientRect().top,
        };
      });
    const before = await pos();
    expect((before.dotLeft as number) - before.cardLeft).toBeLessThan(16);
    expect((before.dotTop as number) - before.cardTop).toBeLessThan(20);
    const gap = before.textLeft - (before.dotRight as number);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(12);
    // A terminal kill. Nothing writes a session end.
    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const after = await pos();
    expect(after.textLeft).toBeLessThan(before.textLeft - 10);
    // The text of a card with no dot starts where the text of the other cards starts.
    const other = await cardsIn(page, "Merging").evaluate((c) => {
      const range = document.createRange();
      range.selectNodeContents(c.querySelector("[data-slot=ticket-title]") as HTMLElement);
      return range.getClientRects()[0]?.left;
    });
    const cardsLeft = await cardsIn(page, "Merging").evaluate((c) => c.getBoundingClientRect().left);
    expect(Math.abs((other as number) - cardsLeft - (after.textLeft - after.cardLeft))).toBeLessThan(1.5);
  } finally {
    proc.kill();
  }
});

test("44.3 (no process) a building ticket with no running process never shows a dot", async ({ page }) => {
  seed(null);
  await page.goto(`${app.url}/board`);
  await expect(cardsIn(page, "Building")).toHaveCount(1);
  await expect(page.locator("[data-slot=live-dot]")).toHaveCount(0);
  const dead = builder();
  dead.kill();
  await new Promise((r) => dead.once("exit", r));
  const werk = join(app.dir, ".werk");
  appendFileSync(
    join(werk, "board.jsonl"),
    jsonl({ type: "build.started", id: "r/03", session: "s1", pid: dead.pid, log: "s1.jsonl" }),
  );
  await page.reload();
  await expect(cardsIn(page, "Building")).toHaveCount(1);
  await expect(page.locator("[data-slot=live-dot]")).toHaveCount(0);
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({ page }) => {
  const proc = builder();
  try {
    seed(proc.pid as number, 80);
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
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
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = drawer.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(81);
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines.first().locator("time")).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    // A fixed height: the scroller is shorter than its content, and the log sits above the text.
    const scroller = log.locator("[data-slot=live-log-lines]");
    const dims = await scroller.evaluate((el) => ({ c: el.clientHeight, s: el.scrollHeight }));
    expect(dims.s).toBeGreaterThan(dims.c);
    const logBox = await log.boundingBox();
    const textBox = await drawer.locator("[data-slot=ticket-text]").boundingBox();
    expect((logBox?.y ?? 0) + (logBox?.height ?? 0)).toBeLessThanOrEqual((textBox?.y ?? 0) + 1);
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const label of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name: label }), label).toBeVisible();
    }
    const decisions = drawer.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goBack();
    await expect(page.locator("[data-slot=board]")).toBeVisible();
    // The drawer may still be open after the return; open it only when it is not.
    if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0) {
      await cardsIn(page, "Building").click();
    }
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    // Fold back so the facts show again, then move the ticket out of building.
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({ page }) => {
  const proc = builder();
  try {
    seed(proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(page.locator("[data-slot=column]")).toHaveCount(5);
    const sizes = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        left: el.getBoundingClientRect().left,
        columns: [...el.querySelectorAll("[data-slot=column]")].map((c) => {
          const r = c.getBoundingClientRect();
          return { w: r.width, l: r.left, r: r.right };
        }),
      }));
    const narrow = await sizes();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    for (const c of narrow.columns) expect(c.w).toBeGreaterThanOrEqual(200);
    // The done column starts off screen, and a sideways scroll reaches it.
    const done = column(page, "Done");
    expect(narrow.columns[4]?.r).toBeGreaterThan(600);
    await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const doneBox = await done.boundingBox();
    expect((doneBox?.x ?? 0) + (doneBox?.width ?? 0)).toBeLessThanOrEqual(601);
    await expect(done).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    await expect.poll(async () => (await sizes()).scroll <= (await sizes()).client).toBe(true);
    const wide = await sizes();
    const total = wide.columns.reduce((s, c) => s + c.w, 0);
    expect(total).toBeGreaterThan(wide.client - 80);
    expect(Math.abs((wide.columns[4]?.r ?? 0) - (wide.left + wide.client))).toBeLessThan(20);
    const widths = wide.columns.map((c) => c.w);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  } finally {
    proc.kill();
  }
});
