import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/support/fixtures.ts";
import type { BrowserServer } from "../e2e/support/server.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const sleeper = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const cardsIn = (page: Page, name: string) => column(page, name).locator("[data-slot=ticket-card]");

function writeTicket(app: BrowserServer, id: string, body: string) {
  const [plan, num] = id.split("/");
  mkdirSync(join(app.dir, ".werk", "tickets", plan), { recursive: true });
  writeFileSync(join(app.dir, ".werk", "tickets", plan, `${num}.md`), body);
}

const TICKET3 =
  "title: Build it\ncites: root\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n";

function stream(n: number) {
  const lines = [{ at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } }];
  for (let i = 1; i <= n; i++) {
    const s = String(i % 60).padStart(2, "0");
    lines.push({
      at: `2026-10-25T10:${String(Math.floor(i / 60) + 1).padStart(2, "0")}:${s}.000Z`,
      event: { type: "assistant", message: { content: [{ type: "text", text: `Step ${i} of the build` }] } },
    } as never);
  }
  return jsonl(...lines);
}

/** A full board: one ticket per column, extra ready tickets, a live builder for r/03. */
function seed(app: BrowserServer, pid: number, opts: { title2?: string } = {}) {
  writeTicket(app, "r/03", TICKET3);
  writeFileSync(join(app.dir, ".werk", "s1.jsonl"), stream(60));
  writeFileSync(
    join(app.dir, ".werk", "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      { type: "ticket.planned", id: "r/02", title: opts.title2 ?? "Waits on two", blocked_by: opts.title2 ? [] : ["r/06", "r/07"] },
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
      { type: "ticket.planned", id: "r/08", title: "Ready to move" },
    ),
  );
}

async function withBoard(
  app: BrowserServer,
  body: (proc: ChildProcess) => Promise<void>,
  seedOpts: { title2?: string } = {},
) {
  const proc = sleeper();
  try {
    seed(app, proc.pid as number, seedOpts);
    await body(proc);
  } finally {
    proc.kill();
  }
}

test("44.1 tickets sit in their columns and a command line move redraws the board", async ({ page, app }) => {
  await withBoard(app, async () => {
    await page.goto(`${app.url}/board`);
    await expect(page.locator("[data-slot=column] h3")).toHaveText([/^Blocked/, /^Ready/, /^Building/, /^Merging/, /^Done/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([/Waits on two/, /Open blocker one/, /Open blocker two/, /Ready to move/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Ready").first().locator("[data-slot=blockers]")).toHaveText("⊘2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toHaveText("↻3");

    await page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
    // The CLI has no verb to move a ticket. Try it; then use the event as a stand-in.
    const cli = app.werk("ticket", "move", "r/08", "building", "--actor", "you");
    expect.soft(cli.code, `werk ticket move: ${cli.stderr}`).toBe(0);
    if (cli.code !== 0) {
      appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/08", to: "building", actor: "you" }));
    }
    await expect(cardsIn(page, "Building").filter({ hasText: "Ready to move" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Ready to move" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  });
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({ page, app }) => {
  await withBoard(app, async () => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveText(LONG);
    // The column is narrow: the full title needs four lines when it is not cut.
    const natural = await title.evaluate(
      (el: HTMLElement) => Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    );
    expect(natural).toBe(4);
    const shown = await title.evaluate((el: HTMLElement) => ({
      lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
      clamp: getComputedStyle(el).webkitLineClamp,
    }));
    expect(shown).toEqual({ lines: 2, cut: true, clamp: "2" });
    await title.hover();
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const board = await page.locator("[data-slot=board]").boundingBox();
    const dbox = await drawer.boundingBox();
    expect(dbox!.y).toBeGreaterThanOrEqual(board!.y + board!.height - 1);
    const id = await drawer.locator("header code").boundingBox();
    const head = drawer.getByRole("heading", { name: LONG });
    await expect(head).toBeVisible();
    await expect(drawer.locator("header code")).toHaveText("r/02");
    const hbox = await head.boundingBox();
    expect(hbox!.y).toBeGreaterThanOrEqual(id!.y + id!.height - 1);
  }, { title2: LONG });
});

test("44.3 a building ticket pulses only while its session process is alive", async ({ page, app }) => {
  await withBoard(app, async (proc) => {
    // r/09 names a dead process, r/10 has no build at all.
    const dead = spawn("true", [], { stdio: "ignore" });
    await new Promise((r) => dead.once("exit", r));
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl(
      { type: "ticket.planned", id: "r/09", title: "Dead builder" },
      { type: "ticket.moved", id: "r/09", to: "building" },
      { type: "build.started", id: "r/09", session: "s9", pid: dead.pid, log: "s9.jsonl" },
      { type: "ticket.planned", id: "r/10", title: "No builder" },
      { type: "ticket.moved", id: "r/10", to: "building" },
    ));
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`${app.url}/board`);
    const live = cardsIn(page, "Building").filter({ hasText: "Build it" });
    const dot = live.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    await expect(cardsIn(page, "Building")).toHaveCount(3);
    await expect(cardsIn(page, "Building").locator("[data-slot=live-dot]")).toHaveCount(1);

    const geometry = async () =>
      live.evaluate((card) => {
        const t = card.querySelector("[data-slot=ticket-title]") as HTMLElement;
        const d = card.querySelector("[data-slot=live-dot]");
        const r = document.createRange();
        r.selectNodeContents(t.firstChild as Node);
        const first = r.getClientRects()[0];
        const cb = card.getBoundingClientRect();
        const dr = d?.getBoundingClientRect();
        return { firstLeft: first.left, titleLeft: t.getBoundingClientRect().left, cardLeft: cb.left, cardTop: cb.top, dot: dr ? { left: dr.left, right: dr.right, top: dr.top } : null };
      });
    const before = await geometry();
    expect(before.dot!.left - before.cardLeft).toBeLessThan(20);
    expect(before.dot!.top - before.cardTop).toBeLessThan(20);
    const gap = before.firstLeft - before.dot!.right;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(16);

    process.kill(proc.pid as number, "SIGKILL");
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const after = await geometry();
    expect(after.firstLeft).toBeCloseTo(after.titleLeft, 0);
    await expect(cardsIn(page, "Building").locator("[data-slot=live-dot]")).toHaveCount(0);
  });
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({ page, app }) => {
  await withBoard(app, async () => {
    appendFileSync(join(app.dir, ".werk", "log.jsonl"), jsonl(
      { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
      { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
    ));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = drawer.getByRole("region", { name: "Live log" });
    await expect(log.locator("[data-slot=log-line]").first()).toBeVisible();
    const lines = await log.locator("[data-slot=log-line]").count();
    expect(lines).toBeGreaterThan(30);
    const logBox = await log.locator("[data-slot=live-log-lines]").boundingBox();
    expect(logBox!.height).toBeLessThan(400);
    const text = drawer.locator("[data-slot=ticket-text]");
    await expect(text).toContainText("The ticket text of the building ticket.");
    expect((await log.boundingBox())!.y).toBeLessThan((await text.boundingBox())!.y);
    for (const t of await log.locator("time").allTextContents().then((a) => a.slice(0, 5))) {
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    await expect(log.locator("[data-slot=log-line]").first()).toContainText(/system init|agent:|Step/);
    const side = drawer.getByRole("complementary", { name: "Ticket details" });
    for (const n of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name: n })).toBeVisible();
    }
    await expect(side.getByRole("region", { name: "Cites" })).toContainText("#root");
    await expect(side.getByRole("region", { name: "Retries" })).toContainText("3");
    await expect(side.getByRole("region", { name: "Checks" })).toContainText("make test");
    const dec = side.getByRole("region", { name: "Decisions" });
    await expect(dec).toContainText("#role-format");
    await expect(dec).toContainText("proposal");

    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("We build software with agents");

    await page.goBack();
    await expect(cardsIn(page, "Building")).toHaveCount(1);
    if ((await drawer.count()) === 0) await cardsIn(page, "Building").click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(drawer.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await expect(cardsIn(page, "Building")).toHaveCount(1);
    if ((await drawer.count()) === 0) await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.locator("[data-slot=ticket-text]")).toContainText("The ticket text of the building ticket.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  });
});

test("44.5 a narrow pane scrolls the board sideways and a wide one shows all five columns", async ({ page, app }) => {
  await withBoard(app, async () => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    const pane = page.locator("[data-slot=board-page]");
    // The board shares the window with the chat pane: size the window so that the board pane is 600 wide.
    const extra = 600 - (await pane.evaluate((el) => el.getBoundingClientRect().width));
    await page.setViewportSize({ width: 600 + Math.round(extra), height: 800 });
    await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(600);
    await expect(cardsIn(page, "Done")).toHaveCount(1);
    const m = () => board.evaluate((el) => ({
      scroll: el.scrollWidth, client: el.clientWidth, left: el.scrollLeft,
      widths: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
    }));
    const narrow = await m();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(narrow.widths).toHaveLength(5);
    for (const w of narrow.widths) expect(w).toBeGreaterThanOrEqual(200);
    await board.hover();
    await page.mouse.wheel(2000, 0);
    await expect.poll(async () => (await m()).left).toBeGreaterThan(0);
    const done = await column(page, "Done").boundingBox();
    const b = await board.boundingBox();
    expect(done!.x + done!.width).toBeLessThanOrEqual(b!.x + b!.width + 1);
    expect(done!.x).toBeGreaterThanOrEqual(b!.x - 1);

    await page.setViewportSize({ width: 1600 + Math.round(extra), height: 800 });
    await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(1600);
    await expect.poll(async () => { const w = await m(); return w.scroll <= w.client; }).toBe(true);
    const wide = await m();
    const sum = wide.widths.reduce((a, c) => a + c, 0);
    expect(sum).toBeGreaterThan(wide.client * 0.9);
    expect(Math.max(...wide.widths) - Math.min(...wide.widths)).toBeLessThan(2);
  });
});
