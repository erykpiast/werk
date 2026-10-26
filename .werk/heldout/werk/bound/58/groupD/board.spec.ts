import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";
const jsonl = (...events: unknown[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const builder = (): ChildProcess => spawn("sleep", ["300"], { stdio: "ignore" });

function seed(app: BrowserServer, pid: number) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: root\nblocked_by: 1\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  writeFileSync(
    join(werk, "s1.jsonl"),
    jsonl(
      { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
      { at: "2026-10-25T10:00:07.000Z", event: { type: "assistant", message: { content: [{ type: "text", text: "Reading the ticket" }] } } },
    ),
  );
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      { type: "ticket.planned", id: "r/02", title: LONG, blocked_by: ["r/01", "r/06", "r/07"] },
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
      { type: "ticket.planned", id: "r/06", title: "Open blocker" },
      { type: "ticket.planned", id: "r/07", title: "Second blocker" },
    ),
  );
}
const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) => column(page, name).locator("[data-slot=ticket-card]");

test("44.1 columns, counts, and redraw after a command line move", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const names = await page.locator("[data-slot=column]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("h2,h3")?.textContent ?? ""),
    );
    expect(names.map((n) => n.toLowerCase().trim())).toEqual(["blocked", "ready", "building", "merging", "done"].map((n) => n));
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/]);
    await expect(cardsIn(page, "Ready").first().locator("[data-slot=blockers]")).toContainText("2");
    await expect(cardsIn(page, "Building").locator("[data-slot=retries]")).toContainText("3");
    await page.evaluate(() => {
      (window as unknown as { loaded: boolean }).loaded = true;
    });
    const mv = app.werk("ticket", "move", "r/06", "building");
    expect(mv.code, mv.stderr).toBe(0);
    await expect(cardsIn(page, "Building")).toHaveCount(2);
    await expect(column(page, "Ready").getByText("Open blocker")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
  } finally {
    proc.kill();
  }
});

test("44.2 long title clamps and drawer shows it in full", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveAttribute("title", LONG);
    const clamp = await title.evaluate((el) => ({
      lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
      cut: el.scrollHeight > el.clientHeight,
    }));
    expect(clamp).toEqual({ lines: 2, cut: true });
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const head = await drawer.evaluate((el) => {
      const h = el.querySelector("h1,h2,h3,header") as HTMLElement | null;
      const full = [...el.querySelectorAll("*")].find((n) => n.children.length === 0 && n.textContent?.trim() === "Import ticket files from the plan folder and skip ids that already exist on a second run") as HTMLElement | undefined;
      const id = [...el.querySelectorAll("*")].find((n) => n.children.length === 0 && /^(r\/02|#?r\/02)$/.test(n.textContent?.trim() ?? "")) as HTMLElement | undefined;
      return { h: !!h, fullTop: full?.getBoundingClientRect().top ?? null, idTop: id?.getBoundingClientRect().top ?? null };
    });
    expect(head.fullTop).not.toBeNull();
    expect(head.idTop).not.toBeNull();
    expect(head.idTop as number).toBeLessThan(head.fullTop as number);
    const board = await page.locator("[data-slot=board]").boundingBox();
    const dr = await drawer.boundingBox();
    expect((dr?.y ?? 0)).toBeGreaterThanOrEqual((board?.y ?? 0) + (board?.height ?? 0) - 2);
  } finally {
    proc.kill();
  }
});

test("44.3 dot only while the session process lives", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building");
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const box = await dot.boundingBox();
    const cbox = await card.boundingBox();
    expect((box?.x ?? 0) - (cbox?.x ?? 0)).toBeLessThan(20);
    expect((box?.y ?? 0) - (cbox?.y ?? 0)).toBeLessThan(20);
    const titleLeft = (await card.locator("[data-slot=ticket-title]").boundingBox())?.x ?? 0;
    proc.kill();
    // Nothing writes a session end; the dot goes by itself.
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const after = (await card.locator("[data-slot=ticket-title]").boundingBox())?.x ?? 0;
    expect(after).toBeLessThanOrEqual(titleLeft);
    expect(await card.locator("[data-slot=live-dot]").count()).toBe(0);
  } finally {
    proc.kill();
  }
});

test("44.4 drawer of a building ticket", async ({ page, app }) => {
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
    expect(logBox?.height ?? 0).toBeGreaterThan(0);
    await expect(log.locator("[data-slot=log-line]")).toHaveCount(2);
    await expect(log.locator("time").first()).toHaveText(/2026-10-25 10:00:00/);
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const word of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"]) {
      await expect(side).toContainText(word);
    }
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");
    await side.getByRole("button").first().click();
    await expect(side).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").first().click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("link", { name: /root/ }).first().click();
    await expect(page).toHaveURL(/\/map\/root$/);
    await page.goto(`${app.url}/board`);
    await cardsIn(page, "Building").click();
    appendFileSync(join(app.dir, ".werk", "board.jsonl"), jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }));
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(page.getByText("The ticket text of the building ticket.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 narrow pane scrolls sideways; wide pane fits", async ({ page, app }) => {
  const proc = builder();
  try {
    seed(app, proc.pid as number);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    const m = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
      }));
    const narrow = await m();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    for (const w of narrow.cols) expect(w).toBeGreaterThanOrEqual(200);
    await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(column(page, "Done")).toBeInViewport();
    await page.setViewportSize({ width: 1600, height: 800 });
    const wide = await m();
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    expect(wide.cols).toHaveLength(5);
    const sum = wide.cols.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(wide.client * 0.8);
  } finally {
    proc.kill();
  }
});
