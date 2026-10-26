import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { decided, link, open, reopen } from "../../src/map/mark-fixtures.ts";
import { type BrowserServer, startBrowserServer } from "./support.ts";

const lines = (...events: unknown[]) =>
  `${events
    .flat(Infinity)
    .map((e) => JSON.stringify(e))
    .join("\n")}\n`;
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const still = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });

async function withServer(
  options: Parameters<typeof startBrowserServer>[0],
  body: (s: BrowserServer) => Promise<void>,
  setup?: (s: BrowserServer) => void,
) {
  const s = await startBrowserServer(options);
  try {
    setup?.(s);
    await s.start();
    await body(s);
  } finally {
    await s.dispose();
  }
}

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
}) => {
  await withServer({}, async (s) => {
    await page.goto(s.url);
    await expect(
      left(page).getByRole("heading", { level: 1, name: /We build/ }),
    ).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(page);
    expect(
      s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code,
    ).toBe(0);
    await expect(left(page).getByText("Fresh idea")).toBeVisible();
    expect(await still(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });
});

test("14.2 a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  await withServer({ appCopy: true }, async (s) => {
    await page.goto(s.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const pid = s.pid();
    const port = new URL(s.origin).port;
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const edited = src.replace(
      "return json({ projects: entries(ctx.projects) });",
      "return json({ projects: entries(ctx.projects), edited: true });",
    );
    expect(edited).not.toBe(src);
    writeFileSync(routes, edited);
    await expect
      .poll(() => s.output(), { timeout: 20000 })
      .toContain("reusing the live server");
    expect(s.pid()).toBe(pid);
    await expect
      .poll(
        async () =>
          (await (await fetch(`${s.origin}/api/projects`)).json()).edited,
        { timeout: 20000 },
      )
      .toBe(true);
    expect(new URL(s.origin).port).toBe(port);
    expect(
      s.werk("add", "after", "--title", "After edit", "--parent", "root").code,
    ).toBe(0);
    await expect(left(page).getByText("After edit")).toBeVisible();
    expect(await still(page)).toBe(true);
  });
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  await withServer({ appCopy: true }, async (s) => {
    await page.goto(`${s.url}/map/root`);
    const title = left(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const before = await title.innerText();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await mark(page);
    const entry = join(s.appDir, "client", "main.tsx");
    appendFileSync(entry, "\n// edited\n");
    await expect.poll(() => still(page), { timeout: 20000 }).toBe(false);
    await expect(title).toHaveText(before);
    await expect(composer).toHaveValue("draft that must survive");
  });
});

const chain = (extra: unknown[] = []) =>
  lines(
    ["a", "b", "c", "d"].flatMap((id, i) => [
      { type: "node.proposed", id, kind: "card", title: `Level ${id}`, status: "open", parent: i === 0 ? "root" : ["a", "b", "c"][i - 1] },
      { type: "node.accepted", id, actor: "you" },
    ]),
    extra,
  );

test("17.1 a deep card opens from the map and the breadcrumbs lead back", async ({
  page,
}) => {
  await withServer(
    {},
    async (s) => {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.goto(s.url);
      const pane = left(page);
      expect((await pane.boundingBox())?.width).toBeLessThan(700);
      for (const id of ["a", "b", "c", "d"]) {
        await pane.locator("a.tile", { hasText: `Level ${id}` }).click();
        await expect(pane.getByRole("heading", { level: 1, name: `Level ${id}` })).toBeVisible();
      }
      const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
      const line = crumbs.locator("[data-slot=crumb-line]");
      await expect(line).toHaveText(/^…\s*›\s*Level c\s*›\s*Level d$/);
      await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
      expect(
        await line.locator("[data-slot=crumb-current]").evaluate((e) => getComputedStyle(e).fontWeight),
      ).toMatch(/^(bold|[6-9]00)$/);
      await line.hover({ force: true });
      const overlay = crumbs.locator("[data-slot=crumb-overlay]");
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText("Home");
      await expect(overlay).toContainText("Level a");
      await expect(overlay).toContainText("Level d");
      await overlay.getByRole("button", { name: "Level c" }).click();
      await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
      await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
    },
    (s) => appendFileSync(join(s.dir, ".werk", "log.jsonl"), chain()),
  );
});

const decideRoot = [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];
const header = (page: Page) => left(page);
const countOf = (page: Page, kind: string) =>
  header(page).locator(`[data-slot=count][data-kind=${kind}]`);

test("17.2 the header counts follow the open card", async ({ page }) => {
  const kids = (extra: unknown[]) =>
    lines(
      decideRoot,
      open("c-open", { parent: "root" }),
      open("c-proto", { parent: "root", status: "proto" }),
      decided("c-dec", { parent: "root" }),
      decided("basis", { parent: "root" }),
      decided("c-stale", { parent: "root" }),
      link("c-stale", "basis"),
      reopen("basis"),
      decided("g1", { parent: "c-dec" }),
      extra,
    );
  await withServer(
    {},
    async (s) => {
      await page.goto(`${s.url}/map/root`);
      await expect(countOf(page, "total")).toBeVisible();
      const n = async (k: string) => Number(await countOf(page, k).innerText());
      const total = await n("total");
      expect((await n("open")) + (await n("proto")) + (await n("decided"))).toBe(total);
      await expect(countOf(page, "stale")).toHaveCount(1);
      await expect(countOf(page, "open")).toHaveAttribute("title", /open/);
      await expect(countOf(page, "proto")).toHaveAttribute("title", /proto/);
      await expect(countOf(page, "decided")).toHaveAttribute("title", /decided/);
      await expect(countOf(page, "postponed")).toHaveCount(0);
      await page.goto(`${s.url}/map/c-dec`);
      await expect(countOf(page, "total")).toHaveText("2");
      expect(total).toBeGreaterThan(2);
    },
    (s) => appendFileSync(join(s.dir, ".werk", "log.jsonl"), kids([])),
  );
});

test("17.3 a card is found by id and opened from the search box", async ({
  page,
}) => {
  const ids = [
    "werk",
    ...Array.from({ length: 8 }, (_, i) => `werk-${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `x-werk-${i + 1}`),
  ];
  const events = [
    decideRoot,
    ...ids.filter((i) => i !== "werk-3").flatMap((id) => open(id, { parent: "root" })),
    decided("werk-3", { parent: "root" }),
    decided("basis", { parent: "root" }),
    link("werk-3", "basis"),
    reopen("basis"),
  ];
  await withServer(
    {},
    async (s) => {
      await page.goto(s.url);
      const box = page.getByRole("searchbox", { name: "Search the map" });
      await box.fill("#werk");
      const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeLessThanOrEqual(12);
      expect(await rows.count()).toBe(12);
      await expect(rows.first().locator("code")).toHaveText("werk");
      const idsShown = await rows.locator("code").allInnerTexts();
      const firstContains = idsShown.findIndex((i) => !i.startsWith("werk"));
      const lastStarts = idsShown.map((i) => i.startsWith("werk")).lastIndexOf(true);
      if (firstContains >= 0) expect(lastStarts).toBeLessThan(firstContains);
      await expect(rows.first().locator("[data-slot=dot]")).toBeVisible();
      await expect(rows.first().locator("[data-slot=result-title]")).toBeVisible();
      await expect(
        rows.filter({ has: page.locator("code", { hasText: /^werk-3$/ }) }).locator("[data-slot=dot]"),
      ).toHaveAttribute("data-color", "stale");
      await box.press("ArrowDown");
      await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
      await box.press("ArrowUp");
      await expect(rows.first()).toHaveAttribute("aria-current", "true");
      await box.press("Enter");
      await expect(page).toHaveURL(/\/map\/werk$/);
      await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] [data-slot=crumb-current]")).toHaveText("Title werk");
      await expect(box).toHaveValue("");
    },
    (s) => appendFileSync(join(s.dir, ".werk", "log.jsonl"), lines(events)),
  );
});
