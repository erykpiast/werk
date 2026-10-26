// Held-out steps 69.1-69.4 and 17.1-17.5: the map, the header and the home view.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { appFile, FAKE_BIN, test, type Werk } from "../../e2e/harness";
import { cleanEnv } from "../../src/test/clean-env.ts";

void appFile;

type Ev = { type: string; payload: Record<string, unknown> };
const card = (id: string, title: string, parent?: string, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...(parent ? { parent } : {}), ...extra },
});

async function seed(w: Werk, events: Ev[]): Promise<void> {
  const lines = events.map((e, i) =>
    JSON.stringify({ seq: i + 1, at: `2026-10-01T00:00:${String(i).padStart(2, "0")}.000Z`, actor: "you", ...e }),
  );
  writeFileSync(join(w.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  await w.restart();
}

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const crumbs = (p: Page) => p.locator('[data-role="crumbs"]');
const count = (p: Page, name: string) => p.locator(`[data-count="${name}"]`);
const search = (p: Page) => p.getByRole("searchbox", { name: "Search the map" });

test("69.1 the map shows a refines tree", async ({ page: p, harness }) => {
  const w = await harness.start();
  await seed(w, [
    card("root", "The root"),
    card("ca", "Child A", "root"),
    card("cb", "Child B", "root"),
    card("ga", "Grandchild of A", "ca"),
  ]);
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("The root");
  const sub = p.locator('[data-section="subcards"]');
  await expect(sub.locator('a[data-tile="ca"]')).toBeVisible();
  await expect(sub.locator('a[data-tile="cb"]')).toBeVisible();
  await expect(sub.locator('a[data-tile="ga"]')).toHaveCount(0);
  await sub.locator('a[data-tile="ca"]').click();
  await expect(h1(p)).toHaveText("Child A");
  await expect(p.locator('[data-section="subcards"] a[data-tile="ga"]')).toBeVisible();
});

test("69.2 a card added and accepted from the CLI appears with no reload", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toBeVisible();
  let navigations = 0;
  p.on("framenavigated", (f) => {
    if (f === p.mainFrame()) navigations++;
  });
  await expect(p.locator("body")).not.toContainText("Use an append-only log");
  w.werk("add", "append-log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "append-log", "--actor", "you");
  await expect(p.locator('[data-section="subcards"] a[data-tile="append-log"]')).toContainText(
    "Use an append-only log",
    { timeout: 5000 },
  );
  expect(navigations).toBe(0);
});

test("69.3 the open card survives a reload and has no edit control", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="retry"]').click();
  await expect(p).toHaveURL(/\/map\/retry$/);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(p.locator('[data-field="body"]')).toContainText("A second failure goes back to");
  const article = p.locator('article[data-card="retry"]');
  await expect(article.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  await expect(p.getByRole("button", { name: /edit|rename|title|body/i })).toHaveCount(0);
  await expect(p.locator('[contenteditable="true"]')).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/retry$/);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
});

test("69.4 a second server waits, then refuses", async ({ page: p, harness }) => {
  test.setTimeout(30000);
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  const before = await p.locator("a[data-tile]").allTextContents();
  const pid = w.pid();
  const env = cleanEnv(process.env, FAKE_BIN);
  const started = Date.now();
  const second = spawn("bun", [join(w.app, "src", "cli.ts"), "serve", "--port", "0"], {
    cwd: w.dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let firstOutputAt = 0;
  const onData = (c: Buffer) => {
    if (firstOutputAt === 0) firstOutputAt = Date.now() - started;
    out += c.toString();
  };
  second.stdout?.on("data", onData);
  second.stderr?.on("data", onData);
  const code = await new Promise<number | null>((resolve) => second.once("exit", (c) => resolve(c)));
  const took = Date.now() - started;
  console.log(`69.4 output after ${firstOutputAt}ms, exit ${code} after ${took}ms:\n${out}`);
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(out).toContain(String(pid));
  const waitLine = out.split("\n").find((l) => /wait/i.test(l) && l.includes(String(pid)));
  expect.soft(waitLine, "a line that says it waits for the first server's pid").toBeDefined();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  expect(await p.locator("a[data-tile]").allTextContents()).toEqual(before);
});

test("17.1 a deep card and its breadcrumbs", async ({ page: p, harness }) => {
  await p.setViewportSize({ width: 900, height: 800 });
  const w = await harness.start();
  await seed(w, [
    card("root", "Root"),
    card("a", "Card a", "root"),
    card("b", "Card b", "a"),
    card("c", "Card c", "b"),
    card("d", "Card d", "c"),
  ]);
  await p.goto(`${w.url}/`);
  const pane = await p.locator("header").first().boundingBox();
  console.log(`17.1 left pane header width ${pane?.width}`);
  expect(pane?.width ?? 9999).toBeLessThan(700);
  await p.locator('a[data-tile="a"]').click();
  await expect(h1(p)).toHaveText("Card a");
  for (const id of ["b", "c", "d"]) {
    await p.locator(`a[data-tile="${id}"]`).click();
    await expect(h1(p)).toHaveText(`Card ${id}`);
  }
  const line = crumbs(p);
  await expect(line.locator('[data-role="cut"]')).toHaveText("…");
  const text = (await line.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("… › Card c › Card d");
  const current = line.locator('[aria-current="page"]');
  await expect(current).toHaveText("Card d");
  expect(Number(await current.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const box = await line.boundingBox();
  const seg = await current.boundingBox();
  expect(box?.height ?? 0).toBeLessThan((seg?.height ?? 0) * 1.5);

  const full = p.locator('[data-role="crumbs-full"]');
  await line.hover();
  await expect(full).toBeVisible();
  expect(await full.locator("[data-crumb]").allTextContents()).toEqual([
    "Home",
    "Root",
    "Card a",
    "Card b",
    "Card c",
    "Card d",
  ]);
  await line.getByRole("button", { name: "Card c" }).click();
  await expect(p).toHaveURL(/\/map\/c$/);
  await expect(h1(p)).toHaveText("Card c");
  await expect(crumbs(p).locator('[aria-current="page"]')).toHaveText("Card c");
  const last = (await crumbs(p).innerText()).replace(/\s+/g, " ").trim();
  expect(last.endsWith("Card c")).toBe(true);
});

test("17.2 the header counts follow the open card", async ({ page: p, harness }) => {
  const w = await harness.start();
  await seed(w, [
    card("root", "Root"),
    card("base", "Base", "root", { status: "decided", who: "me" }),
    card("o", "Open child", "root", { status: "open" }),
    card("o1", "Open grandchild", "o", { status: "open" }),
    card("o2", "Decided grandchild", "o", { status: "decided", who: "me" }),
    card("pr", "Proto child", "root", { status: "proto" }),
    card("de", "Decided child", "root", { status: "decided", who: "me" }),
    { type: "edge.added", payload: { from: "de", to: "base", type: "depends_on", why: "It needs base" } },
    { type: "node.reopened", payload: { id: "base", reason: "invalidated", why: "The scope changed" } },
  ]);
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const header = p.locator("#header");
  await expect(header.locator('[data-count="total"]')).toBeVisible();
  const read = async () => {
    const out: Record<string, number> = {};
    for (const name of ["total", "open", "proto", "decided", "unchallenged", "stale", "paused"]) {
      const at = header.locator(`[data-count="${name}"]`);
      if ((await at.count()) > 0) out[name] = Number(await at.locator('[data-role="value"]').textContent());
    }
    return out;
  };
  const top = await read();
  console.log(`17.2 root counts ${JSON.stringify(top)}`);
  expect(top.total).toBe(7);
  expect((top.open ?? 0) + (top.proto ?? 0) + (top.decided ?? 0)).toBe(top.total);
  for (const name of ["open", "proto", "decided"]) expect(top[name], `dot for ${name}`).toBeGreaterThan(0);
  expect(top.stale).toBeGreaterThan(0);
  for (const value of Object.values(top)) expect(value).toBeGreaterThan(0);
  for (const name of ["open", "proto", "decided", "stale"]) {
    await header.locator(`[data-count="${name}"]`).hover();
    await expect(header.locator(`[data-count="${name}"]`)).toHaveAttribute("title", new RegExp(name));
  }
  await p.locator('a[data-tile="o"]').click();
  await expect(h1(p)).toHaveText("Open child");
  await expect(header.locator('[data-count="total"] [data-role="value"]')).toHaveText("3");
  const sub = await read();
  console.log(`17.2 child counts ${JSON.stringify(sub)}`);
  expect(sub.open).toBe(2);
  expect(sub.decided).toBe(1);
  expect(sub.proto).toBeUndefined();
  expect(sub.stale).toBeUndefined();
});

test("17.3 find a card by id in the search box", async ({ page: p, harness }) => {
  const w = await harness.start();
  const events: Ev[] = [card("root", "Root"), card("werk", "werk v0", "root", { status: "decided", who: "me" })];
  for (const s of ["a", "b", "c", "d", "e", "f", "g", "h"]) events.push(card(`werk-${s}`, `Starts ${s}`, "werk"));
  for (const s of ["x", "y", "z", "q"]) events.push(card(`vi-werk-${s}`, `Contains ${s}`, "root"));
  events.push({ type: "node.reopened", payload: { id: "werk", reason: "invalidated", why: "The scope changed" } });
  await seed(w, events);
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await search(p).fill("#werk");
  const rows = p.getByRole("option");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(12);
  const ids = (await rows.evaluateAll((all) => all.map((r) => r.getAttribute("data-id")))) as string[];
  console.log(`17.3 rows ${JSON.stringify(ids)}`);
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  if (firstContains >= 0) expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await expect(row.locator('[data-role="dot"]')).toHaveCount(1);
    await expect(row).toContainText(ids[i] as string);
  }
  await expect(rows.first()).toContainText("werk v0");
  const stale = p.locator('[role="option"][data-id="werk-a"] [data-role="dot"]');
  expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(220, 38, 38)");
  await search(p).press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await search(p).press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search(p).press("Enter");
  await expect(p).toHaveURL(/\/map\/werk$/);
  await expect(h1(p)).toHaveText("werk v0");
  const cur = crumbs(p).locator('[aria-current="page"]');
  await expect(cur).toHaveText("werk v0");
  expect(Number(await cur.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(search(p)).toHaveValue("");
});

test("17.4 switch between Map and Board tabs", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  const tab = (name: string) => p.getByRole("navigation", { name: "Views" }).getByRole("link", { name });
  await expect(tab("Map")).toHaveAttribute("aria-current", "page");
  await tab("Board").click();
  await expect(p).toHaveURL(/\/board$/);
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await expect(tab("Board")).toHaveAttribute("aria-current", "page");
  await p.reload();
  await expect(p.locator('[data-view="board"]')).toBeVisible();
  await tab("Map").click();
  await expect(p).toHaveURL(/\/map\/retry$/);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
});

test("17.5 the home shows requirements and build rules side by side", async ({ page: p, harness }) => {
  const w = await harness.start();
  await seed(w, [
    card("root", "The product", undefined, { why: "Root why text" }),
    card("pay", "Customers pay online", "root"),
    card("how", "Build rules", undefined, { why: "How why text", status: "decided", who: "me" }),
    card("tests", "Tests run on Bun", "how"),
  ]);
  await p.goto(`${w.url}/`);
  const what = p.locator('[data-column="what"]');
  const how = p.locator('[data-column="how"]');
  await expect(what.getByRole("heading", { level: 2 })).toHaveText("The product");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Build rules");
  const l = await what.boundingBox();
  const r = await how.boundingBox();
  expect(l?.y).toBe(r?.y);
  expect(Math.abs((l?.width ?? 0) - (r?.width ?? 1))).toBeLessThan(2);
  expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(r?.x ?? 0);
  await expect(what.locator('[data-field="why"]')).toContainText("Root why text");
  await expect(how.locator('[data-field="why"]')).toContainText("How why text");
  await expect(what.locator('[data-role="rollup"]')).toBeVisible();
  await expect(how.locator('[data-role="rollup"]')).toBeVisible();
  await expect(what.locator('a[data-tile="pay"]')).toBeVisible();
  await expect(how.locator('a[data-tile="tests"]')).toBeVisible();

  await seed(w, [card("root", "The product"), card("pay", "Customers pay online", "root")]);
  await p.goto(`${w.url}/`);
  await expect(how.locator('[data-empty="true"]')).toBeVisible();
  await expect(how.locator('[data-empty="true"]')).toContainText("No build rules yet");
});
