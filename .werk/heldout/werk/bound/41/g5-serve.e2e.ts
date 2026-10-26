import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page, test as pw } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";
import { cleanup, fixtureCopy, lockOf, serve, werk } from "./g5-util.ts";

pw.afterEach(async () => {
  await stop();
  await cleanup();
});
test.afterEach(async () => {
  await stop();
  await cleanup();
});

const h1 = (p: Page, t: string) => p.getByRole("heading", { name: t, level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as any).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as any).kept === true);

pw("13.1 second server on same store refuses", async ({ page: p }) => {
  const dir = fixtureCopy();
  const a = serve(dir);
  const b = serve(dir);
  const results = await Promise.race([a.exit.then((c) => ({ who: "a", c })), b.exit.then((c) => ({ who: "b", c }))]);
  const loser = results.who === "a" ? a : b;
  const winner = results.who === "a" ? b : a;
  expect(results.c).not.toBe(0);
  const url = await winner.url();
  expect(winner.proc.exitCode).toBeNull();
  const lock = lockOf(dir);
  expect(lock.pid).toBe(winner.proc.pid);
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err()).toContain(`port ${new URL(url).port}`);
  await p.goto(`${url}/map`);
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  await expect(p.locator("body")).toContainText("Ship the checkout");
  await p.goto(`${url}/map/a%3Ab`);
  await expect(h1(p, "Refund within a day")).toBeVisible();
});

pw("13.2 killed server lock does not block", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.werk("add", "second", "--title", "Second card", "--parent", "root"));
  const dir = w.dir;
  const lock = lockOf(dir);
  process.kill(lock.pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  const s = serve(dir);
  const t0 = Date.now();
  const url = await s.url();
  expect(Date.now() - t0).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(h1(p, "Root")).toBeVisible();
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card");
});

test("13.3 two tabs get one changed signal, no data, and re-read", async ({ browser, harness }) => {
  const w = await harness.start();
  const ctx = await browser.newContext();
  const tabs = [await ctx.newPage(), await ctx.newPage()];
  for (const t of tabs)
    await t.addInitScript(() => {
      (window as any).sig = [];
      const Orig = window.EventSource;
      (window as any).EventSource = class extends Orig {
        constructor(u: any, o?: any) {
          super(u, o);
          this.addEventListener("changed", (e: any) => (window as any).sig.push(e.data));
        }
      };
    });
  for (const t of tabs) {
    await t.goto(`${w.url}/map/root`);
    await expect(h1(t, "Ship the checkout")).toBeVisible();
    await t.waitForLoadState("networkidle");
    await mark(t);
  }
  w.werk("add", "extra", "--title", "Second added card", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator("#view")).toContainText("Second added card");
    await expect(t.locator("#view")).toContainText("Retry a failed payment once");
    await t.waitForTimeout(1500);
    const sig = await t.evaluate(() => (window as any).sig);
    expect(sig.length).toBe(1);
    expect(sig[0] === "" || sig[0] === "{}" || sig[0] === "undefined").toBe(true);
    expect(await marked(t)).toBe(true);
  }
  await ctx.close();
});

pw("13.4 card added while down shows on first load", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    d.werk(
      "add",
      "invoice",
      "--title",
      "The invoice shows the seat count",
      "--why",
      "Customers check the bill",
      "--body",
      "Each line names the seats",
      "--parent",
      "root",
    ),
  );
  await p.goto(`${w.url}/map`);
  await expect(p.locator('a[data-tile="root"], [data-view], #view')).toBeVisible();
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await expect(p.locator("body")).not.toContainText("Each line names the seats");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Each line names the seats");
  await expect(p.locator('[data-field="why"]')).toContainText("Customers check the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
});

pw("13.5 only own page writes", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const call = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: new URL(w.url).port,
          path: "/api/accept",
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
        },
        (res: any) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ id: "later" }));
    });
  const port = new URL(w.url).port;
  expect(await call({ host: `localhost:${port}` })).toBe(403);
  expect(await call({ host: "evil.example", "x-werk-token": token })).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const r = await fetch(`${w.url}/api/card/retry`);
  expect(r.status).toBe(200);
  expect((await r.json()).card.id).toBe("retry");
});

test("14.1 navigation and not-found", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { name: "Ship the checkout", level: 1 })).toBeVisible();
  await expect(p.locator("#chat-pane")).toBeVisible();
  await expect(p.locator("#left-pane #chat-pane")).toHaveCount(0);
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await p.goBack();
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.goForward();
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await p.goto(`${w.url}/map/nobody-here`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(h1(p, "Ship the checkout")).toHaveCount(0);
  await expect(h1(p, "Retry a failed payment once")).toHaveCount(0);
  console.log("14.1 notfound text:", await p.locator("#view").innerText());
});

test("14.2 CLI add appears without reload, composer kept", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 offline write shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await w.stop();
  w.werk("add", "off", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 20_000 });
});

test("14.4 dev server edit keeps live server and channel", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);
  const f = join(w.app, "src", "serve", "server.ts");
  const text = readFileSync(f, "utf8");
  expect(text).toContain('"werk: no such address\\n"');
  writeFileSync(f, text.replace('"werk: no such address\\n"', '"werk: nothing lives here\\n"'));
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 })
    .toBe("werk: nothing lives here\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 client edit reloads page and keeps draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  const f = join(w.app, "web", "main.tsx");
  const text = readFileSync(f, "utf8");
  writeFileSync(f, text.replace('mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")'));
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});

const tree = (d: { werk: (...a: string[]) => string }) => {
  d.werk("add", "c1", "--title", "Child one", "--parent", "root");
  d.werk("add", "c2", "--title", "Child two", "--parent", "root");
  d.werk("add", "g1", "--title", "Grandchild", "--parent", "c1");
};

pw("69.1 refines tree", async ({ page: p }) => {
  const w = await project(undefined, tree);
  await p.goto(`${w.url}/map`);
  await expect(h1(p, "Root")).toBeVisible();
  await expect(p.locator('a[data-tile="c1"]')).toBeVisible();
  await expect(p.locator('a[data-tile="c2"]')).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await expect(p.locator("body")).not.toContainText("Grandchild");
  await p.locator('a[data-tile="c1"]').click();
  await expect(h1(p, "Child one")).toBeVisible();
  await expect(p.locator('a[data-tile="g1"]')).toContainText("Grandchild");
});

pw("69.2 add and accept from CLI appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p, "Root")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await expect(p.locator("body")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('a[data-tile="log"]')).toContainText("Use an append-only log", { timeout: 5000 });
  expect(await marked(p)).toBe(true);
});

pw("69.3 open card survives reload, no edit control", async ({ page: p }) => {
  const w = await project(undefined, tree);
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p, "Child one")).toBeVisible();
  const inputs = await p
    .locator("#view")
    .locator("input, textarea, button, [contenteditable]")
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${e.tagName}:${e.getAttribute("aria-label") ?? ""}:${(e as HTMLElement).innerText ?? ""}:${e.getAttribute("name") ?? ""}`,
      ),
    );
  console.log("69.3 controls in #view:", JSON.stringify(inputs));
  await expect(p.locator("#view").locator("[contenteditable]")).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(h1(p, "Child one")).toBeVisible();
});

pw("69.4 second server waits then refuses", async ({ page: p }) => {
  const dir = fixtureCopy();
  const a = serve(dir);
  const url = await a.url();
  const t0 = Date.now();
  const b = serve(dir);
  const code = await b.exit;
  const took = Date.now() - t0;
  console.log("69.4 took", took, "code", code, "stdout:", b.out(), "stderr:", b.err());
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(9000);
  expect(b.err()).toContain(`pid ${a.proc.pid}`);
  await p.goto(`${url}/map`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  // the waiting message
  expect(b.out() + b.err()).toMatch(/wait/i);
});
