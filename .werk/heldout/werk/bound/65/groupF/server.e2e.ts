/// <reference lib="dom" />
// Held-out tests for steps 13.1–13.5 and 14.1–14.5.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test as plain } from "@playwright/test";
import { test } from "../../e2e/harness";
import { project, stop as stopProject } from "../../e2e/project.ts";
import { cleanEnv } from "../../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

// ---------- a bare project helper for the server-start steps ----------

type Bare = {
  dir: string;
  werk(...args: string[]): { status: number | null; out: string; err: string };
  serve(port?: number): { proc: ChildProcess; out(): string; err(): string; exited: Promise<number | null> };
  close(): void;
};

function bareProject(titles: string[]): Bare {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-f-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const lines = titles.map((title, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: i === 0 ? { id: "root", kind: "card", title } : { id: `c${i}`, kind: "card", title, parent: "root" },
    }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  const env = { ...cleanEnv(process.env, FAKE_BIN), TMPDIR: root };
  const procs: ChildProcess[] = [];
  return {
    dir,
    werk: (...args) => {
      const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      return { status: r.status, out: r.stdout, err: r.stderr };
    },
    serve: (port = 0) => {
      const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
        cwd: dir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      procs.push(proc);
      let out = "";
      let err = "";
      proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
      proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
      const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
      return { proc, out: () => out, err: () => err, exited };
    },
    close: () => {
      for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const urlOf = (text: string) => /http:\/\/\S+/.exec(text)?.[0].replace(/\/map$/, "");

plain.describe("13 server", () => {
  plain.afterEach(stopProject);

  plain("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
    const b = bareProject(["Card one", "Card two", "Card three"]);
    try {
      const first = b.serve();
      const second = b.serve();
      // Exactly one of the two prints its address; the other exits.
      const winner = await Promise.race([first.exited.then(() => "second"), second.exited.then(() => "first")]);
      const live = winner === "first" ? first : second;
      const lost = winner === "first" ? second : first;
      const lostCode = await lost.exited;
      expect(lostCode).not.toBe(0);
      await expect.poll(() => urlOf(live.out())).toBeTruthy();
      expect(live.proc.exitCode).toBeNull();
      const url = urlOf(live.out()) as string;
      const port = new URL(url).port;
      expect(lost.err()).toContain(String(live.proc.pid));
      expect(lost.err()).toContain(port);
      await p.goto(`${url}/map`);
      for (const t of ["Card one", "Card two", "Card three"]) await expect(p.locator("body")).toContainText(t);
    } finally {
      b.close();
    }
  });

  plain("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
    const b = bareProject(["Card one", "Card two"]);
    try {
      const first = b.serve();
      await expect.poll(() => urlOf(first.out())).toBeTruthy();
      first.proc.kill("SIGKILL");
      await first.exited;
      expect(readFileSync(join(b.dir, ".werk", "serve.lock"), "utf8")).toContain(String(first.proc.pid));
      const started = Date.now();
      const second = b.serve();
      await expect.poll(() => urlOf(second.out()), { timeout: 4000 }).toBeTruthy();
      expect(Date.now() - started).toBeLessThan(4000);
      await p.goto(`${urlOf(second.out())}/map`);
      await expect(p.locator("body")).toContainText("Card one");
      await expect(p.locator("body")).toContainText("Card two");
    } finally {
      b.close();
    }
  });

  plain("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
    const w = await project();
    await context.addInitScript(() => {
      const Orig = window.EventSource;
      const seen: { type: string; data: string }[] = [];
      (window as unknown as { seen: typeof seen }).seen = seen;
      window.EventSource = class extends Orig {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          this.addEventListener("changed", (e) => seen.push({ type: "changed", data: (e as MessageEvent).data }));
        }
      } as typeof EventSource;
    });
    const tabs = [await context.newPage(), await context.newPage()];
    const keep = (t: Page) => t.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    for (const t of tabs) {
      await t.goto(`${w.url}/map`);
      await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root");
      await t.waitForLoadState("networkidle");
      await keep(t);
    }
    w.werk("add", "second", "--title", "Second card here", "--parent", "root");
    for (const t of tabs) {
      await expect(t.locator("body")).toContainText("Second card here");
      await expect(t.locator("body")).toContainText("Root");
      const seen = await t.evaluate(() => (window as unknown as { seen: { data: string }[] }).seen);
      expect(seen.length).toBe(1);
      expect(seen[0].data).not.toContain("Second card here");
      expect(seen[0].data).not.toContain("second");
      expect(await t.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
    }
  });

  plain("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
    const w = await project(undefined, (down) => {
      down.werk(
        "add",
        "later",
        "--title",
        "Card written offline",
        "--why",
        "Because the server slept",
        "--body",
        "Body words only on open",
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
    await p.goto(`${w.url}/map`);
    await expect(p.locator("body")).toContainText("Root");
    await expect(p.locator("body")).toContainText("Card written offline");
    await expect(p.locator("body")).not.toContainText("Body words only on open");
    expect(bodies.join("")).not.toContain("Body words only on open");
    await p.locator('a[data-tile="later"]').click();
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Card written offline");
    await expect(p.locator("#view")).toContainText("Body words only on open");
    await expect(p.locator("#view")).toContainText("Because the server slept");
    await expect(p.locator('[data-tag="status"]')).toHaveText("open");
    await expect(p.locator("#view")).toContainText("Root");
  });

  plain("13.5 only the person's own page can write to the map", async ({ page: p }) => {
    const w = await project();
    w.werk("add", "pend", "--title", "Pending card", "--parent", "root");
    const log = join(w.dir, ".werk", "log.jsonl");
    await p.goto(`${w.url}/map/pend`);
    await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
    await p.getByRole("button", { name: "Accept" }).click();
    await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
    expect(readFileSync(log, "utf8")).toContain("accept");

    w.werk("add", "other", "--title", "Other card", "--parent", "root");
    const before = readFileSync(log, "utf8");
    const body = JSON.stringify({ id: "other" });
    const noToken = await send(w.url, "/api/accept", { method: "POST", body });
    expect(noToken.status).toBeGreaterThanOrEqual(400);
    const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
    expect(token).not.toBe("");
    const badHost = await send(w.url, "/api/accept", { method: "POST", body, token, host: "attacker.example" });
    expect(badHost.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(log, "utf8")).toBe(before);
    const read = await send(w.url, "/api/card/pend");
    expect(read.status).toBe(200);
    expect(read.body).toContain("Pending card");
  });
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
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

// ---------- 14: the client in a browser ----------

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

plain.describe("14 client", () => {
  plain.afterEach(stopProject);

  plain("14.1 addresses, back and forward, and not found", async ({ page: p }) => {
    const w = await project(undefined, (down) => {
      down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" });
    });
    await p.goto(`${w.url}/map`);
    await expect(p.locator("#left-pane").getByRole("heading", { name: "Root" }).first()).toBeVisible();
    await expect(p.locator("#chat-pane")).toBeVisible();
    await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
    await p.goto(`${w.url}/map/child`);
    await expect(h1(p)).toHaveText("Child");
    await p.goBack();
    await expect(h1(p)).toHaveText("Root");
    await p.goForward();
    await expect(h1(p)).toHaveText("Child");
    await p.goto(`${w.url}/map/no-card-has-this`);
    await expect(p.locator("#view")).toContainText(/not found|no card|does not hold/i);
    await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
    await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
  });

  plain("14.2 a card added from the command line appears without a reload", async ({ page: p }) => {
    const w = await project();
    await p.goto(`${w.url}/map/root`);
    await expect(h1(p)).toHaveText("Root");
    const composer = p.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(p);
    w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(p.locator("#view")).toContainText("Fresh idea");
    expect(await marked(p)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  const title = (await h1(p).textContent()) ?? "";
  expect(title).not.toBe("");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--why", "w", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
  // The step asks only that the person does not reload; whether the page reloaded by itself is recorded below.
  console.log("14.3 document kept:", await marked(p));
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
  await p.waitForLoadState("networkidle");
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited handler\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: edited handler\n");
  w.werk("add", "after", "--title", "After edit", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
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
