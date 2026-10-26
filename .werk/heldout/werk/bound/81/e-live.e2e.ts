/// <reference lib="dom" />
import { readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test as base } from "@playwright/test";
import { Harness } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";
import { ev } from "./e-util.ts";

const heading = (p: Page, t: string) => p.getByRole("heading", { name: t, level: 1 });
const mark = (p: Page) => p.evaluate(() => { (window as unknown as { kept: boolean }).kept = true; });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

const test = base.extend<{ harness: Harness }>({
  // biome-ignore lint/correctness/noEmptyPattern: fixture
  harness: async ({}, use) => {
    const h = new Harness();
    await use(h);
    await h.close();
  },
});

test.afterEach(stop);

function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token === undefined ? {} : { "x-werk-token": o.token }) } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

const listen = (p: Page) => p.evaluate(() => {
  const w = window as unknown as { sig: { n: number; data: string[] } };
  w.sig = { n: 0, data: [] };
  const es = new EventSource("/api/events");
  es.addEventListener("changed", (e) => { w.sig.n++; w.sig.data.push((e as MessageEvent).data); });
});

test("13.3 two tabs get one changed signal without card data and redraw", async ({ browser }) => {
  const w = await project();
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  for (const p of [a, b]) {
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Root")).toBeVisible();
    await p.waitForLoadState("networkidle");
    await listen(p);
    await mark(p);
  }
  await new Promise((r) => setTimeout(r, 500));
  w.werk("add", "second", "--title", "Second card here", "--parent", "root");
  for (const p of [a, b]) {
    await expect(p.locator("#view")).toContainText("Second card here");
    const sig = await p.evaluate(() => (window as unknown as { sig: { n: number; data: string[] } }).sig);
    expect(sig.n).toBe(1);
    expect(sig.data.join("")).not.toContain("Second card here");
    expect(await marked(p)).toBe(true);
    await expect(p.locator("#view")).toContainText("Root");
  }
  await ctx.close();
});

test("13.4 card added while server down shows on first load; body only when opened", async ({ page: p, harness }) => {
  const w = await harness.start();
  await w.stop();
  const log = join(w.dir, ".werk", "log.jsonl");
  writeFileSync(log, `${ev(1, "root", "Root")}\n`);
  w.werk("add", "second", "--title", "Second one", "--why", "Because why", "--body", "Body words here", "--parent", "root");
  await w.restart();
  const bodies: string[] = [];
  p.on("response", (r) => { if (r.url().includes("/api/")) void r.text().then((t) => bodies.push(t), () => undefined); });
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Root")).toBeVisible();
  const tile = p.locator('a[data-tile="second"]');
  await expect(tile).toContainText("Second one");
  await expect(p.locator("body")).not.toContainText("Body words here");
  expect(bodies.join("")).not.toContain("Body words here");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Body words here");
  await expect(p.locator('[data-field="why"]')).toContainText("Because why");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
});

test("13.5 only the person's page can write", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBe(403);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "retry" });
});

test("14.1 routes: map, child, back, forward, unknown", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.werk("add", "child", "--title", "Child", "--parent", "root"));
  w.werk("accept", "child", "--actor", "you");
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Root")).toBeVisible();
  await expect(p.locator("#view")).toContainText("Root");
  await p.goto(`${w.url}/map/child`);
  await expect(heading(p, "Child")).toBeVisible();
  await p.goBack();
  await expect(heading(p, "Root")).toBeVisible();
  await p.goForward();
  await expect(heading(p, "Child")).toBeVisible();
  await p.goto(`${w.url}/map/nosuchid`);
  await expect(p.locator('[data-missing="nosuchid"]')).toBeVisible();
  await expect(p.locator("#view")).toContainText(/No card .* is in the map/i);
  await expect(heading(p, "Root")).toHaveCount(0);
  await expect(heading(p, "Child")).toHaveCount(0);
});

test("14.1b right pane is kept for the chat", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Root")).toBeVisible();
  await expect(p.getByRole("textbox", { name: "Message" })).toBeVisible();
});

test("14.2 CLI add appears without reload, composer keeps draft", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Root")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const c = p.getByRole("textbox", { name: "Message" });
  await c.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(c).toHaveValue("half a thought");
});

test("14.3 write while server down shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await w.stop();
  writeFileSync(join(w.dir, ".werk", "log.jsonl"), `${ev(1, "root", "Root")}\n`);
  await w.restart();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Root")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);
  await w.stop();
  w.werk("add", "off", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 15000 });
});

test("69.1 map shows refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.werk("add", "c1", "--title", "Child one", "--parent", "root");
    d.werk("add", "c2", "--title", "Child two", "--parent", "root");
    d.werk("add", "g1", "--title", "Grand one", "--parent", "c1");
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Root")).toBeVisible();
  await expect(p.locator('a[data-tile="c1"]')).toContainText("Child one");
  await expect(p.locator('a[data-tile="c2"]')).toContainText("Child two");
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await p.locator('a[data-tile="c1"]').click();
  await expect(heading(p, "Child one")).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toContainText("Grand one");
});

test("69.2 CLI add and accept appears without reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Root")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);
  await expect(p.locator("body")).not.toContainText("Use an append-only log");
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  const tile = p.locator('a[data-tile="log"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(await marked(p)).toBe(true);
});

test("69.3 open card survives reload, no edit controls", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.werk("add", "c1", "--title", "Child one", "--body", "Some body", "--parent", "root"));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(heading(p, "Child one")).toBeVisible();
  const view = p.locator("article");
  await expect(view.locator('[data-field="body"]')).toHaveText("Some body");
  await expect(view.locator("input:not([type=hidden]), textarea, [contenteditable=true]")).toHaveCount(0);
  const btns = await view.getByRole("button").allInnerTexts();
  console.log("buttons in card:", JSON.stringify(btns));
  for (const t of btns) expect(t).not.toMatch(/edit|rename|retitle|save/i);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(heading(p, "Child one")).toBeVisible();
});
