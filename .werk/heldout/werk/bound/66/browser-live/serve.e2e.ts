// Held-out: steps 13.1–13.5.

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { closeAll, live, prepare, startServe } from "./live.ts";

test.afterEach(closeAll);

const procs: { kill(signal?: NodeJS.Signals): boolean }[] = [];
test.afterEach(() => {
  for (const p of procs.splice(0)) p.kill("SIGKILL");
});

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
  const d = prepare("Shop");
  d.seed("node.added", { id: "cart", kind: "card", title: "Cart keeps items", parent: "root" });
  d.seed("node.added", { id: "pay", kind: "card", title: "Pay by card", parent: "root" });
  const a = startServe(d.dir, d.env);
  const b = startServe(d.dir, d.env);
  procs.push(a.proc, b.proc);
  const result = await Promise.race([
    a.url.then((url) => ({ url, winner: a, loser: b })),
    b.url.then((url) => ({ url, winner: b, loser: a })),
  ]);
  const code = await result.loser.exit;
  expect(code).not.toBe(0);
  const port = new URL(result.url).port;
  expect(result.loser.err()).toContain(`pid ${result.winner.proc.pid}`);
  expect(result.loser.err()).toContain(`port ${port}`);
  expect(result.winner.proc.exitCode).toBeNull();

  await p.goto(`${result.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Shop");
  await expect(p.locator("#view")).toContainText("Cart keeps items");
  await expect(p.locator("#view")).toContainText("Pay by card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const d = prepare("Shop");
  d.seed("node.added", { id: "cart", kind: "card", title: "Cart keeps items", parent: "root" });
  const first = startServe(d.dir, d.env);
  procs.push(first.proc);
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exit;
  expect(readFileSync(join(d.dir, ".werk", "serve.lock"), "utf8")).toContain(String(first.proc.pid));
  const started = Date.now();
  const second = startServe(d.dir, d.env);
  procs.push(second.proc);
  const url = await second.url;
  // The lock wait is 5000 ms; a start that waited for the old server would take at least that long.
  expect(Date.now() - started).toBeLessThan(5000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Shop");
  await expect(p.locator("#view")).toContainText("Cart keeps items");
});

const recordChanged = (p: Page) =>
  p.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __changed: string[] }).__changed = seen;
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => seen.push(String((e as MessageEvent).data ?? "")));
      }
    } as typeof EventSource;
  });
const changed = (p: Page) => p.evaluate(() => (window as unknown as { __changed: string[] }).__changed);

test("13.3 a page stays in step when a card is added on the command line", async ({ browser }) => {
  const w = await live("Shop");
  const ctx = await browser.newContext();
  const tabs = [await ctx.newPage(), await ctx.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${w.url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Shop");
    await t.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }
  w.werk("add", "pay", "--title", "Pay by card", "--body", "Visa and Mastercard only", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator("#view")).toContainText("Pay by card");
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Shop");
    expect(await t.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    const signals = await changed(t);
    expect(signals).toHaveLength(1);
    expect(signals[0]).not.toContain("Pay by card");
    expect(signals[0]).not.toContain("pay");
    expect(signals[0]).not.toContain("Visa");
  }
  await ctx.close();
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const d = prepare("Shop");
  d.werk(
    "add",
    "pay",
    "--title",
    "Pay by card",
    "--why",
    "Most buyers have one",
    "--body",
    "Visa and Mastercard only",
    "--parent",
    "root",
  );
  const s = startServe(d.dir, d.env);
  procs.push(s.proc);
  const url = await s.url;
  const bodies: string[] = [];
  p.on("response", (r) => {
    void r.text().then(
      (t) => bodies.push(t),
      () => undefined,
    );
  });
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Shop");
  await expect(p.locator("#view")).toContainText("Pay by card");
  await expect(p.locator("body")).not.toContainText("Visa and Mastercard only");
  const before = bodies.join("");

  await p.locator('[data-tile="pay"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Pay by card");
  await expect(p.locator('[data-field="body"]')).toContainText("Visa and Mastercard only");
  await expect(p.locator('[data-field="why"]')).toContainText("Most buyers have one");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Shop");
  expect(before).not.toContain("Visa and Mastercard only");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await live("Shop");
  w.werk("add", "pay", "--title", "Pay by card", "--parent", "root");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  await p.goto(`${w.url}/map/pay`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  const log = w.log;
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  const noToken = await send(w.url, "/api/accept", write);
  expect(noToken.status).toBeGreaterThanOrEqual(400);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  const badHost = await send(w.url, "/api/accept", { ...write, token, host: "evil.example" });
  expect(badHost.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/pay");
  expect(read.status).toBe(200);
  expect(read.body).toContain("Pay by card");
});
