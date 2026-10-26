import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";
import { cleanEnv } from "../../src/test-env/env.ts";
import {
  decide,
  link,
  open,
} from "../../src/map/mark-fixtures.ts";

const jsonl = (...events: unknown[]) =>
  `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`;

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

const addCard = (app: BrowserServer, id: string, title: string, parent: string) =>
  expect(app.werk("add", id, "--title", title, "--parent", parent).code).toBe(0);
const accept = (app: BrowserServer, id: string) =>
  expect(app.werk("accept", id, "--actor", "you").code).toBe(0);

// ---------------------------------------------------------------- 14

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  expect(
    app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code,
  ).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

function listeners(port: string): string {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  return r.stdout.trim().split("\n").sort().join(",");
}

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  const server = await startBrowserServer({ appCopy: true });
  const cli = join(server.appDir, "src", "cli.ts");
  const port = new URL(server.origin).port;
  let output = "";
  const home = server.home;
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", port], {
    cwd: server.dir,
    env: {
      ...cleanEnv(process.env),
      WERK_OPEN: "true",
      WERK_DEV: "1",
      WERK_HOME: home,
    },
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  try {
    await expect
      .poll(async () => (await fetch(`${server.origin}/api/projects`).catch(() => null))?.ok === true, { timeout: 30000 })
      .toBe(true);
    await page.goto(server.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);
    const before = listeners(port);
    expect(before).not.toBe("");
    const first = await (await fetch(`${server.origin}/api/projects`)).json();
    expect(first.edited).toBeUndefined();

    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(src).toContain(needle);
    writeFileSync(
      routes,
      src.replace(needle, "return json({ projects: entries(ctx.projects), edited: true });"),
    );

    await expect
      .poll(() => output, { timeout: 20000 })
      .toContain("reusing the live server");
    await expect
      .poll(async () => (await (await fetch(`${server.origin}/api/projects`)).json()).edited, { timeout: 20000 })
      .toBe(true);
    expect(listeners(port)).toBe(before);

    expect(
      server.werk("add", "after", "--title", "After edit", "--parent", "root").code,
    ).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await server.dispose();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  addCard(appCopy, "c1", "A card page", "root");
  accept(appCopy, "c1");
  await page.goto(`${appCopy.url}/map/c1`);
  const heading = leftPane(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("A card page");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(heading).toHaveText("A card page");
  await expect(composer).toHaveValue("draft that must survive");
});

// ---------------------------------------------------------------- 17

const logPath = (app: BrowserServer) => join(app.dir, ".werk", "log.jsonl");

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
  app,
}) => {
  for (const [id, parent] of [["a", "root"], ["b", "a"], ["c", "b"], ["d", "c"]]) {
    addCard(app, id as string, `Level ${id}`, parent as string);
    accept(app, id as string);
  }
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(app.url);
  const pane = leftPane(page);
  await expect(pane.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await pane.boundingBox())?.width).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) {
    await pane.locator("a.tile", { hasText: `Level ${id}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/map/${id}$`));
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toHaveText(/^\s*…\s*›\s*Level c\s*›\s*Level d\s*$/);
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  await expect(line.locator("strong")).toHaveText("Level d");
  expect(await line.locator("strong").evaluate((e) => Number(getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(line.getByRole("button", { name: "Level c" })).toBeVisible();

  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  const text = (await overlay.innerText()).replace(/\s+/g, " ");
  expect(text).toMatch(
    /We build software with agents › Level a › Level b › Level c › Level d/,
  );

  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(crumbs.locator("[data-slot=crumb-line] strong")).toHaveText("Level c");
  await expect(crumbs.locator("[data-slot=crumb-line] strong")).toBeVisible();
});

const counts = (page: Page) =>
  page.locator("[data-slot=counts] [data-slot=count]");

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  appendFileSync(
    logPath(app),
    jsonl(
      { type: "node.edited", id: "root", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "root", form: "revisit" },
      decide("root"),
      open("a", { parent: "root", title: "Open card" }),
      open("p", { parent: "root", title: "Proto card", status: "proto" }),
      ...[
        open("d2", { parent: "root", title: "Decided card" }),
        { type: "node.edited", id: "d2", who: "me", noBasis: "test" },
        { type: "criterion.added", id: "d2", form: "revisit" },
        decide("d2"),
      ],
      open("base", { parent: "root", title: "Base card" }),
      { type: "node.edited", id: "base", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "base", form: "revisit" },
      decide("base"),
      open("s", { parent: "root", title: "Stale card" }),
      { type: "node.edited", id: "s", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "s", form: "revisit" },
      decide("s"),
      link("s", "base"),
      open("a1", { parent: "a", title: "Below open card" }),
    ),
  );
  const reopened = app.werk("reopen", "base", "--why", "changed");
  expect(reopened.code, reopened.stderr).toBe(0);
  await page.goto(`${app.url}/map/root`);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const kinds = async () =>
    Object.fromEntries(
      await counts(page).evaluateAll((els) =>
        els.map((e) => [e.getAttribute("data-kind"), Number(e.textContent)]),
      ),
    ) as Record<string, number>;
  await expect.poll(async () => (await kinds()).total).toBeGreaterThan(1);
  const root = await kinds();
  console.log("root counts", JSON.stringify(root));
  expect(root.open + (root.proto ?? 0) + (root.decided ?? 0)).toBe(root.total);
  expect(root.stale).toBeGreaterThan(0);
  for (const kind of ["open", "proto", "decided"]) {
    await expect(
      page.locator(`[data-slot=count][data-kind=${kind}]`),
    ).toHaveAttribute("title", new RegExp(kind));
  }
  await expect(page.locator("[data-slot=count][data-kind=total]")).toHaveText(
    String(root.total),
  );
  // A zero count is left out: a card with no proto child shows no proto count.
  await page.goto(`${app.url}/map/a`);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Open card" })).toBeVisible();
  await expect.poll(async () => (await kinds()).total).toBe(2);
  const sub = await kinds();
  expect(sub.open).toBe(2);
  expect(sub.proto).toBeUndefined();
  expect(sub.decided).toBeUndefined();
  expect(sub.total).toBeLessThan(root.total);
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
  app,
}) => {
  const events: unknown[] = [];
  events.push(
    { type: "node.edited", id: "root", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "root", form: "revisit" },
    decide("root"),
  );
  // Contains-only ids first in the log, so the order of the list comes from the ranking.
  for (let i = 1; i <= 6; i++)
    events.push(open(`x-werk-${i}`, { parent: "root", title: `Contains ${i}` }));
  // A stale card whose id starts with werk.
  events.push(
    open("base", { parent: "root", title: "Base" }),
    { type: "node.edited", id: "base", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "base", form: "revisit" },
    decide("base"),
    open("werk-stale", { parent: "root", title: "Stale werk card" }),
    { type: "node.edited", id: "werk-stale", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "werk-stale", form: "revisit" },
    decide("werk-stale"),
    link("werk-stale", "base"),
  );
  for (let i = 1; i <= 7; i++)
    events.push(open(`werk-${i}`, { parent: "root", title: `Prefix ${i}` }));
  events.push(open("werk", { parent: "root", title: "The werk card" }));
  appendFileSync(logPath(app), jsonl(...events));
  const reopened = app.werk("reopen", "base", "--why", "changed");
  expect(reopened.code, reopened.stderr).toBe(0);

  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).locator("li");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeLessThanOrEqual(12);
  expect(count).toBe(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  const lastPrefix = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
  expect(firstContains === -1 || firstContains > lastPrefix).toBe(true);
  console.log("search ids", JSON.stringify(ids));
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
    await expect(row.locator("code")).not.toHaveText("");
  }
  const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  await expect(stale).toHaveCount(1);
  const dot = stale.locator("[data-slot=dot]");
  await expect(dot).toHaveAttribute("data-color", "stale");
  const [r, g, b] = await dot.evaluate((el) => {
    const c = getComputedStyle(el);
    const m = (c.backgroundColor !== "rgba(0, 0, 0, 0)" ? c.backgroundColor : c.color).match(/[\d.]+/g) ?? [];
    return m.slice(0, 3).map(Number);
  });
  expect(r).toBeGreaterThan(g as number);
  expect(r).toBeGreaterThan(b as number);

  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(
    page.locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
  ).toHaveText("The werk card");
  await expect(
    page.locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
  ).toHaveCSS("font-weight", /^(600|700|800|900)$/);
  await expect(box).toHaveValue("");
});

// ---------------------------------------------------------------- 44

const LONG =
  "Import ticket files from the plan folder and skip ids that already exist on a second run";

function builder(): ChildProcess {
  return spawn("sleep", ["300"], { stdio: "ignore" });
}

type Seed = {
  pid: number;
  /** Extra lines for the session log. */
  events?: number;
  retries?: number;
  longReady?: boolean;
};

function seedBoard(app: BrowserServer, o: Seed) {
  const werk = join(app.dir, ".werk");
  mkdirSync(join(werk, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(werk, "tickets", "r", "03.md"),
    "title: Build it\ncites: dec\nblocked_by: r/01\nstories: 77\ntouches: board view\n\n## What to build\n\nThe ticket text of the building ticket.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- `make test`\n",
  );
  const lines: unknown[] = [
    { at: "2026-10-25T10:00:00.000Z", event: { type: "system", subtype: "init" } },
  ];
  for (let i = 0; i < (o.events ?? 2); i++)
    lines.push({
      at: `2026-10-25T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: `Step ${i + 1} of the work` }] },
      },
    });
  writeFileSync(join(werk, "s1.jsonl"), jsonl(...lines));
  const passes = Array.from({ length: o.retries ?? 3 }, (_, i) => ({
    type: "ticket.pass",
    id: "r/03",
    n: i + 1,
    result: "red",
  }));
  writeFileSync(
    join(werk, "board.jsonl"),
    jsonl(
      { type: "ticket.planned", id: "r/01", title: "Done ticket" },
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
      {
        type: "ticket.planned",
        id: "r/02",
        title: LONG,
        blocked_by: ["r/06", "r/07"],
      },
      { type: "ticket.planned", id: "r/03", title: "Build it", blocked_by: ["r/01"] },
      { type: "ticket.moved", id: "r/03", to: "building" },
      { type: "build.started", id: "r/03", session: "s1", pid: o.pid, log: "s1.jsonl" },
      ...passes,
      { type: "ticket.planned", id: "r/04", title: "Blocked ticket", reason: "a cited card is stale" },
      { type: "ticket.planned", id: "r/05", title: "Merging ticket" },
      { type: "ticket.moved", id: "r/05", to: "building" },
      { type: "ticket.moved", id: "r/05", to: "merging", actor: "loop" },
      { type: "ticket.planned", id: "r/06", title: "Open blocker one" },
      { type: "ticket.planned", id: "r/07", title: "Open blocker two" },
      { type: "ticket.planned", id: "r/08", title: "Idle building ticket" },
      { type: "ticket.moved", id: "r/08", to: "building" },
    ),
  );
}

const column = (page: Page, name: string) => page.getByRole("region", { name });
const cardsIn = (page: Page, name: string) =>
  column(page, name).locator("[data-slot=ticket-card]");

test("44.1 tickets appear in their columns and a command line move redraws the board", async ({
  page,
}) => {
  // The fake builder waits 25 seconds, so a ticket that `werk build` moves stays in building.
  const app = await startBrowserServer({
    script: { roles: { builder: { replies: [[{ pause: 25000 }]] } } },
  });
  await app.start();
  const proc = builder();
  let build: ChildProcess | undefined;
  try {
    seedBoard(app, { pid: proc.pid as number });
    writeFileSync(
      join(app.dir, ".werk", "tickets", "r", "06.md"),
      "title: Open blocker one\ncites: root\nblocked_by: \nstories: 1\ntouches: x\n\n## What to build\n\nx\n\n## Acceptance criteria\n\n- [ ] ok\n\n## Checks\n\n- `true`\n",
    );
    for (const args of [["add", "-A"], ["-c", "user.email=a@b.c", "-c", "user.name=x", "commit", "-qm", "init"]])
      expect(spawnSync("git", args, { cwd: app.dir }).status).toBe(0);
    await page.goto(`${app.url}/board`);
    await expect(column(page, "Done")).toBeVisible();
    const order = await page
      .locator("[data-slot=board] [data-slot=column]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(order).toEqual(["Blocked", "Ready", "Building", "Merging", "Done"]);
    await expect(cardsIn(page, "Blocked")).toHaveText([/Blocked ticket/]);
    await expect(cardsIn(page, "Ready")).toHaveText([
      /Import ticket/,
      /Open blocker one/,
      /Open blocker two/,
    ]);
    await expect(cardsIn(page, "Building")).toHaveText([/Build it/, /Idle building/]);
    await expect(cardsIn(page, "Merging")).toHaveText([/Merging ticket/]);
    await expect(cardsIn(page, "Done")).toHaveText([/Done ticket/]);
    await expect(
      cardsIn(page, "Ready").first().locator("[data-slot=blockers]"),
    ).toHaveText("⊘2");
    await expect(
      cardsIn(page, "Building").first().locator("[data-slot=retries]"),
    ).toHaveText("↻3");

    await markLoaded(page);
    // The werk command line has no verb that only moves a ticket. `build` moves a ready ticket into building.
    let output = "";
    build = spawn("bun", [join(app.appDir, "src", "cli.ts"), "build", "r/06", "--cap", "1"], {
      cwd: app.dir,
      env: { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_HOME: app.home, WERK_FAKE_SCRIPT: join(app.dir, "..", "script.json") },
    });
    for (const st of [build.stdout, build.stderr]) st?.on("data", (c) => { output += String(c); });
    await expect(cardsIn(page, "Building").filter({ hasText: "Open blocker one" })).toHaveCount(1, { timeout: 20000 });
    await expect(cardsIn(page, "Ready").filter({ hasText: "Open blocker one" })).toHaveCount(0);
    console.log("build output:", output);
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    build?.kill();
    proc.kill();
    await app.dispose();
  }
});

test("44.2 a long title is cut on the card and shown in full in the drawer", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seedBoard(app, { pid: proc.pid as number });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Ready").first();
    const title = card.locator("[data-slot=ticket-title]");
    await expect(title).toHaveText(LONG);
    const m = await title.evaluate((el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      return {
        shown: Math.round(el.clientHeight / lh),
        natural: Math.round(el.scrollHeight / lh),
        clamp: getComputedStyle(el).webkitLineClamp,
        overflow: getComputedStyle(el).overflow,
        ellipsisMode: getComputedStyle(el).textOverflow,
      };
    });
    console.log("clamp", JSON.stringify(m));
    expect(m.natural).toBeGreaterThanOrEqual(4);
    expect(m.shown).toBe(2);
    expect(m.clamp).toBe("2");
    await expect(title).toHaveAttribute("title", LONG);
    await title.hover();
    await card.click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    await expect(drawer).toBeVisible();
    const board = await page.locator("[data-slot=board]").boundingBox();
    const dbox = await drawer.boundingBox();
    expect((dbox?.y ?? 0)).toBeGreaterThanOrEqual((board?.y ?? 0) + (board?.height ?? 0) - 2);
    const id = await drawer.locator("header code").boundingBox();
    const h = drawer.locator("header h2");
    await expect(h).toHaveText(LONG);
    const hb = await h.boundingBox();
    expect(await drawer.locator("header code").textContent()).toBe("r/02");
    expect((hb?.y ?? 0)).toBeGreaterThanOrEqual((id?.y ?? 0) + (id?.height ?? 0) - 1);
  } finally {
    proc.kill();
  }
});

test("44.3 a building ticket pulses only while its session process is alive", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seedBoard(app, { pid: proc.pid as number });
    await page.goto(`${app.url}/board`);
    const card = cardsIn(page, "Building").filter({ hasText: "Build it" });
    const dot = card.locator("[data-slot=live-dot]");
    await expect(dot).toBeVisible();
    const geo = async () =>
      card.evaluate((c) => {
        const cb = c.getBoundingClientRect();
        const d = c.querySelector("[data-slot=live-dot]")?.getBoundingClientRect();
        const t = c.querySelector("[data-slot=ticket-title]") as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(t);
        const first = range.getClientRects()[0] as DOMRect;
        return {
          cardLeft: cb.left, cardTop: cb.top,
          dot: d ? { dx: d.left - cb.left, dy: d.top - cb.top, right: d.right - cb.left, w: d.width } : null,
          textLeft: first.left - cb.left,
          anim: d ? getComputedStyle(c.querySelector("[data-slot=live-dot]") as Element).animationName : null,
        };
      });
    const alive = await geo();
    console.log("alive", JSON.stringify(alive));
    expect(alive.dot).not.toBeNull();
    expect(alive.dot?.dx).toBeLessThan(20);
    expect(alive.dot?.dy).toBeLessThan(20);
    expect(alive.anim).not.toBe("none");
    const gap = alive.textLeft - (alive.dot?.right ?? 0);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(12);
    const idle = cardsIn(page, "Building").filter({ hasText: "Idle building" });
    await expect(idle.locator("[data-slot=live-dot]")).toHaveCount(0);

    proc.kill();
    await expect(dot).toHaveCount(0, { timeout: 15000 });
    const dead = await geo();
    console.log("dead", JSON.stringify(dead));
    expect(dead.textLeft).toBeLessThan(alive.textLeft);
    await expect(idle.locator("[data-slot=live-dot]")).toHaveCount(0);
  } finally {
    proc.kill();
  }
});

test("44.4 the drawer of a building ticket shows the live log, the sidebar and the decisions", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seedBoard(app, { pid: proc.pid as number, events: 60 });
    appendFileSync(
      logPath(app),
      jsonl(
        open("dec", { parent: "root", title: "A decided card" }),
        { type: "node.edited", id: "dec", who: "me", noBasis: "test" },
        { type: "criterion.added", id: "dec", form: "revisit" },
        decide("dec"),
        { type: "obligation.opened", id: "o1", ticket: "r/03", cites: ["dec"] },
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
    await cardsIn(page, "Building").filter({ hasText: "Build it" }).click();
    const drawer = page.getByRole("region", { name: "Ticket drawer" });
    const log = page.getByRole("region", { name: "Live log" });
    await expect(log).toBeVisible();
    await expect(log.locator("[data-slot=log-line]").first()).toBeVisible();
    const lay = await page.evaluate(() => {
      const l = document.querySelector("[data-slot=live-log]") as HTMLElement;
      const lines = document.querySelector("[data-slot=live-log-lines]") as HTMLElement;
      const t = document.querySelector("[data-slot=ticket-text]") as HTMLElement;
      return {
        logBottom: l.getBoundingClientRect().bottom,
        textTop: t.getBoundingClientRect().top,
        linesClient: lines.clientHeight,
        linesScroll: lines.scrollHeight,
        count: lines.querySelectorAll("[data-slot=log-line]").length,
      };
    });
    console.log("layout", JSON.stringify(lay));
    expect(lay.logBottom).toBeLessThanOrEqual(lay.textTop + 1);
    expect(lay.linesScroll).toBeGreaterThan(lay.linesClient);
    expect(lay.count).toBe(61);
    await expect(log.locator("time").first()).toHaveText("2026-10-25 10:00:00");
    await expect(log.locator("[data-slot=log-line]").last()).toContainText("Step 60 of the work");
    const side = page.getByRole("complementary", { name: "Ticket details" });
    for (const name of ["Cites", "Blockers", "Retries", "Checks", "Stories", "Touches"])
      await expect(side.getByRole("region", { name })).toBeVisible();
    const decisions = page.getByRole("region", { name: "Decisions" });
    await expect(decisions).toContainText("#role-format");
    await expect(decisions).toContainText("proposal");

    await side.getByRole("region", { name: "Cites" }).getByRole("link", { name: "#dec" }).click();
    await expect(page).toHaveURL(/\/map\/dec$/);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "A decided card" })).toBeVisible();

    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Board" }).click();
    await expect(cardsIn(page, "Building").filter({ hasText: "Build it" })).toBeVisible();
    // The page keeps the open ticket, so the drawer is back as soon as the board shows.
    if ((await page.getByRole("region", { name: "Ticket drawer" }).count()) === 0)
      await cardsIn(page, "Building").filter({ hasText: "Build it" }).click();
    await page.getByRole("complementary", { name: "Ticket details" }).getByRole("button").click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");
    await page.reload();
    await cardsIn(page, "Building").filter({ hasText: "Build it" }).click();
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toHaveAttribute("data-mode", "rail");

    appendFileSync(
      join(app.dir, ".werk", "board.jsonl"),
      jsonl({ type: "ticket.moved", id: "r/03", to: "ready", actor: "you" }),
    );
    await expect(page.getByRole("region", { name: "Live log" })).toHaveCount(0);
    await expect(drawer.locator("[data-slot=ticket-text]")).toContainText("The ticket text of the building ticket.");
    await expect(page.getByRole("complementary", { name: "Ticket details" })).toBeVisible();
  } finally {
    proc.kill();
  }
});

test("44.5 a narrow pane scrolls the board sideways and keeps columns readable", async ({
  page,
  app,
}) => {
  const proc = builder();
  try {
    seedBoard(app, { pid: proc.pid as number });
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${app.url}/board`);
    const board = page.locator("[data-slot=board]");
    await expect(board).toBeVisible();
    const sizes = () =>
      board.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cols: [...el.querySelectorAll("[data-slot=column]")].map((c) => c.getBoundingClientRect().width),
        gap: Number.parseFloat(getComputedStyle(el).columnGap) || 0,
        pad: Number.parseFloat(getComputedStyle(el).paddingLeft) + Number.parseFloat(getComputedStyle(el).paddingRight),
      }));
    const narrow = await sizes();
    expect(narrow.scroll).toBeGreaterThan(narrow.client);
    expect(narrow.cols).toHaveLength(5);
    for (const w of narrow.cols) expect(w).toBeGreaterThanOrEqual(200);
    const doneBefore = await column(page, "Done").boundingBox();
    expect((doneBefore?.x ?? 0) + (doneBefore?.width ?? 0)).toBeGreaterThan(600);
    const b = await board.boundingBox();
    await page.mouse.move((b?.x ?? 0) + 100, (b?.y ?? 0) + 100);
    await page.mouse.wheel(2000, 0);
    await expect
      .poll(async () => {
        const d = await column(page, "Done").boundingBox();
        return (d?.x ?? 0) + (d?.width ?? 0);
      })
      .toBeLessThanOrEqual(600);

    await page.setViewportSize({ width: 1600, height: 800 });
    await expect
      .poll(async () => {
        const s = await sizes();
        return s.scroll <= s.client;
      })
      .toBe(true);
    const wide = await sizes();
    const total = wide.cols.reduce((a, c) => a + c, 0);
    console.log("wide", JSON.stringify(wide));
    expect(Math.abs(total + wide.gap * 4 + wide.pad - wide.client)).toBeLessThan(2);
    expect(Math.max(...wide.cols) - Math.min(...wide.cols)).toBeLessThan(2);
  } finally {
    proc.kill();
  }
});
