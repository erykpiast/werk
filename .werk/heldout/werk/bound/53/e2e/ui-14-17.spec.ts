import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";
import {
  decided,
  link,
  open,
  reopen,
} from "../../src/map/mark-fixtures.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";

const ROOT_TITLE = "We build software with agents";
const FIXTURE = resolve(import.meta.dirname, "../../e2e/fixtures/project");

const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

const writeEvents = (dir: string, ...events: unknown[]) =>
  appendFileSync(
    join(dir, ".werk", "log.jsonl"),
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
const rootDecided = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];
const kid = (id: string, extra: Record<string, unknown> = {}) => ({
  parent: "root",
  title: `Title ${id}`,
  ...extra,
});

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const r = app.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(r.code).toBe(0);
  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

test("14.2 a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(join(tmpdir(), "werk-ho-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const env = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    WERK_DEV: "1",
    WERK_HOME: join(root, "home"),
  };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env,
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  try {
    for (let i = 0; i < 300; i++) {
      const ok = await fetch(`${origin}/api/projects`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const lock = () =>
      JSON.parse(readFileSync(join(root, "home", "serve.lock"), "utf8"));
    const before = lock();
    await page.goto(`${origin}/p/${basename(dir)}`);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);

    const routes = join(appDir, "src", "serve", "routes.ts");
    writeFileSync(
      routes,
      readFileSync(routes, "utf8").replace(
        "return json({ projects: entries(ctx.projects) });",
        "return json({ projects: entries(ctx.projects), edited: true });",
      ),
    );
    await expect
      .poll(() => output, { timeout: 30000 })
      .toContain("reusing the live server");
    await expect
      .poll(
        async () =>
          (await fetch(`${origin}/api/projects`).then((r) => r.json())).edited,
        { timeout: 30000 },
      )
      .toBe(true);
    expect(lock()).toEqual(before);
    expect(child.exitCode).toBeNull();

    const added = spawnSync(
      "bun",
      [cli, "add", "afteredit", "--title", "After edit", "--parent", "root"],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(added.status).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  await page.goto(appCopy.url);
  const title = leftPane(page).getByRole("heading", { level: 1 });
  await expect(title).toHaveText(ROOT_TITLE);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(title).toHaveText(ROOT_TITLE);
  await expect(composer).toHaveValue("draft that must survive");
});

test("17.1 a deep card: breadcrumbs on one line, overlay on hover, click the parent", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const add = (id: string, parent: string) =>
    expect(
      app.werk("add", id, "--title", `Level ${id}`, "--parent", parent).code,
    ).toBe(0);
  add("a", "root");
  add("b", "a");
  add("c", "b");
  add("d", "c");
  expect(app.werk("accept", "d", "--actor", "you").code).toBe(0);

  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.getElementById("left-pane")?.clientWidth),
  ).toBeLessThan(700);
  for (const [id, t] of [
    ["a", "Level a"],
    ["b", "Level b"],
    ["c", "Level c"],
    ["d", "Level d"],
  ]) {
    await leftPane(page).locator(`a.tile[href$="/map/${id}"]`).click();
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: t }),
    ).toBeVisible();
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toContainText("…");
  expect((await line.boundingBox())?.height).toBeLessThan(40);
  const items = line.locator("[data-slot=crumb-item]");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Level c");
  await expect(items.nth(1)).toContainText("›");
  await expect(
    line.locator("[data-slot=crumb-current]"),
  ).toHaveText("Level d");
  expect(
    await line
      .locator("[data-slot=crumb-current]")
      .evaluate((e) => getComputedStyle(e).fontWeight),
  ).toMatch(/^(bold|[6-9]00)$/);
  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  for (const t of [ROOT_TITLE, "Level a", "Level b", "Level c", "Level d"])
    await expect(overlay).toContainText(t);
  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Level c" }),
  ).toBeVisible();
  await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
});

test("17.2 the header counts follow the open card", async ({ page, app }) => {
  writeEvents(
    app.dir,
    rootDecided,
    open("o", kid("o")),
    open("o1", { parent: "o", title: "Title o1" }),
    open("o2", { parent: "o", title: "Title o2", status: "proto" }),
    open("p", kid("p", { status: "proto" })),
    decided("d", kid("d")),
    decided("b", kid("b")),
    decided("s", kid("s")),
    link("s", "b"),
    reopen("b"),
  );
  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  const counts = page.locator("[data-slot=counts]");
  const num = async (kind: string) => {
    const el = counts.locator(`[data-kind=${kind}]`);
    return (await el.count()) === 0 ? null : Number(await el.textContent());
  };
  await expect(counts.locator("[data-kind=total]")).toBeVisible();
  const total = await num("total");
  const o = await num("open");
  const p = await num("proto");
  const d = await num("decided");
  expect(total).toBe(8);
  expect([o, p, d]).toEqual([3, 2, 3]);
  expect((o ?? 0) + (p ?? 0) + (d ?? 0)).toBe(total);
  expect(await num("stale")).toBe(1);
  await expect(counts.locator("[data-kind=open]")).toHaveAttribute(
    "title",
    /open/,
  );
  await expect(counts.locator("[data-kind=proto]")).toHaveAttribute(
    "title",
    /proto/,
  );
  await expect(counts.locator("[data-kind=decided]")).toHaveAttribute(
    "title",
    /decided/,
  );
  // a card with a smaller subtree: o, o1, o2
  const base = page.url().replace(/\/map.*$/, "");
  await page.goto(`${base}/map/o`);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Title o" }),
  ).toBeVisible();
  await expect(counts.locator("[data-kind=total]")).toHaveText("3");
  expect([await num("open"), await num("proto"), await num("decided")]).toEqual([
    2,
    1,
    null,
  ]);
});

test("17.3 the search box finds a card by id and opens it", async ({
  page,
  app,
}) => {
  const ev: unknown[] = [
    rootDecided,
    decided("base", kid("base")),
    decided("werk-stale", kid("werk-stale")),
    link("werk-stale", "base"),
    reopen("base"),
    open("werk", kid("werk", { title: "The werk card" })),
  ];
  for (let i = 1; i <= 8; i++) ev.push(open(`werk-${i}`, kid(`werk-${i}`)));
  for (let i = 1; i <= 6; i++) ev.push(open(`x${i}werk`, kid(`x${i}werk`)));
  writeEvents(app.dir, ...ev);
  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const rows = page.getByRole("list", { name: "Search results" }).locator("li");
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator("code")).toHaveText("werk");
  const ids = await rows.locator("code").allTextContents();
  const firstContains = ids.findIndex((i) => !i.startsWith("werk"));
  expect(firstContains).toBeGreaterThan(0);
  expect(ids.slice(firstContains).every((i) => !i.startsWith("werk"))).toBe(true);
  for (let i = 0; i < 12; i++) {
    await expect(rows.nth(i).locator("[data-slot=dot]")).toHaveCount(1);
    await expect(rows.nth(i).locator("[data-slot=result-title]")).toHaveCount(1);
  }
  const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  const dot = stale.locator("[data-slot=dot]");
  await expect(dot).toHaveAttribute("data-color", "stale");
  expect(await dot.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    "rgb(239, 68, 68)",
  );
  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumbs" })
      .locator("[data-slot=crumb-current]"),
  ).toHaveText("The werk card");
  await expect(box).toHaveValue("");
});

test("17.4 the Map and Board tabs switch views and the board survives a reload", async ({
  page,
  app,
}) => {
  expect(app.werk("add", "real", "--title", "A real card", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "real", "--actor", "you").code).toBe(0);
  await page.goto(app.url);
  await leftPane(page).locator('a.tile[href$="/map/real"]').click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "A real card" }),
  ).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-page")).toBeVisible();
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.reload();
  await expect(page.locator(".board-page")).toBeVisible();
  await views.getByRole("button", { name: "Map" }).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "A real card" }),
  ).toBeVisible();
});
