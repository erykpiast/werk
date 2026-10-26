/// <reference lib="dom" />
// Held-out steps 13.3, 13.4, 13.5, 14.1, 14.2, 69.1, 69.2, 69.3 on a fresh project with a #root "Root".
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const h1 = (p: Page) => p.locator("#view").getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function card(w: Pick<Werk, "seed">, id: string, title: string, parent = "root", extra: object = {}) {
  w.seed("node.added", { id, kind: "card", title, parent, ...extra });
}

/** Records every changed signal the page's live channel receives (instrumentation only). */
async function recordSignals(p: Page) {
  await p.addInitScript(() => {
    const Orig = window.EventSource;
    const seen: string[] = [];
    (window as unknown as { signals: string[] }).signals = seen;
    window.EventSource = class extends Orig {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => seen.push(String((e as MessageEvent).data)));
      }
    } as typeof EventSource;
  });
}
const signals = (p: Page) => p.evaluate(() => (window as unknown as { signals: string[] }).signals);

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await project();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordSignals(t);
    await t.goto(`${w.url}/map/root`);
    await expect(h1(t)).toHaveText("Root");
    await t.waitForLoadState("networkidle");
    await mark(t);
  }
  w.werk(
    "add",
    "second",
    "--title",
    "The second card",
    "--why",
    "A reason",
    "--body",
    "Secret body words",
    "--parent",
    "root",
  );
  for (const t of tabs) {
    await expect(t.locator("#view")).toContainText("The second card");
    await expect(t.locator("#view")).toContainText("Root");
    expect(await marked(t)).toBe(true);
    const got = await signals(t);
    expect(got).toHaveLength(1);
    expect(got[0]).not.toContain("second");
    expect(got[0]).not.toContain("Secret body");
    await t.screenshot({ path: test.info().outputPath(`tab-${tabs.indexOf(t)}.png`) });
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "second",
      "--title",
      "The offline card",
      "--why",
      "Offline why text",
      "--body",
      "Offline body text",
      "--parent",
      "root",
    );
  });
  const apiBodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/") && !r.url().includes("/api/events"))
      void r.text().then(
        (t) => apiBodies.push(t),
        () => undefined,
      );
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator("#view")).toContainText("The offline card");
  await expect(p.locator("body")).not.toContainText("Offline body text");
  const pageHtml = await p.content();
  expect(pageHtml).not.toContain("Offline body text");
  expect(apiBodies.join("")).not.toContain("Offline body text");
  await p.locator('a[data-tile="second"]').click();
  await expect(h1(p)).toHaveText("The offline card");
  await expect(p.locator('[data-field="body"]')).toContainText("Offline body text");
  await expect(p.locator('[data-field="why"]')).toContainText("Offline why text");
  await expect(p.locator('[data-tag="status"]')).toBeVisible();
  await expect(p.locator("#view")).toContainText("Root");
});

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

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk("add", "change", "--title", "A proposed change", "--parent", "root");
  });
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/change`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(readFileSync(log, "utf8")).toContain("accept");

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(read.body).toContain("Root");
});

test("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "child", "Child"));
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  const chat = p.locator("#chat-pane");
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("heading", { name: "Root" })).toHaveCount(0);
  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-card-has-this`);
  await expect(p.locator("#view")).toContainText(/not found|no card|does not hold|no node/i);
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

test("69.1 the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "kid-a", "First child");
    card(down, "kid-b", "Second child");
    card(down, "grand", "The grandchild", "kid-a");
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="kid-a"]')).toContainText("First child");
  await expect(p.locator('a[data-tile="kid-b"]')).toContainText("Second child");
  await expect(p.locator('a[data-tile="grand"]')).toHaveCount(0);
  await p.locator('a[data-tile="kid-a"]').click();
  await expect(h1(p)).toHaveText("First child");
  await expect(p.locator('a[data-tile="grand"]')).toContainText("The grandchild");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "applog", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "applog", "--actor", "you");
  const tile = p.locator('a[data-tile="applog"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile).toHaveAttribute("data-proposed", "false", { timeout: 5000 });
  expect(await marked(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "kid", "A child card", "root", { body: "Child body" }));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="kid"]').click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
  await expect(p.locator('[data-field="body"]')).toContainText("Child body");
  const view = p.locator("#view");
  // The note box writes a note on the thread; it does not change the title or the body.
  await expect(
    view.locator('input:not([type="hidden"]), textarea:not([aria-label="Note"]), [contenteditable="true"]'),
  ).toHaveCount(0);
  const names = await view.getByRole("button").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  expect(names.filter((n) => /edit|rename|retitle|save/i.test(n))).toEqual([]);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
});
