/// <reference lib="dom" />
// Held-out binder E: browser steps 13.3, 13.4, 13.5, 14.1, 14.2, 14.3, 69.1, 69.2, 69.3.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

let extra: ChildProcess | undefined;
test.afterEach(async () => {
  extra?.kill("SIGTERM");
  extra = undefined;
  stop();
});

const h1 = (p: Page) => p.locator("#view").getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function decided(seed: (t: string, p: object) => void, id: string, title: string, parent = "root", more = {}) {
  seed("node.added", { id, kind: "card", title, parent, status: "decided", who: "me", ...more });
}

/** Records every changed signal of every live channel the page opens. */
const RECORD = () => {
  const w = window as unknown as { changed: string[] };
  w.changed = [];
  const Real = window.EventSource;
  class Recording extends Real {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      this.addEventListener("changed", (e) => w.changed.push((e as MessageEvent).data));
    }
  }
  window.EventSource = Recording as typeof EventSource;
};

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

test("13.3", async ({ browser }) => {
  const w = await project();
  const context = await browser.newContext();
  await context.addInitScript(RECORD);
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await t.goto(`${w.url}/map`);
    await expect(h1(t)).toHaveText("Root");
    await mark(t);
  }
  // Let both channels connect before the write.
  for (const t of tabs) await t.waitForLoadState("networkidle").catch(() => undefined);
  w.werk("add", "second", "--title", "Second card from the line", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator("#view")).toContainText("Second card from the line");
    expect(await marked(t)).toBe(true);
  }
  await tabs[0].waitForTimeout(1500);
  for (const t of tabs) {
    const changed = await t.evaluate(() => (window as unknown as { changed: string[] }).changed);
    expect(changed).toEqual([""]);
  }
  await context.close();
});

test("13.4", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "second",
      "--title",
      "Second card written offline",
      "--why",
      "Why text for the second card",
      "--body",
      "Body text only on the card page",
      "--parent",
      "root",
    );
  });
  const bodies: string[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/api/"))
      void r.text().then(
        (t) => bodies.push(t),
        () => undefined,
      );
  });
  const first = await p.goto(`${w.url}/map`);
  const html = (await first?.text()) ?? "";
  await expect(h1(p)).toHaveText("Root");
  const tile = p.locator('a[data-tile="second"]');
  await expect(tile).toContainText("Second card written offline");
  await expect(p.locator("body")).not.toContainText("Body text only on the card page");
  expect(html).not.toContain("Body text only on the card page");
  expect(bodies.join("")).not.toContain("Body text only on the card page");
  await tile.click();
  await expect(h1(p)).toHaveText("Second card written offline");
  await expect(p.locator('[data-field="body"]')).toContainText("Body text only on the card page");
  await expect(p.locator('[data-field="why"]')).toContainText("Why text for the second card");
  await expect(p.locator('[data-tag="status"]')).toBeVisible();
  await expect(p.locator('[data-section="refines"]')).toContainText("Root");
});

test("13.5", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "change", "--title", "A proposed change", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");
  await p.goto(`${w.url}/map/change`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(readFileSync(log, "utf8")).toContain("change.accepted");

  w.werk("add", "other", "--title", "Other change", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "other" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(w.url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(log, "utf8")).toBe(before);
  const read = await send(w.url, "/api/card/root", {});
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root" });
});

test("14.1", async ({ page: p }) => {
  const w = await project(undefined, (down) => decided(down.seed, "child", "Child"));
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${w.url}/map/no-such-card`);
  await expect(p.locator("#view")).toContainText(/No card|not found|not in the map/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2", async ({ page: p }) => {
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

test("14.3", async ({ page: p }) => {
  const w = await project();
  const port = new URL(w.url).port;
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await mark(p);
  const lock = join(w.dir, ".werk", "serve.lock");
  const pid = JSON.parse(readFileSync(lock, "utf8")).pid as number;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      break;
    }
  }
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  const proc = spawn("bun", [CLI, "serve", "--port", port], {
    cwd: w.dir,
    env: cleanEnv(process.env, FAKE_BIN),
    stdio: ["ignore", "pipe", "pipe"],
  });
  extra = proc;
  await new Promise<void>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      if (/http:\/\//.test(out)) resolve();
    });
    proc.once("exit", (code) => reject(new Error(`serve exited ${code}`)));
  });
  // The person does not reload; the page may reload itself (Vite), which the step allows.
  await expect(p.locator("#view")).toContainText("Written offline");
});

test("69.1", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    decided(down.seed, "kid1", "First child");
    decided(down.seed, "kid2", "Second child");
    decided(down.seed, "grand", "The grandchild", "kid1");
  });
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="kid1"]')).toContainText("First child");
  await expect(p.locator('a[data-tile="kid2"]')).toContainText("Second child");
  // The grandchild is not a sub-card of the root.
  await expect(p.locator('[data-section="subcards"] a[data-tile="grand"]')).toHaveCount(0);
  await p.locator('a[data-tile="kid1"]').click();
  await expect(h1(p)).toHaveText("First child");
  await expect(p.locator('a[data-tile="grand"]')).toContainText("The grandchild");
});

test("69.2", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(h1(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--why", "History stays", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  const tile = p.locator('[data-section="subcards"] a[data-tile="log"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  expect(await marked(p)).toBe(true);
});

test("69.3", async ({ page: p }) => {
  const w = await project(undefined, (down) =>
    decided(down.seed, "kid", "A child card", "root", { body: "Child body words" }),
  );
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="kid"]').click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
  await expect(p.locator('[data-field="body"]')).toContainText("Child body words");
  const view = p.locator("#view");
  // The note box writes a note on the thread, not the title or the body; every other text box counts.
  const boxes = view.locator("input:not([type=hidden]), textarea, [contenteditable=true], [contenteditable='']");
  const names = await boxes.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.getAttribute("name") ?? e.id));
  expect(names.filter((n) => !/note/i.test(n ?? ""))).toEqual([]);
  await expect(view.getByRole("button", { name: /edit|rename|retitle|title|body|save/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(h1(p)).toHaveText("A child card");
});
