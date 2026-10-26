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
const board = (app: BrowserServer) => join(app.dir, ".werk", "board.jsonl");
const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

function ticketFile(app: BrowserServer, num: string, body: string) {
  mkdirSync(join(app.dir, ".werk", "tickets", "r"), { recursive: true });
  writeFileSync(join(app.dir, ".werk", "tickets", "r", `${num}.md`), body);
}

/** One ticket per column, plus r/02 with two open blockers, r/03 with three red passes. */
function seedFive(app: BrowserServer, pid: number, longTitle = false) {
  mkdirSync(join(app.dir, ".werk"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "s1.jsonl"),
    jsonl({ at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } }),
  );
  writeFileSync(
    board(app),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      { type: "ticket.planned", id: "r/02", title: longTitle ? LONG : "Waiting ticket", blocked_by: ["r/06", "r/07"] },
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
      { type: "ticket.planned", id: "r/06", title: "Open blocker one" },
      { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
    ),
  );
}

test("44.1 columns, counts, and a move redraws without reload", async ({ page, app }) => {
  const proc = builder();
  try {
    seedFive(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const cols = page.locator("[data-slot=column]");
    await expect(cols).toHaveCount(5);
    await expect(cols.locator("h3")).toHaveText([/^Blocked/, /^Ready/, /^Building/, /^Merging/, /^Done/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Ready")).toHaveText([/Waiting ticket/, /Open blocker one/, /Open blocker two/]);
    await expect(cardsIn(page, "Ready").first().locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    // No CLI verb moves a ticket. Append the board event as the product's own writers do.
    appendFileSync(board(app), jsonl({ type: "ticket.moved", id: "r/06", to: "building", actor: "loop" }));
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 long title clamp, tooltip, drawer", async ({ page, app }) => {
  const proc = builder();
  try {
    seedFive(app, proc.pid as number, true);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveText(LONG);
    const m = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      return { lines: Math.round(el.clientHeight / lh), full: Math.round(el.scrollHeight / lh), width: el.getBoundingClientRect().width };
    });
    expect(m.full).toBeGreaterThanOrEqual(4); // narrow enough to need four lines
    expect(m.lines).toBe(2);
    const ell = await title.evaluate((el) => ({
      clamp: getComputedStyle(el).webkitLineClamp,
      overflow: getComputedStyle(el).overflow,
    }));
    expect(ell).toEqual({ clamp: "2", overflow: "hidden" });
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const b = await page.locator("[data-slot=board]").boundingBox();
    const d = await drawer.boundingBox();
    expect((d?.y ?? 0)).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0) - 1);
    const code = drawer.locator("header code");
    const h = drawer.locator("header h2");
    await expect(code).toHaveText("r/02");
    await expect(h).toHaveText(LONG);
    const cb = await code.boundingBox();
    const hb = await h.boundingBox();
    expect((hb?.y ?? 0)).toBeGreaterThanOrEqual((cb?.y ?? 0) + (cb?.height ?? 0) - 1);
  } finally {
    proc.kill();
  }
});

/** x of the first character of the first line of the title, and the title box's left edge. */
const firstLineLeft = (title: import("@playwright/test").Locator) =>
  title.evaluate((el) => {
    const r = document.createRange();
    const t = el.firstChild as Text;
    r.setStart(t, 0);
    r.setEnd(t, 1);
    return { text: r.getBoundingClientRect().left, box: el.getBoundingClientRect().left };
  });

test("44.3 pulsing dot only while the process lives", async ({ page, app }) => {
  const proc = builder();
  const dead = spawn("true", [], { stdio: "ignore" });
  await new Promise((r) => dead.once("exit", r));
  try {
    seedFive(app, proc.pid as number);
    appendFileSync(
      board(app),
      jsonl(
        { type: "ticket.planned", id: "r/08", title: "Dead builder" },
        { type: "ticket.moved", id: "r/08", to: "building" },
        { type: "build.started", id: "r/08", session: "s1", pid: dead.pid, log: "s1.jsonl" },
      ),
    );
    await page.goto(`${app.url}/board`);
    const live = cardsIn(page, "Building").filter({ hasText: "Build it" });
    const dead8 = cardsIn(page, "Building").filter({ hasText: "Dead builder" });
    await expect(live).toHaveCount(1);
    await expect(dead8).toHaveCount(1);
    const dot = live.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
    const cardBox = (await live.boundingBox())!;
    const dotBox = (await dot.boundingBox())!;
    expect(dotBox.x - cardBox.x).toBeLessThan(16);
    expect(dotBox.y - cardBox.y).toBeLessThan(24);
    const title = live.locator("[data-slot=ticket-title]");
    const withDot = await firstLineLeft(title);
    const gap = withDot.text - (dotBox.x + dotBox.width);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(12);
    await expect(dead8.locator("[data-slot=live-dot]")).toHaveCount(0);

    proc.kill(); // the board log never gets a session end
    await expect(dot).toHaveCount(0, { timeout: 20000 });
    const after = await firstLineLeft(title);
    expect(after.text).toBeCloseTo(after.box, 0);
    await expect(dead8.locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 building drawer: live log, sidebar, decisions, prefs, leaving building", async ({ page, app }) => {
  const proc = builder();
  try {
    seedFive(app, proc.pid as number);
    // many stream events
    const events = [{ at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } }];
    for (let i = 1; i <= 60; i++) {
      const s = String(i % 60).padStart(2, "0");
      events.push({
        at: `2026-10-25T10:01:${s}.000Z`,
        event: { type: "assistant", message: { content: [{ type: "text", text: `Step ${i}` }] } },
      } as never);
    }
    writeFileSync(join(app.dir, ".werk", "s1.jsonl"), jsonl(...events));
    ticketFile(
      app,
      "03",
      "title: Build it\ncites: root\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
    );
    // r/03 must wait for r/01 (done): rewrite planned event with blocker
    const p = board(app);
    const fs = await import("node:fs");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('{"type":"ticket.planned","id":"r/03","title":"Build it"}', '{"type":"ticket.planned","id":"r/03","title":"Build it","blocked_by":["r/01"]}'));
    appendFileSync(
      join(app.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
        { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
      ),
    );
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(61);
    const lines = log.locator("[data-slot=live-log-lines]");
    const dims = await lines.evaluate((el) => ({ c: el.clientHeight, s: el.scrollHeight, o: getComputedStyle(el).overflowY }));
    expect(dims.s).toBeGreaterThan(dims.c);
    const logBox = (await log.boundingBox())!;
    const textBox = (await drawer.locator("[data-slot=ticket-text]").boundingBox())!;
    expect(logBox.y + logBox.height).toBeLessThanOrEqual(textBox.y + 1);
    await expect(log.locator("[data-slot=log-line] time").first()).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    await expect(log).toContainText("agent: Step 1");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"])
      await expect(side.getByRole("region", { name, exact: true })).toBeVisible();
    const dec = page.getByRole("region", { name: "Decisions" });
    await expect(dec).toContainText("#role-format");
    await expect(dec).toContainText("proposal");

    await side.getByRole("region", { name: "Cites" }).getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);

    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    appendFileSync(p, jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 narrow pane scrolls sideways; wide pane shares width", async ({ page, app }) => {
  const proc = builder();
  try {
    seedFive(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const b = page.locator("[data-slot=board]");
    await expect(cardsIn(page, "Done")).toHaveCount(1);
    const info = () =>
      b.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
      }));
    const n = await info();
    expect(n.scroll).toBeGreaterThan(n.client);
    expect(n.cols).toHaveLength(5);
    for (const w of n.cols) expect(w).toBeGreaterThanOrEqual(200);
    await b.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(column(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    await expect.poll(async () => { const i = await info(); return i.scroll <= i.client; }).toBe(true);
    const w = await info();
    const bw = (await b.boundingBox())!.width;
    const sum = w.cols.reduce((a, c) => a + c, 0);
    expect(sum).toBeGreaterThan(bw * 0.9);
    expect(Math.max(...w.cols) - Math.min(...w.cols)).toBeLessThan(2);
  } finally {
    proc.kill();
  }
});
