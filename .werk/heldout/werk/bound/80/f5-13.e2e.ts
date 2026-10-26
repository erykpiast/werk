import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fixtureCopy, serve } from "./f5-serve.ts";
import { project, stop } from "../e2e/project.ts";

const cards = async (p: import("@playwright/test").Page, url: string) => {
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator("[data-tile]")).toHaveCount(2);
};

test("13.1 second server on the same store refuses while the first runs", async ({ page: p }) => {
  const dir = fixtureCopy();
  const a = serve(dir);
  const b = serve(dir);
  const winner = await Promise.race([
    a.url().then(() => "a" as const, () => "none" as const),
    b.url().then(() => "b" as const, () => "none" as const),
  ]);
  expect(winner).not.toBe("none");
  const [w, l] = winner === "a" ? [a, b] : [b, a];
  const code = await Promise.race([l.exited, new Promise((r) => setTimeout(() => r("timeout"), 20000))]);
  expect(code).not.toBe("timeout");
  expect(code).not.toBe(0);
  expect(l.err()).toContain(`pid ${w.proc.pid}`);
  const url = await w.url();
  expect(l.err()).toContain(`port ${new URL(url).port}`);
  expect(w.proc.exitCode).toBeNull();
  await cards(p, url);
  w.proc.kill();
});

test("13.2 new server starts after a killed server left its lock", async ({ page: p }) => {
  const dir = fixtureCopy();
  const a = serve(dir);
  await a.url();
  a.proc.kill("SIGKILL");
  await a.exited;
  const t0 = Date.now();
  const b = serve(dir);
  const url = await b.url();
  expect(Date.now() - t0).toBeLessThan(4500);
  await cards(p, url);
  b.proc.kill();
});

test.describe("13 with project()", () => {
  test.afterEach(stop);

  test("13.3 page stays in step when a card is added on the command line", async ({ browser }) => {
    const w = await project();
    const ctx = await browser.newContext();
    const tabs = [await ctx.newPage(), await ctx.newPage()];
    for (const t of tabs) {
      await t.goto(`${w.url}/map`);
      await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root");
      await t.evaluate(() => {
        const log: string[] = [];
        (window as any).sig = log;
        const es = new EventSource("/api/events");
        es.addEventListener("changed", (e) => log.push((e as MessageEvent).data));
        (window as any).es = es;
        return new Promise((r) => es.addEventListener("open", () => r(0)));
      });
    }
    w.werk("add", "second", "--title", "Second card", "--parent", "root");
    for (const t of tabs) {
      await expect(t.locator('[data-tile="second"]')).toContainText("Second card");
      const sig = await t.evaluate(() => (window as any).sig as string[]);
      expect(sig.length).toBe(1);
      expect(sig[0]).not.toContain("Second card");
      expect(sig[0].length).toBeLessThan(20);
    }
    await ctx.close();
  });

  test("13.4 card added while server was down shows on first load", async ({ page: p }) => {
    const w = await project(undefined, (down) => {
      down.werk("add", "invoice", "--title", "The invoice shows seats", "--why", "Because bills", "--body", "Secret body words", "--parent", "root");
    });
    await p.goto(`${w.url}/map`);
    const tile = p.locator('a[data-tile="invoice"]');
    await expect(tile).toContainText("The invoice shows seats");
    await expect(p.locator("body")).not.toContainText("Secret body words");
    await tile.click();
    await expect(p.locator('[data-field="body"]')).toHaveText("Secret body words");
    await expect(p.locator('[data-field="why"]')).toContainText("Because bills");
    await expect(p.locator('[data-tag="status"]')).toHaveText("open");
    await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
  });

  test("13.5 only the person's own page can write", async ({ page: p }) => {
    const w = await project();
    w.werk("add", "retry", "--title", "Retry", "--parent", "root");
    const log = join(w.dir, ".werk", "log.jsonl");
    await p.goto(`${w.url}/map/retry`);
    await p.getByRole("button", { name: "Accept" }).click();
    await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
    w.werk("add", "later", "--title", "Later", "--parent", "root");
    const before = readFileSync(log, "utf8");
    const port = new URL(w.url).port;
    const send = (path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token ? { "x-werk-token": o.token } : {}) } },
          (res) => {
            let body = "";
            res.on("data", (c: Buffer) => (body += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on("error", reject);
        req.end(o.body);
      });
    const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
    expect((await send("/api/accept", write)).status).toBe(403);
    const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
    expect((await send("/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
    expect(readFileSync(log, "utf8")).toBe(before);
    const read = await send("/api/card/retry");
    expect(read.status).toBe(200);
    expect(JSON.parse(read.body).card.id).toBe("retry");
  });
});
