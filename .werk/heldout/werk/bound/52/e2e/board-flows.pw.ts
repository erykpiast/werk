import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Srv, startServer } from "../server.ts";

const LONG = "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });
const col = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const cards = (page: Page, name: string) => col(page, name).locator("[data-slot=ticket-card]");

const TICKET_TEXT =
  "title: Build it\ncites: root\nblocked_by: 1\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n";

function writeTickets(s: Srv) {
  const w = join(s.dir, ".werk");
  mkdirSync(join(w, "tickets", "r"), { recursive: true });
  writeFileSync(join(w, "tickets", "r", "03.md"), TICKET_TEXT);
}

function seed(s: Srv, pid: number) {
  const w = join(s.dir, ".werk");
  writeTickets(s);
  writeFileSync(join(w, "s1.jsonl"), jsonl(
    { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
    ...Array.from({ length: 40 }, (_, i) => ({
      at: `2026-10-25T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
      event: { type: "assistant", message: { content: [{ type: "text", text: `Step ${i}` }] } },
    })),
  ));
  s.appendBoard(
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

async function withBoard(body: (s: Srv, pid: number, proc: ChildProcess) => Promise<void>) {
  const s = await startServer();
  await s.start();
  const proc = builder();
  try {
    seed(s, proc.pid as number);
    await body(s, proc.pid as number, proc);
  } finally {
    proc.kill();
    await s.dispose();
  }
}

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({ page }) => {
  await withBoard(async (s) => {
    await page.goto(`${s.url}/board`);
    const names = await page.locator("[data-slot=column]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cards(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cards(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cards(page, "Building")).toHaveText([/Build it/]);
    await expect(cards(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cards(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cards(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");
    await page.evaluate(() => { (window as any).loaded = true; });
    // The person moves a ready ticket into building from the command line.
    const moved = s.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stderr).toBe(0);
    await expect(cards(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cards(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).loaded)).toBe(true);
  });
});

test("44.1b the board redraws when its log changes (the move written to the log directly)", async ({ page }) => {
  await withBoard(async (s) => {
    await page.goto(`${s.url}/board`);
    await expect(cards(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await page.evaluate(() => { (window as any).loaded = true; });
    s.appendBoard({ type: "ticket.moved", id: "r/06", to: "building", actor: "you" });
    await expect(cards(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cards(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).loaded)).toBe(true);
  });
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({ page }) => {
  await withBoard(async (s) => {
    const card = () => cards(page, "Ready").filter({ hasText: "Import ticket" });
    const title = () => card().locator("[data-slot=ticket-title]");
    let natural = 0;
    for (const width of [1500, 1100, 900, 760, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${s.url}/board`);
      await expect(title()).toBeVisible();
      natural = await title().evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.cssText = "display:block;-webkit-line-clamp:unset;overflow:visible;max-height:none;height:auto;position:absolute;visibility:hidden;width:" + el.clientWidth + "px";
        el.parentElement!.append(clone);
        const lines = Math.round(clone.clientHeight / parseFloat(getComputedStyle(clone).lineHeight));
        clone.remove();
        return lines;
      });
      if (natural >= 4) break;
    }
    expect(natural, "no width makes the title need four lines").toBeGreaterThanOrEqual(4);
    const clamp = await title().evaluate((el) => ({
      lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
      overflow: getComputedStyle(el).overflow,
      mode: getComputedStyle(el).webkitLineClamp,
    }));
    expect(clamp.lines).toBe(2);
    expect(clamp.cut).toBe(true);
    expect(clamp.mode).toBe("2");
    await expect(title()).toHaveAttribute("title", LONG);
    await card().click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const boardBox = (await page.locator("[data-slot=board]").boundingBox())!;
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height - 2);
    const id = (await drawer.locator("[data-slot=drawer-bar] code").boundingBox())!;
    const head = (await drawer.getByRole("heading", { name: LONG }).boundingBox())!;
    expect(head.y).toBeGreaterThanOrEqual(id.y + id.height - 2);
    await expect(drawer.locator("[data-slot=drawer-bar] code")).toHaveText("r/02");
  });
});

test("44.3 a building ticket pulses only while its session process is alive", async ({ page }) => {
  await withBoard(async (s, pid, proc) => {
    // a second building ticket whose process is already dead
    const dead = spawn("true", [], { stdio: "ignore" });
    await new Promise((r) => dead.once("exit", r));
    s.appendBoard(
      { type: "ticket.planned", id: "r/08", title: "Dead builder ticket" },
      { type: "ticket.moved", id: "r/08", to: "building" },
      { type: "build.started", id: "r/08", session: "s2", pid: dead.pid, log: "s1.jsonl" },
    );
    await page.goto(`${s.url}/board`);
    const live = cards(page, "Building").filter({ hasText: "Build it" });
    const dot = live.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const textLeft = async (loc: ReturnType<typeof live.locator>) =>
      loc.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects()[0]!.left;
      });
    const titleOf = (c: typeof live) => c.locator("[data-slot=ticket-title]");
    const cardBox = (await live.boundingBox())!;
    const dotBox = (await dot.boundingBox())!;
    expect(dotBox.x - cardBox.x).toBeLessThan(20);
    expect(dotBox.y - cardBox.y).toBeLessThan(20);
    const withDot = await textLeft(titleOf(live));
    expect(withDot).toBeGreaterThanOrEqual(dotBox.x + dotBox.width - 1);
    expect(withDot - (dotBox.x + dotBox.width)).toBeLessThan(16);
    const dead_card = cards(page, "Building").filter({ hasText: "Dead builder ticket" });
    await expect(dead_card).toHaveCount(1);
    await expect(dead_card.locator("[data-slot=live-dot]")).toHaveCount(0);
    const leftEdge = await textLeft(titleOf(dead_card)) - (await dead_card.boundingBox())!.x;
    // The person kills the builder from a terminal. Nothing writes a session end.
    process.kill(pid, "SIGKILL");
    await expect(dot).toHaveCount(0, { timeout: 20000 });
    const after = (await textLeft(titleOf(live))) - (await live.boundingBox())!.x;
    expect(Math.abs(after - leftEdge)).toBeLessThan(2);
    void proc;
  });
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({ page }) => {
  await withBoard(async (s) => {
    s.appendLog(
      { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
      { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
    );
    await page.goto(`${s.url}/board`);
    await cards(page, "Building").click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]").first()).toBeVisible();
    const logBox = (await log.boundingBox())!;
    const textBox = (await drawer.locator("[data-slot=ticket-text]").boundingBox())!;
    expect(logBox.y + logBox.height).toBeLessThanOrEqual(textBox.y + 1);
    const heights = await log.locator("[data-slot=live-log-lines]").evaluate((el) => ({ box: el.clientHeight, scroll: el.scrollHeight }));
    expect(heights.scroll).toBeGreaterThan(heights.box);
    await expect(log.locator("time").first()).toHaveText(/^2026-10-25 10:00:\d\d$/);
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    const decisions = side.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await side.getByRole("region", { name: "Cites" }).getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(cards(page, "Building")).toHaveCount(1);
    if ((await cards(page, "Building").getAttribute("aria-pressed")) !== "true") await cards(page, "Building").click();
    await expect(page.getByRole("region", { name: "Ticket drawer" })).toBeVisible();
    const fold = page.getByRole("complementary", { name: "Ticket details" }).getByRole("button");
    await fold.click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cards(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    s.appendBoard({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" });
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText("The ticket text of the building ticket.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  });
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({ page }) => {
  await withBoard(async (s) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${s.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(board).toBeVisible();
    const read = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        columns: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
        left: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().left),
      }));
    const narrow = await read();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    for (const w of narrow.columns) expect(w).toBeGreaterThanOrEqual(200);
    // scroll sideways to reach the done column
    const done = col(page, "Done");
    await board.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(done).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    await expect.poll(async () => (await read()).scroll <= (await read()).client).toBe(true);
    const wide = await read();
    expect(wide.columns).toHaveLength(5);
    const total = wide.columns.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(wide.client * 0.9);
    const spread = Math.max(...wide.columns) - Math.min(...wide.columns);
    expect(spread).toBeLessThan(wide.client * 0.1);
  });
});
