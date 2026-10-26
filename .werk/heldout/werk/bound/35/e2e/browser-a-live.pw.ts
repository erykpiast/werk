import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  decided,
  jsonl,
  leftPane,
  markLoaded,
  real,
  serveProject,
  stillLoaded,
} from "./browser-a-support.ts";

const rootLog = jsonl(real("root", "Root", { why: "The root." }));

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
}) => {
  const s = await serveProject({ log: rootLog });
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await markLoaded(page);
    const r = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

test("14.2 a server edit changes a response, reuses the live server, and the live channel holds", async ({
  page,
}) => {
  const s = await serveProject({ appCopy: true, log: rootLog });
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await markLoaded(page);
    const before = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/.exec(s.output());
    expect(before).not.toBeNull();
    const route = `${s.origin}/api/projects/project/nothing-here`;
    expect(await (await fetch(route)).json()).toEqual({ error: "not found" });

    const file = join(s.appDir, "src", "serve", "routes.ts");
    const source = readFileSync(file, "utf8");
    const from = 'return json({ error: "not found" }, 404);\n}\n\nexport function createRoute';
    expect(source).toContain(from);
    writeFileSync(
      file,
      source.replace(from, 'return json({ error: "edited" }, 404);\n}\n\nexport function createRoute'),
    );

    await expect
      .poll(async () => (await (await fetch(route)).json()).error, { timeout: 30000 })
      .toBe("edited");
    expect(s.output()).toContain("reusing the live server");
    const after = [...s.output().matchAll(/serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/g)];
    expect(after).toHaveLength(1);
    expect(s.output()).toContain(`port ${before?.[1]}`);

    expect(s.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  const s = await serveProject({ appCopy: true, log: rootLog });
  try {
    await page.goto(s.url);
    const title = leftPane(page).getByRole("heading", { level: 1, name: "Root" });
    await expect(title).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await markLoaded(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
    await expect(title).toBeVisible();
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await s.dispose();
  }
});

// ---- 17 ----

test("17.1 a deep card: one-line breadcrumbs, hover overlay, click on the parent", async ({
  page,
}) => {
  const s = await serveProject({
    log: jsonl(
      real("root", "Root card"),
      real("a", "Level a", { parent: "root" }),
      real("b", "Level b", { parent: "a" }),
      real("c", "Level c", { parent: "b" }),
      real("d", "Level d", { parent: "c" }),
    ),
  });
  try {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(s.url);
    const pane = leftPane(page);
    expect(await pane.evaluate((el) => el.clientWidth)).toBeLessThan(700);
    for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
      await pane.locator("a.tile", { hasText: t }).click();
      await expect(pane.getByRole("heading", { level: 1, name: t })).toBeVisible();
    }
    const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
    const line = crumbs.locator("[data-slot=crumb-line]");
    await expect(line).toHaveText(/^…\s*›\s*Level c\s*›\s*Level d$/);
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
    expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => getComputedStyle(e).fontWeight)).toMatch(/^(bold|[6-9]00)$/);
    expect((await line.boundingBox())?.height).toBeLessThan(40);

    await line.hover({ force: true });
    const overlay = crumbs.locator("[data-slot=crumb-overlay]");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText(/Root card\s*›\s*Level a\s*›\s*Level b\s*›\s*Level c\s*›\s*Level d/);

    await overlay.getByRole("button", { name: "Level c" }).click();
    await expect(pane.getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
    await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
    await expect(line.getByRole("button", { name: "Level d" })).toHaveCount(0);
  } finally {
    await s.dispose();
  }
});

const countsLog = jsonl(
  decided("root", "Root card"),
  real("co", "Open child", { parent: "root" }),
  real("cp", "Proto child", { parent: "root", status: "proto" }),
  decided("cd", "Decided child", { parent: "root" }),
  decided("cs", "Stale child", { parent: "root" }),
  real("g1", "Grandchild", { parent: "cd" }),
  { type: "node.reopened", id: "root", at: "2026-10-10T09:00:00.000Z" },
);

test("17.2 the header counts follow the open card", async ({ page }) => {
  const s = await serveProject({ log: countsLog });
  try {
    await page.goto(`${s.url}/map/root`);
    const counts = page.locator("[data-slot=counts] [data-slot=count]");
    await expect(counts.first()).toBeVisible();
    const read = async () =>
      Object.fromEntries(
        await counts.evaluateAll((els) =>
          els.map((e) => [e.getAttribute("data-kind"), { n: Number(e.textContent), title: e.getAttribute("title") }]),
        ),
      ) as Record<string, { n: number; title: string }>;
    const c = await read();
    expect(c.total).toBeDefined();
    for (const k of ["open", "proto", "decided"]) expect(c[k]).toBeDefined();
    expect(c.open.n + c.proto.n + c.decided.n).toBe(c.total.n);
    expect(c.open.title.toLowerCase()).toContain("open");
    expect(c.proto.title.toLowerCase()).toContain("proto");
    expect(c.decided.title.toLowerCase()).toContain("decided");
    expect(c.stale?.n).toBeGreaterThan(0);
    // a status with zero cards shows no count
    expect(c.postponed).toBeUndefined();
    const rootTotal = c.total.n;

    await leftPane(page).locator("a.tile", { hasText: "Decided child" }).click();
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "Decided child" })).toBeVisible();
    await expect.poll(async () => (await read()).total?.n).toBeLessThan(rootTotal);
    const d = await read();
    expect(d.total.n).toBe(2);
  } finally {
    await s.dispose();
  }
});

test("17.3 search by #id: at most twelve rows, ranking, dots, arrows, Enter", async ({ page }) => {
  const events: unknown[] = [decided("root", "Root card")];
  events.push(real("base", "Base", { parent: "root" }));
  events.push(decided("werk-stale", "Stale werk card", { parent: "root" }));
  events.push({ type: "edge.added", from: "werk-stale", to: "base", link: "depends_on", why: "needs base" });
  events.push(real("build-werk", "Contains one", { parent: "root" }));
  events.push(real("werk", "The werk card", { parent: "root" }));
  for (let i = 0; i < 6; i++) events.push(real(`werk-x${i}`, `Prefix ${i}`, { parent: "root" }));
  for (let i = 0; i < 6; i++) events.push(real(`my-werk-${i}`, `Inner ${i}`, { parent: "root" }));
  events.push(real("other", "Unrelated", { parent: "root" }));
  events.push(decided("base2", "x", { parent: "root" }));
  // base is decided and then reopened, so its dependent is stale
  const log = jsonl(
    events.slice(0, 1),
    decided("base", "Base", { parent: "root" }),
    events.slice(2),
    { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
  );
  const s = await serveProject({ log });
  try {
    await page.goto(s.url);
    const box = page.getByRole("searchbox", { name: "Search the map" });
    await box.fill("#werk");
    const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(12);
    expect(await rows.count()).toBe(12);
    const ids = await rows.locator("code").allTextContents();
    expect(ids[0]).toBe("werk");
    const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
    const lastPrefix = ids.map((id) => id.startsWith("werk")).lastIndexOf(true);
    expect(firstContains === -1 || lastPrefix < firstContains).toBe(true);
    for (const row of await rows.all()) {
      await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
      await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
      await expect(row.locator("code")).not.toHaveText("");
    }
    const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
    await expect(stale.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");

    await box.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await box.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/map\/werk$/);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumbs" }).locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
    ).toHaveText("The werk card");
    await expect(box).toHaveValue("");
  } finally {
    await s.dispose();
  }
});
