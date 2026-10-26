/// <reference lib="dom" />
// Held-out: 13.3, 13.4, 13.5, 14.1, 14.2, 14.3, 69.1, 69.2, 69.3 — the map page against a real server.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: o.method ?? "GET",
        headers: {
          host: o.host ?? `localhost:${port}`,
          "content-type": "application/json",
          ...(o.token === undefined ? {} : { "x-werk-token": o.token }),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await project();
  // Observe every changed signal each tab's live channel receives, with its data.
  await context.addInitScript(() => {
    const W = window as unknown as { changed: string[]; EventSource: typeof EventSource };
    W.changed = [];
    const Real = W.EventSource;
    W.EventSource = class extends Real {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => W.changed.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
  });
  const t1 = await context.newPage();
  const t2 = await context.newPage();
  for (const t of [t1, t2]) {
    await t.goto(`${w.url}/map`);
    await expect(h1(t)).toHaveText("Root");
    await t.waitForLoadState("networkidle");
    await mark(t);
  }
  w.werk("add", "second", "--title", "Second card here", "--parent", "root");
  for (const t of [t1, t2]) {
    await expect(t.locator("#view")).toContainText("Second card here");
    expect(await marked(t)).toBe(true);
  }
  await t1.waitForTimeout(1000);
  for (const t of [t1, t2]) {
    const changed = await t.evaluate(() => (window as unknown as { changed: string[] }).changed);
    expect(changed).toEqual([""]);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "second",
      "--title",
      "Second card title",
      "--why",
      "Second card why text",
      "--body",
      "Second card body text",
      "--parent",
      "root",
    );
  });
  const bodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/")) void r.text().then((t) => bodies.push(t), () => undefined);
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card title");
  await expect(p.locator("body")).not.toContainText("Second card body text");
  expect(bodies.join("")).not.toContain("Second card body text");
  await p.locator('a[data-tile="second"]').click();
  await expect(h1(p)).toHaveText("Second card title");
  await expect(p.locator('[data-field="body"]')).toContainText("Second card body text");
  await expect(p.locator('[data-field="why"]')).toContainText("Second card why text");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(readFileSync(log, "utf8")).toMatch(/"actor":"you","type":"[a-z.]*accepted","payload":\{"id":"retry"/);

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const body = JSON.stringify({ id: "later" });
  const noToken = await send(w.url, "/api/accept", { method: "POST", body });
  expect(noToken.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const badHost = await send(w.url, "/api/accept", { method: "POST", body, token, host: "evil.example" });
  expect(badHost.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(read.body).toContain("Retry sends a new link");
});

test("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
  const w = await project(undefined, (down) => down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }));
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator("#chat-pane")).toBeVisible();
  await expect(p.locator("#chat-pane")).not.toContainText("Root");
  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-card-has-this`);
  await expect(p.locator("#view")).toContainText(/not found|no card|does not hold/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  w.werk("add", "base", "--title", "Base", "--parent", "root");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 15_000 });
});

test("69.1 the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "c1", kind: "card", title: "Child one", parent: "root" });
    d.seed("node.added", { id: "c2", kind: "card", title: "Child two", parent: "root" });
    d.seed("node.added", { id: "g1", kind: "card", title: "Grandchild one", parent: "c1" });
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="c1"]')).toContainText("Child one");
  await expect(p.locator('a[data-tile="c2"]')).toContainText("Child two");
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await p.locator('a[data-tile="c1"]').click();
  await expect(h1(p)).toHaveText("Child one");
  await expect(p.locator('a[data-tile="g1"]')).toContainText("Grandchild one");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await p.waitForLoadState("networkidle");
  await mark(p);
  w.werk("add", "applog", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "applog", "--actor", "you");
  await expect(p.locator('a[data-tile="applog"]')).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(p.locator('a[data-tile="applog"] [data-tag="proposed"]')).toHaveCount(0);
  expect(await marked(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "c1", kind: "card", title: "Child one", body: "Child body", parent: "root" });
  });
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p)).toHaveText("Child one");
  await expect(p.locator('[data-field="body"]')).toContainText("Child body");
  const view = p.locator("#view");
  // The only text box in the card view is the note box of the thread, which writes a note, not the card's words.
  const boxes = view.locator("input, textarea, [contenteditable=true], [contenteditable='']");
  const names = await boxes.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.closest("form")?.getAttribute("aria-label") ?? e.outerHTML));
  console.log("text boxes in the card view:", names);
  await expect(view.locator("input, textarea, [contenteditable=true], [contenteditable='']").and(p.getByRole("textbox", { name: "Note" }).or(p.getByRole("textbox", { name: "Note" })))).toHaveCount(await boxes.count());
  await expect(view.getByRole("button", { name: /edit|retitle|rename|title|body/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p)).toHaveText("Child one");
});
