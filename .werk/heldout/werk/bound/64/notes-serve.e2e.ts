// Held-out steps 06, 10 and 13: excerpt ghosts, notes and the inbox, the serve lock, the live
// channel and the write trust, in a real browser.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

const roots: string[] = [];
const procs = new Set<ChildProcess>();
test.afterEach(async () => {
  stop();
  for (const proc of procs) proc.kill("SIGKILL");
  procs.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ---- helpers for the steps that start their own servers ----

type Dir = { dir: string; log: string; werk(...args: string[]): { code: number; out: string; err: string } };

function bare(cards: { id: string; title: string; parent?: string; body?: string }[]): Dir {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  cards.forEach((card, i) => {
    appendFileSync(
      log,
      `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...card } })}\n`,
    );
  });
  const env = cleanEnv(process.env, FAKE_BIN);
  return {
    dir,
    log,
    werk: (...args) => {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
    },
  };
}

type Serve = { proc: ChildProcess; out: () => string; err: () => string; exit: Promise<number | null> };

function serve(d: Dir, port = 0): Serve {
  const env = cleanEnv(process.env, FAKE_BIN);
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
    cwd: d.dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.add(proc);
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => {
    out += c.toString();
  });
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exit = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  return { proc, out: () => out, err: () => err, exit };
}

function urlOf(s: Serve): Promise<string> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = /http:\/\/\S+/.exec(s.out());
      if (found !== null) {
        clearInterval(timer);
        resolve(found[0].replace(/\/map$/, ""));
      }
    };
    const timer = setInterval(check, 50);
    void s.exit.then((code) => {
      clearInterval(timer);
      reject(new Error(`serve exited ${code}: ${s.err()}`));
    });
  });
}

function send(url: string, path: string, options: { method?: string; host?: string; token?: string; body?: string }) {
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

// ---- page helpers ----

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

async function withChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const say = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

// ---- 06 ----

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await withChat();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  const row = say(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
  await p.goBack();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await withChat();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing`);
  await say(p).getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");

  await p.goto(`${w.url}/map/billing`);
  const row = say(p);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
});

// ---- 10 ----

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the inbox after a log position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login" && /^\d+$/.test(e.seq ?? ""))).toBe(true);
  const first = entries[0]?.seq as string;
  const since = w.werk("inbox", "--since", first);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc6749" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "oauth",
    session: "s1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "t0",
  });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

// ---- 13 ----

const THREE = [
  { id: "root", title: "Ship the checkout" },
  { id: "retry", title: "Retry a failed payment once", parent: "root" },
  { id: "refund", title: "Refund within a day", parent: "root" },
];

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  const d = bare(THREE);
  const a = serve(d);
  const b = serve(d);
  const settled = await Promise.race([
    urlOf(a).then((url) => ({ url, running: a, other: b })),
    urlOf(b).then((url) => ({ url, running: b, other: a })),
  ]);
  const code = await settled.other.exit;
  expect(code).not.toBe(0);
  const port = new URL(settled.url).port;
  expect(settled.other.err()).toContain(`pid ${settled.running.proc.pid}`);
  expect(settled.other.err()).toContain(port);
  expect(settled.running.proc.exitCode).toBeNull();

  await p.goto(`${settled.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toContainText("Retry a failed payment once");
  await expect(p.locator('a[data-tile="refund"]')).toContainText("Refund within a day");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const d = bare(THREE.slice(0, 2));
  const a = serve(d);
  await urlOf(a);
  a.proc.kill("SIGKILL");
  await a.exit;
  expect(readFileSync(join(d.dir, ".werk", "serve.lock"), "utf8")).toContain(String(a.proc.pid));
  const started = Date.now();
  const b = serve(d);
  const url = await urlOf(b);
  expect(Date.now() - started).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator('a[data-tile="retry"]')).toContainText("Retry a failed payment once");
});

const SPY = () => {
  const seen: { type: string; data: string }[] = [];
  (window as unknown as { __changed: typeof seen }).__changed = seen;
  const Real = window.EventSource;
  window.EventSource = class extends Real {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      this.addEventListener("changed", (e) => seen.push({ type: e.type, data: (e as MessageEvent).data }));
    }
  } as typeof EventSource;
};

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const d = bare(THREE.slice(0, 1));
  const s = serve(d);
  const url = await urlOf(s);
  await context.addInitScript(SPY);
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await t.goto(`${url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  }
  const reads = [0, 0];
  tabs.forEach((t, i) =>
    t.on("request", (r) => {
      if (r.url().includes("/api/") && !r.url().includes("/api/events")) reads[i] = (reads[i] ?? 0) + 1;
    }),
  );
  const added = d.werk("add", "second", "--title", "A second card", "--parent", "root");
  expect(added.code).toBe(0);
  for (const [i, t] of tabs.entries()) {
    await expect(t.locator('a[data-tile="second"]')).toContainText("A second card");
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
    const seen = await t.evaluate(() => (window as unknown as { __changed: { data: string }[] }).__changed);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.data).toBe("");
    expect(reads[i]).toBeGreaterThan(0);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const d = bare(THREE.slice(0, 1));
  const added = d.werk(
    "add",
    "invoice",
    "--title",
    "The invoice shows the seat count",
    "--why",
    "A customer checks the bill",
    "--body",
    "Each line names the seats billed",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);
  const s = serve(d);
  const url = await urlOf(s);
  const bodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/"))
      void r.text().then(
        (t) => bodies.push(t),
        () => undefined,
      );
  });
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  expect((await p.content()).includes("Each line names the seats billed")).toBe(false);
  expect(bodies.join("")).not.toContain("Each line names the seats billed");
  await tile.click();
  await expect(p.locator('[data-field="body"]')).toContainText("Each line names the seats billed");
  await expect(p.locator('[data-field="why"]')).toContainText("A customer checks the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("body")).toContainText("Ship the checkout");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const d = bare(THREE.slice(0, 1));
  expect(d.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root").code).toBe(0);
  const s = serve(d);
  const url = await urlOf(s);
  await p.goto(`${url}/map/retry`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");

  expect(d.werk("add", "later", "--title", "Later card", "--parent", "root").code).toBe(0);
  const before = readFileSync(d.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(d.log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root", {});
  expect(read.status).toBe(200);
  expect(read.body).toContain("Ship the checkout");
});
