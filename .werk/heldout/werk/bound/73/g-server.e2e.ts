/// <reference lib="dom" />
// Held-out steps 13.x, 14.x and 69.1-69.4: the server, the live channel, the lock and dev mode.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const card = (w: { seed(t: string, p: object): void }, id: string, title: string, parent = "root") =>
  w.seed("node.added", { id, kind: "card", title, parent });

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
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** A bare project dir with a seeded log, and a way to start servers on it. */
function bareProject(cards: [string, string, string?][]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    cards
      .map(([id, title, parent], i) =>
        JSON.stringify({
          seq: i + 1,
          at: "t",
          actor: "you",
          type: "node.added",
          payload: { id, kind: "card", title, ...(parent ? { parent } : {}) },
        }),
      )
      .map((l) => `${l}\n`)
      .join(""),
  );
  const env = cleanEnv(process.env, FAKE_BIN);
  const procs: ChildProcess[] = [];
  const serve = () => {
    const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(proc);
    let out = "";
    let err = "";
    proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    const exit = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
    return { proc, out: () => out, err: () => err, exit, startedAt: Date.now() };
  };
  const cleanup = () => {
    for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  };
  return { dir, serve, cleanup };
}

async function urlOf(s: { out(): string; exit: Promise<number | null> }): Promise<string> {
  for (;;) {
    const found = /http:\/\/\S+/.exec(s.out());
    if (found) return found[0].replace(/\/map$/, "");
    const done = await Promise.race([s.exit.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);
    if (done && !/http:\/\/\S+/.test(s.out())) throw new Error("server exited");
  }
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const b = bareProject([
    ["root", "Root card"],
    ["one", "First card", "root"],
    ["two", "Second card", "root"],
  ]);
  try {
    const a = b.serve();
    const c = b.serve();
    const first = await Promise.race([
      urlOf(a).then((u) => ({ s: a, other: c, u })),
      urlOf(c).then((u) => ({ s: c, other: a, u })),
    ]);
    const code = await first.other.exit;
    const waited = Date.now() - first.other.startedAt;
    expect(code).not.toBe(0);
    expect(waited).toBeGreaterThan(3000);
    const port = new URL(first.u).port;
    expect(first.other.err()).toContain(`pid ${first.s.proc.pid}`);
    expect(first.other.err()).toContain(`port ${port}`);
    expect(first.other.out()).not.toContain("http://");
    await p.goto(`${first.u}/map`);
    await expect(h1(p)).toHaveText("Root card");
    await expect(p.locator('a[data-tile="one"]')).toContainText("First card");
    await expect(p.locator('a[data-tile="two"]')).toContainText("Second card");
  } finally {
    b.cleanup();
  }
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const b = bareProject([
    ["root", "Root card"],
    ["one", "First card", "root"],
  ]);
  try {
    const a = b.serve();
    await urlOf(a);
    a.proc.kill("SIGKILL");
    await a.exit;
    expect(readFileSync(join(b.dir, ".werk", "serve.lock"), "utf8")).toContain(String(a.proc.pid));
    const c = b.serve();
    const u = await urlOf(c);
    expect(Date.now() - c.startedAt).toBeLessThan(3000);
    await p.goto(`${u}/map`);
    await expect(h1(p)).toHaveText("Root card");
    await expect(p.locator('a[data-tile="one"]')).toContainText("First card");
  } finally {
    b.cleanup();
  }
});

/** Records every changed signal that the page's own live channel receives, with its data. */
const recordSignals = (p: Page) =>
  p.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { signals: string[] }).signals = seen;
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => seen.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
  });
const signals = (p: Page) => p.evaluate(() => (window as unknown as { signals: string[] }).signals);

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await project();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordSignals(t);
    await t.goto(`${w.url}/map`);
    await expect(h1(t)).toHaveText("Root");
    await mark(t);
  }
  w.werk("add", "second", "--title", "Second card here", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="second"]')).toContainText("Second card here");
    expect(await signals(t)).toEqual([""]);
    expect(await marked(t)).toBe(true);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "second",
      "--title",
      "Second card title",
      "--why",
      "Because the second why",
      "--body",
      "The second body text",
      "--parent",
      "root",
    );
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="second"]')).toContainText("Second card title");
  await expect(p.locator("body")).not.toContainText("The second body text");
  await p.locator('a[data-tile="second"]').click();
  await expect(h1(p)).toHaveText("Second card title");
  await expect(p.locator('[data-field="body"]')).toContainText("The second body text");
  await expect(p.locator('[data-field="why"]')).toContainText("Because the second why");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/retry", {});
  expect(read.status).toBe(200);
  expect(read.body).toContain("Retry sends a new link");
});

test("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "child", "Child"));
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator("#chat-pane")).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-card-has-this`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a command-line card appears on the open page without a reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
});

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  const after = await fetch(`${w.url}/no/such/address`);
  expect(new URL(after.url).port).toBe(String(w.port));
  expect(await after.text()).toBe("werk: edited reply\n");
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  const title = await h1(p).textContent();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.edited = "yes";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText(title ?? "");
  await expect(composer).toHaveValue("draft that must survive");
});

test("69.1 the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "kid-a", "Child A");
    card(down, "kid-b", "Child B");
    card(down, "grand", "Grandchild G", "kid-a");
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="kid-a"]')).toContainText("Child A");
  await expect(p.locator('a[data-tile="kid-b"]')).toContainText("Child B");
  await expect(p.locator('a[data-tile="grand"]')).toHaveCount(0);
  await p.locator('a[data-tile="kid-a"]').click();
  await expect(h1(p)).toHaveText("Child A");
  await expect(p.locator('a[data-tile="grand"]')).toContainText("Grandchild G");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "applog", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "applog", "--actor", "you");
  const tile = p.locator('a[data-tile="applog"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  expect(await marked(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "kid", "Child card"));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="kid"]').click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("Child card");
  const left = p.locator("#left-pane");
  await expect(left.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(left.locator("#view").getByRole("textbox").filter({ hasNotText: "" }).and(left.locator("#view").getByRole("textbox", { name: /title|body/i }))).toHaveCount(0);
  await expect(left.locator("#view").getByRole("textbox")).toHaveAccessibleName("Note");
  await expect(left.getByRole("button", { name: /edit|retitle|rename|title|body/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("Child card");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  const b = bareProject([
    ["root", "Root card"],
    ["one", "First card", "root"],
  ]);
  try {
    const a = b.serve();
    const u = await urlOf(a);
    const c = b.serve();
    await expect.poll(() => c.out() + c.err(), { timeout: 2000 }).toMatch(new RegExp(`wait.*${a.proc.pid}`, "i"));
    const code = await c.exit;
    expect(code).not.toBe(0);
    expect(Date.now() - c.startedAt).toBeLessThan(8000);
    expect(c.err()).toContain(String(a.proc.pid));
    await p.goto(`${u}/map`);
    await expect(p.locator('a[data-tile="one"]')).toContainText("First card");
  } finally {
    b.cleanup();
  }
});
