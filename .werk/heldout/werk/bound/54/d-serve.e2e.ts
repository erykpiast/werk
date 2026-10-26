// Held-out steps 13.1-13.5: the werk server, its lock, its live channel and its trust rule.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

const procs: ChildProcess[] = [];
const roots: string[] = [];
test.afterEach(() => {
  for (const proc of procs.splice(0)) proc.kill("SIGKILL");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Proj = {
  dir: string;
  log: string;
  env: Record<string, string>;
  seed(type: string, payload: object): void;
  werk(...args: string[]): { code: number | null; out: string; err: string };
};

function makeProject(): Proj {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-d-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: {} }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  return {
    dir,
    log,
    env,
    seed: (type, payload) =>
      appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`),
    werk: (...args) => {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: run.status, out: run.stdout, err: run.stderr };
    },
  };
}

type Started = {
  proc: ChildProcess;
  url: Promise<string>;
  exit: Promise<number | null>;
  out: () => string;
  err: () => string;
};

function serve(p: Proj): Started {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], {
    cwd: p.dir,
    env: p.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.push(proc);
  let out = "";
  let err = "";
  const exit = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
  const url = new Promise<string>((resolve, reject) => {
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    void exit.then((code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  url.catch(() => undefined);
  return { proc, url, exit, out: () => out, err: () => err };
}

function threeCards(p: Proj): void {
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  p.seed("node.added", { id: "alpha", kind: "card", title: "Alpha card", parent: "root" });
  p.seed("node.added", { id: "beta", kind: "card", title: "Beta card", parent: "root" });
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page }) => {
  const p = makeProject();
  threeCards(p);
  const a = serve(p);
  const b = serve(p);
  const results = await Promise.allSettled([
    Promise.race([a.url.then((u) => ({ who: a, u })), a.exit.then(() => undefined)]),
    Promise.race([b.url.then((u) => ({ who: b, u })), b.exit.then(() => undefined)]),
  ]);
  const winners = results.flatMap((r) => (r.status === "fulfilled" && r.value !== undefined ? [r.value] : []));
  expect(winners).toHaveLength(1);
  const winner = winners[0] as { who: Started; u: string };
  const loser = winner.who === a ? b : a;
  const code = await loser.exit;
  expect(code).not.toBe(0);
  const port = new URL(winner.u).port;
  expect(loser.err()).toContain(String(winner.who.proc.pid));
  expect(loser.err()).toContain(port);

  await page.goto(`${winner.u}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(page.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(page.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page }) => {
  const p = makeProject();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  p.seed("node.added", { id: "alpha", kind: "card", title: "Alpha card", parent: "root" });
  const first = serve(p);
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exit;
  expect(readFileSync(join(p.dir, ".werk", "serve.lock"), "utf8")).toContain(String(first.proc.pid));

  const began = Date.now();
  const second = serve(p);
  const url = await second.url;
  const took = Date.now() - began;
  // The lock wait is 5000 ms; a start that waits for the old server takes at least that long.
  expect(took).toBeLessThan(5000);

  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(page.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
});

async function recordChanged(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __changed: string[] };
    w.__changed = [];
    const Original = window.EventSource;
    class Recording extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        super.addEventListener("changed", (event) => w.__changed.push((event as MessageEvent<string>).data));
      }
    }
    window.EventSource = Recording;
  });
}

test("13.3 a page stays in step when a card is added on the command line", async ({ browser }) => {
  const p = makeProject();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  const s = serve(p);
  const url = await s.url;
  const context = await browser.newContext();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await recordChanged(tab);
    await tab.goto(`${url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root");
  }
  const reads = [0, 0];
  tabs.forEach((tab, i) =>
    tab.on("request", (req) => {
      if (req.url().includes("/api/card/")) reads[i] = (reads[i] ?? 0) + 1;
    }),
  );

  expect(p.werk("add", "second", "--title", "Second card", "--parent", "root").code).toBe(0);

  for (const tab of tabs) {
    await expect(tab.locator('a[data-tile="second"]')).toContainText("Second card");
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root");
    const changed = await tab.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toEqual([""]);
  }
  expect(reads.every((n) => n >= 1)).toBe(true);
  await context.close();
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page }) => {
  const p = makeProject();
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  const add = p.werk(
    "add",
    "second",
    "--title",
    "Second card",
    "--why",
    "Because the second reason holds",
    "--body",
    "The second body text in detail",
    "--parent",
    "root",
  );
  expect(add.code).toBe(0);
  const s = serve(p);
  const url = await s.url;
  await page.goto(`${url}/map`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(page.locator('a[data-tile="second"]')).toContainText("Second card");
  await expect(page.locator("body")).not.toContainText("The second body text in detail");

  await page.locator('a[data-tile="second"]').click();
  await expect(page).toHaveURL(/\/map\/second$/);
  const card = page.locator("#card");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second card");
  await expect(card.locator('[data-field="body"]')).toContainText("The second body text in detail");
  await expect(card.locator('[data-field="why"]')).toContainText("Because the second reason holds");
  await expect(card.locator('[data-tag="status"]')).toHaveText("open");
  // Its one neighbour is the card it refines, "Root".
  await expect(card).toContainText("Root");
});

function raw(url: string, method: string, path: string, headers: Record<string, string>, body?: string) {
  const u = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: u.port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => {
        text += c.toString();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("13.5 only the person's own page can write to the map", async ({ page }) => {
  const p = makeProject();
  expect(p.werk("add", "only", "--title", "Only card").code).toBe(0);
  const s = serve(p);
  const url = await s.url;
  await page.goto(`${url}/map/only`);
  await expect(page.locator('[data-tag="proposed"]')).toBeVisible();
  const before = readFileSync(p.log, "utf8");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(page.locator('article[data-card="only"]')).toHaveAttribute("data-proposed", "false");
  const afterAccept = readFileSync(p.log, "utf8");
  expect(afterAccept.length).toBeGreaterThan(before.length);

  const token = (await page.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const host = `127.0.0.1:${new URL(url).port}`;
  const note = JSON.stringify({ id: "only", text: "sneaky" });
  const noToken = await raw(url, "POST", "/api/notes", { host, "content-type": "application/json" }, note);
  expect(noToken.status).toBe(403);
  expect(readFileSync(p.log, "utf8")).toBe(afterAccept);

  const badHost = await raw(
    url,
    "POST",
    "/api/notes",
    { host: "evil.example", "content-type": "application/json", "x-werk-token": token },
    note,
  );
  expect(badHost.status).toBe(403);
  expect(readFileSync(p.log, "utf8")).toBe(afterAccept);

  const read = await raw(url, "GET", "/api/card/only", { host });
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card.title).toBe("Only card");
});
