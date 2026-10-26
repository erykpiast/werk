import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  jsonl,
  type Server,
  serveProject,
  spawnSleeper,
} from "./browser-a-support.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

function ticketFile(s: Server, id: string, title: string, body: string) {
  const [dir, n] = id.split("/");
  mkdirSync(join(s.dir, ".werk", "tickets", dir as string), { recursive: true });
  writeFileSync(
    join(s.dir, ".werk", "tickets", dir as string, `${n}.md`),
    `title: ${title}\ncites: root\nblocked_by: \nstories: 77, 78\ntouches: board view, live log\n\n## What to build\n\n${body}\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- \`make test\`\n- \`make lint\`\n`,
  );
}

const sessionLog = (n: number) =>
  jsonl(
    { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
    ...Array.from({ length: n }, (_, i) => ({
      at: `2026-10-25T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: `Step ${i + 1} of the work` }] },
      },
    })),
  );

function seedAll(s: Server, pid: number, logLines = 2) {
  const werk = join(s.dir, ".werk");
  ticketFile(s, "r/03", "Build it", "The ticket text of the building ticket.");
  writeFileSync(join(werk, "s1.jsonl"), sessionLog(logLines));
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
      { type: "ticket.planned", id: "r/06", title: "Open blocker one" },
      { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
      // building, but no session start: it never shows a dot
      { type: "ticket.planned", id: "r/08", title: "Building without session" },
      { type: "ticket.moved", id: "r/08", to: "building" },
    ),
  );
}

test("44.1 columns, counts, and a command line move redraws the board", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number);
    await page.goto(`${s.url}/board`);
    const cols = page.locator("[data-slot=board] [data-slot=column]");
    await expect(cols).toHaveCount(5);
    expect(await cols.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Blocked", "Ready", "Building", "Merging", "Done",
    ]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toContainText([/Import ticket/, /Open blocker one/, /Open blocker two/]);
    await expect(cardsIn(page, "Building").filter({ hasText: "Build it" })).toHaveCount(1);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(
      cardsIn(page, "Ready").filter({ hasText: "Import ticket" }).locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(
      cardsIn(page, "Building").filter({ hasText: "Build it" }).locator("[data-slot=retries]"),
    ).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    const moved = s.werk("ticket", "move", "r/06", "building");
    expect(moved.code, `werk ticket move: ${moved.stderr}`).toBe(0);
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
    await s.dispose();
  }
});

test("44.1b board redraws without reload on a board log move written to the log (diagnostic)", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number);
    await page.goto(`${s.url}/board`);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    appendFileSync(join(s.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/06", to: "building", actor: "loop" }));
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
    await s.dispose();
  }
});

test("44.2 a long title is cut on the card and full in the drawer", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto(`${s.url}/board`);
    const card = cardsIn(page, "Ready").filter({ hasText: "Import ticket" });
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toBeVisible();
    const m = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      return {
        shown: Math.round(el.clientHeight / lh),
        needed: Math.round(el.scrollHeight / lh),
        overflow: getComputedStyle(el).overflow,
        clamp: getComputedStyle(el).webkitLineClamp,
        ellipsis: getComputedStyle(el).textOverflow,
      };
    });
    expect(m.needed).toBeGreaterThanOrEqual(4);
    expect(m.shown).toBe(2);
    expect(m.clamp).toBe("2");
    // The tooltip is the browser's native title text.
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const board = await page.locator("[data-slot=board]").boundingBox();
    const box = await drawer.boundingBox();
    expect((box?.y as number) + 1).toBeGreaterThanOrEqual((board?.y as number) + (board?.height as number) - 1);
    const id = drawer.locator("header code");
    const full = drawer.getByRole("heading", { name: LONG });
    await expect(id).toHaveText("r/02");
    await expect(full).toBeVisible();
    const a = await id.boundingBox();
    const b = await full.boundingBox();
    expect((b?.y as number)).toBeGreaterThan((a?.y as number) + (a?.height as number) - 2);
  } finally {
    proc.kill();
    await s.dispose();
  }
});

async function titleIndent(card: ReturnType<typeof cardsIn>) {
  return card.locator("[data-slot=ticket-title]").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const first = range.getClientRects()[0] as DOMRect;
    return first.left - el.getBoundingClientRect().left;
  });
}

test("44.3 a building ticket pulses only while its session process is alive", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number);
    await page.goto(`${s.url}/board`);
    const card = cardsIn(page, "Building").filter({ hasText: "Build it" });
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const cardBox = (await card.boundingBox()) as { x: number; y: number };
    const dotBox = (await dot.boundingBox()) as { x: number; y: number };
    expect(dotBox.x - cardBox.x).toBeLessThan(24);
    expect(dotBox.y - cardBox.y).toBeLessThan(24);
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("pulse");
    const withDot = await titleIndent(card);
    expect(withDot).toBeGreaterThanOrEqual(8);
    expect(withDot).toBeLessThanOrEqual(24);

    // No session end is written. Only the process dies.
    proc.kill("SIGKILL");
    await expect(dot).toHaveCount(0, { timeout: 20000 });
    expect(await titleIndent(card)).toBeLessThan(2);
    // A building ticket with no running process never shows a dot.
    await expect(cardsIn(page, "Building").filter({ hasText: "Building without session" }).locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
    await s.dispose();
  }
});

test("44.4 the drawer of a building ticket: live log, sidebar, decisions, folded rail", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number, 60);
    appendFileSync(
      join(s.dir, ".werk", "log.jsonl"),
      jsonl(
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["root"] },
        { type: "node.proposed", id: "role-format", kind: "card", title: "The role is a plain word", status: "open", parent: "root", obligation: "o1" },
      ),
    );
    await page.goto(`${s.url}/board`);
    const card = cardsIn(page, "Building").filter({ hasText: "Build it" });
    await card.click();
    const log = page.getByRole("region", { name: "Live log" });
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines).toHaveCount(61);
    const scroller = log.locator("[data-slot=live-log-lines]");
    const dims = await scroller.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, ov: getComputedStyle(el).overflowY }));
    expect(dims.scroll).toBeGreaterThan(dims.client);
    expect(["auto", "scroll"]).toContain(dims.ov);
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const logBox = (await log.boundingBox()) as { y: number };
    const textBox = (await drawer.locator("[data-slot=ticket-text]").boundingBox()) as { y: number };
    expect(logBox.y).toBeLessThan(textBox.y);
    await expect(lines.first().locator("time")).toHaveText("2026-10-25 10:00:00");
    await expect(lines.nth(1)).toContainText("Step 1 of the work");

    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      // Blockers shows only when there are any; the ticket has none.
      if (name === "Blockers") continue;
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    await expect(side.getByRole("region", { name: "Checks" })).toContainText("make test");
    await expect(side.getByRole("region", { name: "Stories" })).toContainText("77");
    await expect(side.getByRole("region", { name: "Touches" })).toContainText("board view");
    const decisions = side.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("link", { name: "#root" }).first().click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goBack();
    await expect(cardsIn(page, "Building").filter({ hasText: "Build it" })).toBeVisible();
    // The board may come back with its drawer already open. Open it only when it is shut.
    if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0) {
      await cardsIn(page, "Building").filter({ hasText: "Build it" }).click();
    }
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await expect(cardsIn(page, "Building").filter({ hasText: "Build it" })).toBeVisible();
    if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0) {
      await cardsIn(page, "Building").filter({ hasText: "Build it" }).click();
    }
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    // The ticket leaves building: the live log goes, the text and the sidebar stay.
    appendFileSync(join(s.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
    await s.dispose();
  }
});

test("44.5 a narrow pane scrolls sideways, a wide pane fits five columns", async ({ page }) => {
  const s = await serveProject();
  const proc = spawnSleeper();
  try {
    seedAll(s, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${s.url}/board`);
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
    const wide = await board.evaluate((el) => {
      const cols = [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect());
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        left: cols[0]?.left as number,
        right: cols[cols.length - 1]?.right as number,
        boardRight: el.getBoundingClientRect().right,
        boardLeft: el.getBoundingClientRect().left,
        widths: cols.map((c) => c.width),
      };
    });
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    // five columns share the full width: the last ends near the board's right edge
    expect(wide.boardRight - wide.right).toBeLessThan(40);
    expect(wide.widths).toHaveLength(5);
  } finally {
    proc.kill();
    await s.dispose();
  }
});
