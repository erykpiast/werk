/// <reference lib="dom" />
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test as pwtest } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_BIN, test } from "../e2e/harness.ts";

const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(CHECKOUT, "src", "cli.ts");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

const heading = (p: Page, title: string) => p.getByRole("heading", { name: title, level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

// ---- a bare project helper (no harness server) ----
const roots: string[] = [];
const procs: ChildProcess[] = [];
pwtest.afterEach(async () => {
  for (const proc of procs.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) {
      const ex = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGKILL");
      await ex;
    }
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function bare() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-srv-")));
  roots.push(root);
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const env = { ...cleanEnv(process.env, FAKE_BIN), TMPDIR: root };
  return { dir, env };
}
function serve(dir: string, env: Record<string, string>) {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  const s = { out: "", err: "", proc, started: Date.now() };
  proc.stdout?.on("data", (c: Buffer) => (s.out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (s.err += c.toString()));
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const url = () => /http:\/\/\S+/.exec(s.out)?.[0].replace(/\/map$/, "");
  return { ...s, get out() { return s.out; }, get err() { return s.err; }, exited, url };
}
function wk(dir: string, env: Record<string, string>, ...args: string[]) {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return run.stdout;
}
async function until<T>(f: () => T | undefined, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
const cardTitles = ["Ship the checkout", "Retry a failed payment once", "Refund within a day"];

test("13.1 second server on same store refuses", async ({ page: p }) => {
  const { dir, env } = bare();
  const a = serve(dir, env);
  const b = serve(dir, env);
  const first = await Promise.race([
    until(() => (a.url() ? "a" : undefined)),
    until(() => (b.url() ? "b" : undefined)),
  ]);
  const winner = first === "a" ? a : b;
  const loser = first === "a" ? b : a;
  const code = await loser.exited;
  expect(code).not.toBe(0);
  const lock = JSON.parse(readFileSync(join(dir, ".werk", "serve.lock"), "utf8"));
  expect(loser.err).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err).toContain(`${new URL(winner.url() as string).port}`);
  expect(lock.pid).toBe(winner.proc.pid);
  expect(loser.url()).toBeUndefined();
  await p.goto(`${winner.url()}/map`);
  for (const t of ["Retry a failed payment once", "Refund within a day"]) await expect(p.locator("#view")).toContainText(t);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
});

test("13.2 new server after a killed server", async ({ page: p }) => {
  const { dir, env } = bare();
  const a = serve(dir, env);
  await until(() => a.url());
  a.proc.kill("SIGKILL");
  await a.exited;
  expect(readFileSync(join(dir, ".werk", "serve.lock"), "utf8")).toContain(`${a.proc.pid}`);
  const b = serve(dir, env);
  const t0 = Date.now();
  const url = await until(() => b.url());
  expect(Date.now() - t0).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(p.locator("#view")).toContainText("Retry a failed payment once");
  await expect(p.locator("#view")).toContainText("Refund within a day");
});

test("13.3 two tabs get one changed signal and redraw", async ({ browser, harness }) => {
  const w = await harness.start();
  const ctx = await browser.newContext();
  const pages = [await ctx.newPage(), await ctx.newPage()];
  for (const p of pages) {
    await p.addInitScript(() => {
      const W = window as unknown as { signals: { type: string; data: string }[] };
      W.signals = [];
      const Orig = window.EventSource;
      window.EventSource = class extends Orig {
        constructor(u: string | URL, o?: EventSourceInit) {
          super(u, o);
          this.addEventListener("changed", (e) => W.signals.push({ type: e.type, data: (e as MessageEvent).data }));
        }
      } as typeof EventSource;
    });
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Ship the checkout")).toBeVisible();
    await mark(p);
  }
  w.werk("add", "receipt", "--title", "Keep a receipt", "--why", "Disputes", "--body", "SECRETBODY", "--parent", "root");
  for (const p of pages) {
    await expect(p.locator("#view")).toContainText("Keep a receipt");
    const sig = await p.evaluate(() => (window as unknown as { signals: { data: string }[] }).signals);
    expect(sig.length).toBe(1);
    expect(sig[0]?.data ?? "").not.toContain("receipt");
    expect(await marked(p)).toBe(true);
  }
  await ctx.close();
});

test("13.4 card added while server down shows on first load", async ({ page: p, harness }) => {
  const w = await harness.start();
  await w.stop();
  w.werk("add", "invoice", "--title", "Invoice shows seats", "--why", "Bill check", "--body", "Each line names seats", "--parent", "root");
  await w.restart();
  await p.goto(`${w.url}/map`);
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("Invoice shows seats");
  await expect(p.locator("body")).not.toContainText("Each line names seats");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toHaveText("Each line names seats");
  await expect(p.locator('[data-field="why"]')).toContainText("Bill check");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Ship the checkout");
});

test("13.5 only the person's page can write", async ({ page: p, harness }) => {
  const w = await harness.start();
  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/later`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(readFileSync(log, "utf8")).toContain("accept");
  w.werk("add", "other", "--title", "Other", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const send = (path: string, o: { host?: string; token?: string; method?: string; body?: string }) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: w.port, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${w.port}`, "content-type": "application/json", ...(o.token ? { "x-werk-token": o.token } : {}) } },
        (res) => { let b = ""; res.on("data", (c: Buffer) => (b += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b })); },
      );
      req.on("error", reject);
      req.end(o.body);
    });
  const write = { method: "POST", body: JSON.stringify({ id: "other" }) };
  expect((await send("/api/accept", write)).status).toBe(403);
  expect((await send("/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send("/api/card/retry", {});
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "retry" });
});

test("14.1 routes, back/forward, not found", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane")).toContainText("Ship the checkout");
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await expect(p.locator("#chat-pane")).toBeVisible();
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await p.goBack();
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await p.goForward();
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await p.goto(`${w.url}/map/no-such-card`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(heading(p, "Ship the checkout")).toHaveCount(0);
  await expect(heading(p, "Retry a failed payment once")).toHaveCount(0);
});

test("14.2 CLI add appears without reload, composer kept", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 write while server down shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
});

test("14.4 dev server edit reuses live server", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await mark(p);
  const f = join(w.app, "src", "serve", "server.ts");
  const text = readFileSync(f, "utf8");
  writeFileSync(f, text.replace('"werk: no such address\\n"', '"werk: edited\\n"'));
  await expect.poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 15000 }).toBe("werk: edited\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await mark(p);
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("body")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 dev client edit reloads and keeps draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  const f = join(w.app, "web", "main.tsx");
  const text = readFileSync(f, "utf8");
  writeFileSync(f, text.replace('mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")'));
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});

test("69.1 map shows refines tree", async ({ page: p, harness }) => {
  const w = await harness.start();
  w.werk("add", "grand", "--title", "Grandchild card", "--parent", "retry");
  w.werk("accept", "grand", "--actor", "you");
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await expect(p.locator('#view a[data-tile="retry"]')).toBeVisible();
  await expect(p.locator('#view a[data-tile="a:b"]')).toBeVisible();
  await expect(p.locator('#view [data-tile="grand"]')).toHaveCount(0);
  await p.locator('a[data-tile="retry"]').click();
  await expect(p.locator('#view [data-tile="grand"]')).toBeVisible();
});

test("69.2 CLI add+accept appears without reload", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('#view a[data-tile="log"]')).toContainText("Use an append-only log");
  expect(await marked(p)).toBe(true);
});

test("69.3 open card survives reload, no edit controls", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="retry"]').click();
  await expect(p).toHaveURL(/\/map\/retry$/);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await expect(p.locator("#view [data-field] textarea, #view [data-field] input, #view h1 input, #view [data-field] [contenteditable=true], #view h1[contenteditable]")).toHaveCount(0);
  await expect(p.locator("#view").getByRole("button", { name: /edit|rename|retitle|save/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/retry$/);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
});

test("69.4 second server waits then refuses", async ({ page: p }) => {
  const { dir, env } = bare();
  const a = serve(dir, env);
  await until(() => a.url());
  const b = serve(dir, env);
  const code = await b.exited;
  const took = Date.now() - b.started;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(9000);
  expect(`${b.out}${b.err}`).toMatch(/wait/i);
  expect(b.err).toContain(`${a.proc.pid}`);
  await p.goto(`${a.url()}/map`);
  await expect(p.locator("#view")).toContainText("Retry a failed payment once");
  console.log("69.4 took", took, "out:", b.out, "err:", b.err);
});
