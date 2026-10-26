import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { builder, cardsIn, column, jsonl, LONG, seed } from "./seed.ts";

test("44.1 tickets sit in their columns; a command line move redraws the board", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const names = await page
      .locator("[data-slot=column]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Ready").filter({ hasText: /Import ticket/ })).toHaveCount(1);
    await expect(
      cardsIn(page, "Ready").filter({ hasText: /Import ticket/ }).locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(
      cardsIn(page, "Building").filter({ hasText: /Build it/ }).locator("[data-slot=retries]"),
    ).toHaveText("↻3");

    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    // Move the open blocker r/06 (ready) into building with the command line.
    const moved = app.werk("ticket", "move", "r/06", "building");
    expect(moved.code, moved.stdout + moved.stderr).toBe(0);
    await expect(
      cardsIn(page, "Building").filter({ hasText: /Open blocker/ }),
    ).toHaveCount(1);
    await expect(
      cardsIn(page, "Ready").filter({ hasText: /Open blocker/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
    ).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.1b (diagnostic) a board log event redraws the board without reload", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    await expect(cardsIn(page, "Ready").filter({ hasText: /Open blocker/ })).toHaveCount(1);
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/06", to: "building", actor: "you" }),
    );
    await expect(cardsIn(page, "Building").filter({ hasText: /Open blocker/ })).toHaveCount(1);
    await expect(cardsIn(page, "Ready").filter({ hasText: /Open blocker/ })).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded),
    ).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 long title: two lines and ellipsis, tooltip, drawer header", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").filter({ hasText: /Import ticket/ });
    const title = card.locator("[data-slot=ticket-title]");
    const info = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      return {
        full: el.scrollHeight / lh,
        shown: el.clientHeight / lh,
        clamp: getComputedStyle(el).webkitLineClamp,
        overflow: getComputedStyle(el).overflow,
      };
    });
    // The full title needs at least four lines; the card shows two.
    expect(info.full).toBeGreaterThanOrEqual(4);
    expect(Math.round(info.shown)).toBe(2);
    expect(info.clamp).toBe("2");
    // Pointing at the title: a tooltip with the full title (the title attribute).
    await title.hover();
    await expect(title).toHaveAttribute("title", LONG);
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    // The drawer is beneath the board.
    const board = await page.locator("[data-slot=board]").boundingBox();
    const dbox = await drawer.boundingBox();
    expect((dbox as { y: number }).y).toBeGreaterThanOrEqual(
      (board as { y: number; height: number }).y + (board as { height: number }).height - 1,
    );
    const id = await drawer.locator("[data-slot=drawer-bar] code").boundingBox();
    const full = drawer.getByRole("heading", { name: LONG });
    await expect(full).toBeVisible();
    const fbox = await full.boundingBox();
    expect((id as { y: number }).y).toBeLessThan((fbox as { y: number }).y);
    await expect(drawer.locator("[data-slot=drawer-bar] code")).toHaveText("r/02");
  } finally {
    proc.kill();
  }
});

test("44.3 pulsing dot only while the session process is alive", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building").filter({ hasText: /Build it/ });
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const geometry = () =>
      card.evaluate((el) => {
        const t = el.querySelector("[data-slot=ticket-title]") as HTMLElement;
        const node = t.firstChild as Text;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        const c = el.getBoundingClientRect();
        const dotEl = el.querySelector("[data-slot=live-dot]");
        return {
          textLeft: range.getBoundingClientRect().left - c.left,
          dotRight: dotEl ? dotEl.getBoundingClientRect().right - c.left : null,
          dotLeft: dotEl ? dotEl.getBoundingClientRect().left - c.left : null,
          dotTop: dotEl ? dotEl.getBoundingClientRect().top - c.top : null,
          anim: dotEl ? getComputedStyle(dotEl).animationName : null,
        };
      });
    const withDot = await geometry();
    expect(withDot.anim).not.toBe("none");
    // top-left corner
    expect(withDot.dotLeft as number).toBeLessThan(20);
    expect(withDot.dotTop as number).toBeLessThan(20);
    // title first line sits a few pixels right of the dot
    const gap = withDot.textLeft - (withDot.dotRight as number);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(12);
    // a building ticket with no running process shows no dot
    await expect(
      cardsIn(page, "Building").filter({ hasText: /Building without process/ }).locator("[data-slot=live-dot]"),
    ).toHaveCount(0);

    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 20_000 });
    const after = await geometry();
    expect(after.textLeft).toBeLessThan(withDot.textLeft);
  } finally {
    proc.kill();
  }
});

test("44.4 drawer of a building ticket: live log, sidebar, decisions, fold, leaving building", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number, 60);
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
    await cardsIn(page, "Building").filter({ hasText: /Build it/ }).click();
    const log = page.getByRole("region", { name: "Live log" });
    const lines = log.locator("[data-slot=log-line]");
    await expect(lines).toHaveCount(61);
    const scroller = log.locator("[data-slot=live-log-lines]");
    const dims = await scroller.evaluate((el) => ({
      h: el.clientHeight,
      sh: el.scrollHeight,
      css: getComputedStyle(el).height,
    }));
    expect(dims.sh).toBeGreaterThan(dims.h);
    // fixed height above the ticket text
    const lb = await log.boundingBox();
    const tb = await page.locator("[data-slot=ticket-text]").boundingBox();
    expect((lb as { y: number }).y).toBeLessThan((tb as { y: number }).y);
    await expect(lines.first().locator("time")).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    await expect(lines.nth(1).locator("span")).toHaveText("agent: Step number 0");

    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side.getByRole("region", { name })).toBeVisible();
    }
    // blockers: the ticket has none; the section may be absent. Record it.
    const decisions = side.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("link", { name: "#root" }).click();
    await expect(page).toHaveURL(/\/map\/root$/);

    await page.goBack();
    await expect(cardsIn(page, "Building").first()).toBeVisible();
    if (!(await page.getByRole("region", { name: "Ticket drawer" }).isVisible()))
      await cardsIn(page, "Building").filter({ hasText: /Build it/ }).click();
    const side2 = page.getByRole("complementary", { name: "Ticket details" });
    await side2.getByRole("button").click();
    await expect(side2).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await expect(cardsIn(page, "Building").first()).toBeVisible();
    if (!(await page.getByRole("region", { name: "Ticket drawer" }).isVisible()))
      await cardsIn(page, "Building").filter({ hasText: /Build it/ }).click();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toHaveAttribute("data-mode", "rail");
    // unfold again so the sidebar can be checked after the ticket leaves building
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();

    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(log).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Ticket details" }),
    ).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 narrow pane scrolls sideways; wide pane shares the width", async ({
  page,
  app,
}) => {
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
      overflow: getComputedStyle(el).overflowX,
      widths: [...el.querySelectorAll("[data-slot=column]")].map(
        (c) => c.getBoundingClientRect().width,
      ),
    }));
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(["auto", "scroll"]).toContain(narrow.overflow);
    expect(narrow.widths).toHaveLength(5);
    for (const w of narrow.widths) expect(w).toBeGreaterThanOrEqual(200);
    await board.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const done = await column(page, "Done").boundingBox();
    expect((done as { x: number; width: number }).x + (done as { width: number }).width).toBeLessThanOrEqual(601);
    expect((done as { x: number }).x).toBeGreaterThanOrEqual(0);

    await page.setViewportSize({ width: 1600, height: 800 });
    const wide = await board.evaluate((el) => {
      const cols = [...el.querySelectorAll("[data-slot=column]")].map((c) =>
        c.getBoundingClientRect(),
      );
      const b = el.getBoundingClientRect();
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        widths: cols.map((c) => c.width),
        leftGap: cols[0].left - b.left,
        rightGap: b.right - cols[4].right,
      };
    });
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    const [min, max] = [Math.min(...wide.widths), Math.max(...wide.widths)];
    expect(max - min).toBeLessThan(2);
    expect(wide.rightGap).toBeLessThan(wide.leftGap + 40);
    expect(wide.widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(wide.client * 0.9);
  } finally {
    proc.kill();
  }
});
