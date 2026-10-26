/// <reference lib="dom" />
// Held-out: 13.1-13.5 and 69.4 (the server, its lock, its live channel and its write trust).
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));
const env = cleanEnv(process.env, FAKE_BIN);

const procs: ChildProcess[] = [];
const roots: string[] = [];

test.afterEach(async () => {
  for (const proc of procs.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGKILL");
      await exited;
    }
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function mapDir(cards: { id: string; title: string; parent?: string; [k: string]: unknown }[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-ho-e-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const lines = cards.map((c, i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...c } }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), lines.map((l) => `${l}\n`).join(""));
  return dir;
}

const werk = (dir: string, ...args: string[]) => {
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return run.stdout;
};

type Started = {
  proc: ChildProcess;
  out: () => string;
  err: () => string;
  url: Promise<string>;
  exit: Promise<number>;
};

function serve(dir: string): Started {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const url = new Promise<string>((resolve) => {
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
  });
  const exit = new Promise<number>((resolve) => proc.once("exit", (code) => resolve(code ?? -1)));
  return { proc, out: () => out, err: () => err, url, exit };
}

const THREE = [
  { id: "root", title: "Root" },
  { id: "alpha", title: "Alpha card", parent: "root" },
  { id: "beta", title: "Beta card", parent: "root" },
];

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const dir = mapDir(THREE);
  const a = serve(dir);
  const b = serve(dir);
  const winner = await Promise.race([a.url.then(() => a), b.url.then(() => b)]);
  const loser = winner === a ? b : a;
  const started = Date.now();
  const code = await loser.exit;
  const waited = Date.now() - started;
  expect(code).not.toBe(0);
  expect(waited).toBeGreaterThan(2000);
  const url = await winner.url;
  const port = new URL(url).port;
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err()).toContain(port);
  expect(winner.proc.exitCode).toBeNull();
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const dir = mapDir([
    { id: "root", title: "Root" },
    { id: "alpha", title: "Alpha card", parent: "root" },
  ]);
  const a = serve(dir);
  await a.url;
  a.proc.kill("SIGKILL");
  await a.exit;
  expect(existsSync(join(dir, ".werk", "serve.lock"))).toBe(true);
  const started = Date.now();
  const b = serve(dir);
  const url = await b.url;
  expect(Date.now() - started).toBeLessThan(4500);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
});

const recordChanged = (p: Page) =>
  p.addInitScript(() => {
    const w = window as unknown as { changed: string[] };
    w.changed = [];
    const Real = window.EventSource;
    class Spy extends Real {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        super.addEventListener("changed", (e) => w.changed.push(String((e as MessageEvent).data ?? "")));
      }
    }
    window.EventSource = Spy as typeof EventSource;
  });

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const dir = mapDir([{ id: "root", title: "Root" }]);
  const s = serve(dir);
  const url = await s.url;
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root");
    await t.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }
  werk(dir, "add", "second", "--title", "Second card", "--body", "Secret body words", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="second"]')).toContainText("Second card");
    const changed = await t.evaluate(() => (window as unknown as { changed: string[] }).changed);
    expect(changed.length).toBe(1);
    expect(changed[0]).not.toContain("second");
    expect(changed[0]).not.toContain("Second card");
    expect(await t.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const dir = mapDir([
    { id: "root", title: "Root" },
    { id: "first", title: "First card", parent: "root" },
  ]);
  werk(
    dir,
    "add",
    "second",
    "--title",
    "Second card",
    "--why",
    "Second why words",
    "--body",
    "Second body words",
    "--parent",
    "root",
  );
  const s = serve(dir);
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
  await expect(p.locator('a[data-tile="first"]')).toContainText("First card");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card");
  await expect(p.locator("body")).not.toContainText("Second body words");
  expect(bodies.join("")).not.toContain("Second body words");
  await p.locator('a[data-tile="second"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Second card");
  await expect(p.locator('[data-field="body"]')).toContainText("Second body words");
  await expect(p.locator('[data-field="why"]')).toContainText("Second why words");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
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
  const dir = mapDir([{ id: "root", title: "Root" }]);
  const s = serve(dir);
  const url = await s.url;
  werk(dir, "add", "idea", "--title", "An idea", "--parent", "root");
  const log = join(dir, ".werk", "log.jsonl");
  await p.goto(`${url}/map/idea`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  werk(dir, "add", "later", "--title", "Later card", "--parent", "root");
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
  expect(read.body).toContain("Root");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  const dir = mapDir(THREE);
  const a = serve(dir);
  const url = await a.url;
  await p.goto(`${url}/map`);
  await expect(p.locator('a[data-tile="alpha"]')).toBeVisible();
  const b = serve(dir);
  const started = Date.now();
  const code = await b.exit;
  const took = Date.now() - started;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(b.err()).toContain(`pid ${a.proc.pid}`);
  const p2 = await p.context().newPage();
  await p2.goto(`${url}/map`);
  await expect(p2.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p2.locator('a[data-tile="beta"]')).toContainText("Beta card");
  // The step also asks that the second server prints that it waits for the first server's pid.
  expect(b.out() + b.err()).toMatch(new RegExp(`wait[^\\n]*\\b${a.proc.pid}\\b|\\b${a.proc.pid}\\b[^\\n]*wait`, "i"));
});
