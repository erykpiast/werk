import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const card = (w: Pick<Werk, "seed">, id: string, parent: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", why: `why ${id}`, ...f });
const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`#header [data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });
const rgb = (p: Page, color: string) =>
  p.evaluate((c) => {
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }, color);

test("[14.1] move between cards by address; unknown card says not found", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", "root", { title: "Child" }));
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-such-card`);
  const view = p.locator("#view");
  await expect(view).toContainText("no-such-card");
  const text = (await view.textContent()) ?? "";
  console.log("NOT FOUND PAGE TEXT:", text.slice(0, 200));
  expect(text).toMatch(/not found|not in the map|no card/i);
  await expect(heading(p).filter({ hasText: /^(Root|Child)$/ })).toHaveCount(0);
});

test("[14.2] a card added on the command line appears on the open page", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await p.evaluate(() => ((window as any).kept = true));
  w.werk("add", "fresh", "--title", "Fresh idea", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await p.evaluate(() => (window as any).kept === true)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("[17.1] a deep card and the breadcrumbs", async ({ page: p }) => {
  await p.setViewportSize({ width: 1000, height: 800 });
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a");
    card(d, "c", "b");
    card(d, "d", "c");
  });
  await p.goto(`${w.url}/`);
  const pane = await p.locator("#view").boundingBox();
  console.log("LEFT PANE WIDTH", pane?.width);
  expect(pane?.width ?? 0).toBeLessThan(700);
  for (const id of ["a", "b", "c", "d"]) {
    if (id === "a") await p.locator(`a[data-tile="a"]`).first().click();
    else await p.locator(`a[data-tile="${id}"]`).click();
  }
  await expect(heading(p)).toHaveText("Card d");
  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  const cur = line.locator('[aria-current="page"]');
  await expect(cur).toHaveText("Card d");
  expect(Number(await cur.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const txt = ((await line.textContent()) ?? "").replace(/\s+/g, " ");
  console.log("CRUMBS:", txt);
  expect(txt).toMatch(/…\s*›\s*Card c\s*›\s*Card d/);
  const box = await line.boundingBox();
  const cb = await cur.boundingBox();
  expect(box?.height ?? 0).toBeLessThan((cb?.height ?? 0) * 1.5);
  const full = p.locator('[data-role="crumbs-full"]');
  await line.hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual(["Home", "Root", "Card a", "Card b", "Card c", "Card d"]);
  await line.getByRole("button", { name: "Card c" }).click();
  await expect(heading(p)).toHaveText("Card c");
  const cur2 = crumbs(p).locator('[aria-current="page"]');
  await expect(cur2).toHaveText("Card c");
  expect(Number(await cur2.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
});

test("[17.2] the header counts follow the open card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "a", "root");
    card(d, "b", "a", { status: "open" });
    card(d, "c", "a", { status: "proto" });
    card(d, "e", "root");
    card(d, "s", "root");
    card(d, "z", "root");
    card(d, "z1", "z", { status: "open" });
    d.seed("edge.added", { from: "s", to: "e", type: "depends_on", why: "needs e" });
    d.seed("node.reopened", { id: "e", reason: "rejected", why: "wrong" });
  });
  await p.goto(`${w.url}/map/root`);
  await expect(count(p, "total")).toHaveText("8");
  const sum = async () => {
    let t = 0;
    for (const n of ["open", "proto", "decided"]) {
      const at = count(p, n);
      if ((await at.count()) > 0) t += Number(await at.textContent());
    }
    return t;
  };
  expect(await sum()).toBe(8);
  await expect(count(p, "open")).toHaveAttribute("title", /open/);
  await expect(count(p, "proto")).toHaveAttribute("title", /proto/);
  await expect(count(p, "decided")).toHaveAttribute("title", /decided/);
  await expect(count(p, "stale")).toHaveCount(1);
  await p.goto(`${w.url}/map/z`);
  await expect(count(p, "total")).toHaveText("2");
  await expect(count(p, "open")).toHaveText("1");
  await expect(count(p, "decided")).toHaveText("1");
  await expect(count(p, "proto")).toHaveCount(0);
  await p.goto(`${w.url}/map/root`);
  await p.locator('a[data-tile="a"]').click();
  await expect(count(p, "total")).toHaveText("3");
  expect(await sum()).toBe(3);
  await expect(count(p, "stale")).toHaveCount(0);
});

test("[17.3] search by id and open with Enter", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "werk", "root", { title: "werk v0" });
    for (let i = 1; i <= 7; i++) card(d, `werk-s${i}`, "root", { title: `Starts ${i}` });
    for (let i = 1; i <= 7; i++) card(d, `vi-werk-${i}`, "root", { title: `Contains ${i}` });
    d.seed("edge.added", { from: "werk-s3", to: "werk", type: "depends_on", why: "needs werk" });
    d.seed("node.reopened", { id: "werk", reason: "rejected", why: "x" });
  });
  await p.goto(`${w.url}/map/root`);
  await search(p).fill("#werk");
  const rows = p.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id")));
  console.log("ROWS", ids);
  expect(ids.length).toBeLessThanOrEqual(12);
  expect(ids.length).toBeGreaterThan(8);
  expect(ids[0]).toBe("werk");
  const startsEnd = ids.map((i) => (i ?? "").startsWith("werk")).lastIndexOf(true);
  const containsStart = ids.map((i) => !(i ?? "").startsWith("werk")).indexOf(true);
  expect(startsEnd).toBeLessThan(containsStart);
  const r0 = rows.first();
  await expect(r0.locator('[data-role="dot"]')).toHaveCount(1);
  await expect(r0).toContainText("werk v0");
  await expect(r0.locator("code")).toHaveText("werk");
  await search(p).fill("#werk-s3");
  const stale = p.locator('[role="option"][data-id="werk-s3"] [data-role="dot"]');
  const c = await rgb(p, await stale.evaluate((el) => getComputedStyle(el).backgroundColor));
  expect(c.r).toBeGreaterThan(c.g + 80);
  await search(p).fill("#werk");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(heading(p)).toHaveText("werk v0");
  const cur = crumbs(p).locator('[aria-current="page"]');
  await expect(cur).toHaveText("werk v0");
  expect(Number(await cur.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("[17.4] Map and Board tabs", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "invoice", "root", { title: "The invoice" }));
  await p.goto(`${w.url}/map/invoice`);
  const tab = (n: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name: n });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p).toHaveURL(/\/board$/);
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/invoice$/);
  await expect(heading(p)).toHaveText("The invoice");
});

test("[17.5] the first screen: requirements and build rules side by side", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.bodyEdited", { id: "root", why: "Root why words" });
    card(d, "pay", "root", { title: "Customers pay online" });
    d.seed("node.added", { id: "how", kind: "card", title: "Build rules", status: "decided", who: "me", why: "How we build" });
    card(d, "tests", "how", { title: "Tests run on Bun" });
  });
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("Root");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  await expect(what).toContainText("Root why words");
  await expect(how).toContainText("How we build");
  await expect(what.locator('[data-role="rollup"]')).toContainText("cards");
  await expect(how.locator('[data-role="rollup"]')).toContainText("2 cards");
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
});

test("[17.5b] without #how the right column is an empty build-rules card", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "pay", "root", { title: "Customers pay online" }));
  await p.goto(`${w.url}/`);
  const how = p.locator('[data-column="how"]');
  await expect(how).toBeVisible();
  console.log("HOW COLUMN:", ((await how.textContent()) ?? "").slice(0, 200));
  await expect(how.getByRole("heading")).toHaveCount(1);
  await expect(how.locator("[data-tile]")).toHaveCount(0);
});

test("[69.1] the map shows the fixture as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "c1", "root", { title: "Child one" });
    card(d, "c2", "root", { title: "Child two" });
    card(d, "g1", "c1", { title: "Grandchild" });
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="c1"]')).toBeVisible();
  await expect(p.locator('a[data-tile="c2"]')).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await p.locator('a[data-tile="c1"]').click();
  await expect(heading(p)).toHaveText("Child one");
  await expect(p.locator('a[data-tile="g1"]')).toBeVisible();
});

test("[69.2] a card added and accepted on the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await p.evaluate(() => ((window as any).kept = true));
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  const tile = p.locator('a[data-tile="log"]');
  await expect(tile).toContainText("Use an append-only log");
  await expect(tile).toHaveAttribute("data-proposed", "false");
  expect(await p.evaluate(() => (window as any).kept === true)).toBe(true);
});

test("[69.3] the open card survives a reload and has no text-edit control", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "c1", "root", { title: "Child one" }));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(heading(p)).toHaveText("Child one");
  const view = p.locator("#view");
  await expect(view.getByRole("textbox").filter({ hasNot: p.getByRole("textbox", { name: "Note" }) })).toHaveCount(1);
  await expect(view.locator('input[type="text"], input:not([type])')).toHaveCount(0);
  await expect(view.locator("[contenteditable]")).toHaveCount(0);
  await expect(view.getByRole("button", { name: /edit|rename|retitle/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(heading(p)).toHaveText("Child one");
});
