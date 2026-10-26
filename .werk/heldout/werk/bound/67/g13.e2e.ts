// Held-out steps 13.1-13.5: one server per store, live updates, first load, and write trust.

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeProject } from "./srv.ts";

let cleanup: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function project() {
  const p = makeProject();
  cleanup = p.cleanup;
  return p;
}

function send(
  url: string,
  path: string,
  options: { method?: string; host?: string; token?: string; body?: string } = {},
) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? `localhost:${port}`,
          "content-type": "application/json",
          ...(options.token === undefined ? {} : { "x-werk-token": options.token }),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => {
          body += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const w = project();
  w.card("root", { title: "Root card" });
  w.card("one", { title: "First child", parent: "root" });
  w.card("two", { title: "Second child", parent: "root" });
  const a = w.serve();
  const b = w.serve();
  const outcomes = await Promise.allSettled([a.url, b.url]);
  const winners = outcomes.filter((o) => o.status === "fulfilled");
  expect(winners.length).toBe(1);
  const winIndex = outcomes[0].status === "fulfilled" ? 0 : 1;
  const winner = [a, b][winIndex];
  const loser = [a, b][1 - winIndex];
  const url = (winners[0] as PromiseFulfilledResult<string>).value;
  const code = await loser.exited;
  expect(code).not.toBe(0);
  const port = new URL(url).port;
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err()).toContain(port);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator('[data-tile="one"]')).toContainText("First child");
  await expect(p.locator('[data-tile="two"]')).toContainText("Second child");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const w = project();
  w.card("root", { title: "Root card" });
  w.card("one", { title: "Only child", parent: "root" });
  const first = w.serve();
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exited;
  const started = Date.now();
  const second = w.serve();
  const url = await second.url;
  expect(Date.now() - started).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator('[data-tile="one"]')).toContainText("Only child");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ browser }) => {
  const w = project();
  w.card("root", { title: "Root card" });
  const s = w.serve();
  const url = await s.url;
  const tabs = [await browser.newPage(), await browser.newPage()];
  for (const tab of tabs) {
    // Record each changed signal that the page's own live channel receives.
    await tab.addInitScript(() => {
      const w = window as unknown as { changes: string[]; opened: number };
      w.changes = [];
      w.opened = 0;
      const Real = window.EventSource;
      window.EventSource = class extends Real {
        constructor(u: string | URL, init?: EventSourceInit) {
          super(u, init);
          this.addEventListener("open", () => w.opened++);
          this.addEventListener("changed", (e) => w.changes.push(String((e as MessageEvent).data)));
        }
      } as typeof EventSource;
    });
    await tab.goto(`${url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root card");
    await expect.poll(() => tab.evaluate(() => (window as unknown as { opened: number }).opened)).toBeGreaterThan(0);
    await tab.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }
  w.werk("add", "second", "--title", "A second card", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.locator('[data-tile="second"]')).toContainText("A second card");
    expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    const changes = await tab.evaluate(() => (window as unknown as { changes: string[] }).changes);
    expect(changes.length).toBe(1);
    expect(changes[0]).not.toContain("A second card");
    expect(changes[0]).not.toContain("second");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = project();
  w.card("root", { title: "Root card" });
  w.card("neighbour", { title: "A neighbour card", parent: "root" });
  w.werk(
    "add",
    "late",
    "--title",
    "Written while down",
    "--why",
    "The why of the late card",
    "--body",
    "The body of the late card",
    "--parent",
    "root",
  );
  w.werk("link", "late", "neighbour", "--type", "depends_on", "--why", "it needs the neighbour");
  const s = w.serve();
  const url = await s.url;
  const bodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/"))
      void r.text().then(
        (t) => bodies.push(t),
        () => undefined,
      );
  });
  await p.goto(`${url}/map`);
  await expect(p.locator('[data-tile="neighbour"]')).toContainText("A neighbour card");
  await expect(p.locator('[data-tile="late"]')).toContainText("Written while down");
  await expect(p.locator("body")).not.toContainText("The body of the late card");
  expect(bodies.join("")).not.toContain("The body of the late card");
  await p.locator('[data-tile="late"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Written while down");
  await expect(p.locator('[data-field="body"]')).toContainText("The body of the late card");
  await expect(p.locator('[data-field="why"]')).toContainText("The why of the late card");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root card");
  await expect(p.locator("#view")).toContainText("A neighbour card");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = project();
  w.card("root", { title: "Root card" });
  w.werk("add", "ghost", "--title", "A ghost card", "--parent", "root");
  const s = w.serve();
  const url = await s.url;
  await p.goto(`${url}/map/ghost`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(read.body).toContain("Root card");
});
