// Fork D: the server's lock, its live channel, its first load and its write trust (13.x, 69.4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { card, cleanup, mark, marked, proj, send, serve } from "./d-util.ts";

test.afterEach(cleanup);

function threeCards() {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root card one" });
  card(p, "alpha", { title: "Alpha card two" });
  card(p, "beta", { title: "Beta card three" });
  return p;
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page }) => {
  test.setTimeout(60_000);
  const p = threeCards();
  const a = serve(p);
  const b = serve(p);
  const results = await Promise.allSettled([a.url, b.url]);
  const ok = results.filter((r) => r.status === "fulfilled");
  expect(ok.length).toBe(1);
  const winner = results[0].status === "fulfilled" ? a : b;
  const loser = winner === a ? b : a;
  const url = (ok[0] as PromiseFulfilledResult<string>).value;
  const code = await loser.exited;
  expect(code).not.toBe(0);
  const port = new URL(url).port;
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err()).toContain(port);
  expect(winner.proc.exitCode).toBeNull();
  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root card one");
  await expect(page.locator('[data-tile="alpha"]')).toContainText("Alpha card two");
  await expect(page.locator('[data-tile="beta"]')).toContainText("Beta card three");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page }) => {
  test.setTimeout(60_000);
  const p = threeCards();
  const a = serve(p);
  const url = await a.url;
  await page.goto(`${url}/map`);
  await expect(page.locator("[data-tile]")).toHaveCount(2);
  const started = Date.now();
  const b = serve(p);
  await expect.poll(() => b.err() + b.out(), { timeout: 2000 }).toMatch(/wait/i);
  expect(b.err() + b.out()).toContain(String(a.proc.pid));
  const code = await b.exited;
  const took = Date.now() - started;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(b.err()).toContain(`pid ${a.proc.pid}`);
  await page.goto(`${url}/map`);
  await expect(page.locator("[data-tile]")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root card one");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page }) => {
  test.setTimeout(60_000);
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root card one" });
  card(p, "alpha", { title: "Alpha card two" });
  const a = serve(p);
  await a.url;
  a.proc.kill("SIGKILL");
  await a.exited;
  expect(readFileSync(join(p.dir, ".werk", "serve.lock"), "utf8")).toContain(String(a.proc.pid));
  const started = Date.now();
  const b = serve(p);
  const url = await b.url;
  expect(Date.now() - started).toBeLessThan(4000);
  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root card one");
  await expect(page.locator('[data-tile="alpha"]')).toContainText("Alpha card two");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root card one" });
  const s = serve(p);
  const url = await s.url;
  await context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { changed: string[] }).changed = seen;
    const Real = window.EventSource;
    window.EventSource = class extends Real {
      constructor(u: string | URL, init?: EventSourceInit) {
        super(u, init);
        this.addEventListener("changed", (e) => seen.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
  });
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(`${url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root card one");
    await mark(tab);
  }
  p.ok("add", "second", "--title", "Second card added", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.locator('[data-tile="second"]')).toContainText("Second card added");
    const changed = await tab.evaluate(() => (window as unknown as { changed: string[] }).changed);
    expect(changed).toEqual([""]);
    expect(await marked(tab)).toBe(true);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root card one" });
  p.ok(
    "add",
    "second",
    "--title",
    "Second card title",
    "--why",
    "Second why text",
    "--body",
    "Second body text only on open",
    "--parent",
    "root",
  );
  const s = serve(p);
  const url = await s.url;
  const bodies: string[] = [];
  page.on("response", (r) => {
    void r.text().then(
      (t) => bodies.push(t),
      () => undefined,
    );
  });
  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root card one");
  const tile = page.locator('[data-tile="second"]');
  await expect(tile).toContainText("Second card title");
  await expect(page.locator("body")).not.toContainText("Second body text only on open");
  expect(bodies.join("")).not.toContain("Second body text only on open");
  await tile.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second card title");
  await expect(page.locator('[data-field="body"]')).toContainText("Second body text only on open");
  await expect(page.locator('[data-field="why"]')).toContainText("Second why text");
  await expect(page.locator('[data-tag="status"]')).toHaveText("open");
  await expect(page.locator("#view")).toContainText("Root card one");
});

test("13.5 only the person's own page can write to the map", async ({ page }) => {
  const p = proj();
  p.seed("node.added", { id: "root", kind: "card", title: "Root card one" });
  const s = serve(p);
  const url = await s.url;
  p.ok("add", "ghost", "--title", "A ghost card", "--parent", "root");
  await page.goto(`${url}/map/ghost`);
  await expect(page.locator('[data-tag="proposed"]')).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(page.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(p.lines().at(-1)).toContain("change.accepted");

  p.ok("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(p.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBe(403);
  expect(readFileSync(p.log, "utf8")).toBe(before);
  const token = (await page.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(p.log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root card one" });
});
