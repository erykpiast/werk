import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { cleanup, makeProject, serve } from "./lib13.ts";

test.afterEach(async () => {
  await stop();
  await cleanup();
});

test("13.1 a second server on the same store refuses while the first runs", async ({ page: p }) => {
  const dir = makeProject([
    { id: "one", title: "Card one" },
    { id: "two", title: "Card two" },
  ]);
  const a = serve(dir);
  const b = serve(dir);
  const first = await Promise.race([
    a.url.then((url) => ({ who: a, other: b, url })),
    b.url.then((url) => ({ who: b, other: a, url })),
  ]);
  const t0 = Date.now();
  const code = await first.other.exited;
  expect(code).not.toBe(0);
  expect(Date.now() - t0).toBeGreaterThan(300); // it waited
  const msg = first.other.err();
  expect(msg).toContain(`pid ${first.who.proc.pid}`);
  expect(msg).toContain(`port ${new URL(first.url).port}`);
  expect(first.who.proc.exitCode).toBeNull();
  await p.goto(`${first.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('a[data-tile="one"]')).toContainText("Card one");
  await expect(p.locator('a[data-tile="two"]')).toContainText("Card two");
});

test("13.2 a new server starts after a killed server left its lock", async ({ page: p }) => {
  const dir = makeProject([{ id: "one", title: "Card one" }]);
  const old = serve(dir);
  await old.url;
  old.proc.kill("SIGKILL");
  await old.exited;
  expect(readFileSync(join(dir, ".werk", "serve.lock"), "utf8")).toContain(String(old.proc.pid));
  const t0 = Date.now();
  const next = serve(dir);
  const url = await next.url;
  expect(Date.now() - t0).toBeLessThan(3000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('a[data-tile="one"]')).toContainText("Card one");
});

test("13.3 open pages stay in step when a card is added on the command line", async ({ browser }) => {
  const w = await project();
  const ctx = await browser.newContext();
  const pages = [await ctx.newPage(), await ctx.newPage()];
  for (const p of pages) {
    await p.addInitScript(() => {
      const w = window as unknown as { signals: (string | null)[] };
      w.signals = [];
      const Real = window.EventSource;
      class Spy extends Real {
        constructor(u: string | URL, o?: EventSourceInit) {
          super(u, o);
          this.addEventListener("changed", (e) => w.signals.push((e as MessageEvent).data ?? ""));
        }
      }
      window.EventSource = Spy as unknown as typeof EventSource;
    });
    await p.goto(`${w.url}/map`);
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  }
  w.werk("add", "second", "--title", "The second card", "--parent", "root");
  for (const p of pages) {
    await expect(p.locator('a[data-tile="second"]')).toContainText("The second card");
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
    const signals = await p.evaluate(() => (window as unknown as { signals: string[] }).signals);
    expect(signals).toEqual([""]);
  }
  await ctx.close();
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "second",
      "--title",
      "The second card",
      "--why",
      "Why of the second",
      "--body",
      "Body text of the second",
      "--parent",
      "root",
    );
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  const tile = p.locator('a[data-tile="second"]');
  await expect(tile).toContainText("The second card");
  await expect(p.locator("body")).not.toContainText("Body text of the second");
  await tile.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The second card");
  await expect(p.locator('[data-field="body"]')).toHaveText("Body text of the second");
  await expect(p.locator('[data-field="why"]')).toContainText("Why of the second");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
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
        res.on("data", (c: Buffer) => {
          body += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "one", "--title", "The one card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/one`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBe(403);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/one");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "one", title: "The one card" });
});
