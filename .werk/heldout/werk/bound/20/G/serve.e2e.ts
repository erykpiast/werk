/// <reference lib="dom" />
// Held-out steps 13.1-13.5 and 69.4: the store lock, the live changed signal, the first load, and the token and Host checks.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, fixtureProject, makeProject, serve, werk } from "./g-helpers.ts";

test.afterEach(cleanup);
test.setTimeout(60_000);

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });

function send(url: string, path: string, options: { method?: string; host?: string; token?: string; body?: string } = {}) {
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
  const dir = fixtureProject();
  const a = serve(dir);
  const b = serve(dir);
  const url = await Promise.any([a.url, b.url]);
  const [winner, loser] = (await Promise.race([a.url.then(() => "a"), b.url.then(() => "b")])) === "a" ? [a, b] : [b, a];
  const code = await loser.exited;
  const waited = Date.now() - loser.startedAt;
  expect(code).not.toBe(0);
  expect(waited).toBeGreaterThan(4000);
  expect(winner.proc.exitCode).toBeNull();
  const port = new URL(url).port;
  expect(loser.err()).toContain(String(winner.proc.pid));
  expect(loser.err()).toContain(port);
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toContainText("Retry a failed payment once");
  await expect(p.locator('a[data-tile="a:b"]')).toContainText("Refund within a day");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const dir = makeProject([
    { id: "root", title: "Root card" },
    { id: "second", title: "Second card", parent: "root" },
  ]);
  const first = serve(dir);
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exited;
  expect(readFileSync(join(dir, ".werk", "serve.lock"), "utf8")).toContain(String(first.proc.pid));
  const again = serve(dir);
  const url = await again.url;
  expect(Date.now() - again.startedAt).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card");
});

/** Records the data of every changed signal the page's live channel receives. */
async function recordChanged(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const Original = window.EventSource;
    const seen: string[] = [];
    (window as unknown as { __changed: string[] }).__changed = seen;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => seen.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
  });
}
const changed = (p: Page) => p.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const dir = makeProject([{ id: "root", title: "Root card" }]);
  const s = serve(dir);
  const url = await s.url;
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${url}/map`);
    await expect(h1(t)).toHaveText("Root card");
    await t.waitForLoadState("networkidle");
    await mark(t);
  }
  const added = werk(dir, "add", "second", "--title", "Second card", "--parent", "root");
  expect(added.status).toBe(0);
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="second"]')).toContainText("Second card");
    await expect(h1(t)).toHaveText("Root card");
    expect(await marked(t)).toBe(true);
    expect(await changed(t)).toEqual([""]);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const dir = makeProject([{ id: "root", title: "Root card" }]);
  const added = werk(
    dir,
    "add",
    "second",
    "--title",
    "Second card title",
    "--why",
    "The why of the second card",
    "--body",
    "The body text of the second card",
    "--parent",
    "root",
  );
  expect(added.status).toBe(0);
  const s = serve(dir);
  const url = await s.url;
  const bodies: string[] = [];
  p.on("response", (r) => {
    void r.text().then(
      (t) => bodies.push(t),
      () => undefined,
    );
  });
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card title");
  await p.waitForLoadState("networkidle");
  await expect(p.locator("body")).not.toContainText("The body text of the second card");
  expect(bodies.join("")).not.toContain("The body text of the second card");
  await p.locator('a[data-tile="second"]').click();
  await expect(h1(p)).toHaveText("Second card title");
  await expect(p.locator('[data-field="body"]')).toHaveText("The body text of the second card");
  await expect(p.locator('[data-field="why"]')).toContainText("The why of the second card");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root card");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const dir = makeProject([{ id: "root", title: "Root card" }]);
  const log = join(dir, ".werk", "log.jsonl");
  const s = serve(dir);
  const url = await s.url;
  expect(werk(dir, "add", "ghost", "--title", "A proposed card", "--parent", "root").status).toBe(0);
  await p.goto(`${url}/map/ghost`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  expect(werk(dir, "add", "later", "--title", "Later card", "--parent", "root").status).toBe(0);
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root card" });
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  const dir = fixtureProject();
  const first = serve(dir);
  const url = await first.url;
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  const second = serve(dir);
  const pid = String(first.proc.pid);
  // While it waits, the second server prints that it waits for the first server's pid.
  await expect.soft.poll(() => second.err(), { timeout: 4000 }).toMatch(new RegExp(`wait[\\s\\S]*${pid}`, "i"));
  const code = await second.exited;
  expect(Date.now() - second.startedAt).toBeLessThan(7000);
  expect(code).not.toBe(0);
  expect(second.err()).toContain(pid);
  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toBeVisible();
  await expect(p.locator('a[data-tile="a:b"]')).toBeVisible();
});
