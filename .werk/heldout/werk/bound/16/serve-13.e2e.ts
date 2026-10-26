// Held-out tests for steps 13.1 to 13.5: one server per store, a stale lock, live updates, the
// first load after an offline write, and the write trust of the page.
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Proj } from "./serve-helpers.ts";

let proj: Proj | undefined;
test.afterEach(async () => {
  await proj?.close();
  proj = undefined;
});

function fresh(): Proj {
  proj = new Proj();
  return proj;
}

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });

function send(
  url: string,
  path: string,
  options: { method?: string; host?: string; token?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
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

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  const w = fresh();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  w.seed("node.added", { id: "alpha", kind: "card", title: "Alpha card", parent: "root" });
  w.seed("node.added", { id: "beta", kind: "card", title: "Beta card", parent: "root" });

  // Both starts at the same moment.
  const t0 = Date.now();
  const a = w.serve(0);
  const b = w.serve(0);
  const first = await Promise.race([
    a.url.then((url) => ({ who: a, other: b, url })),
    b.url.then((url) => ({ who: b, other: a, url })),
  ]);
  const code = await first.other.exited;
  const waited = Date.now() - t0;
  expect(code).not.toBe(0);
  expect(first.who.proc.exitCode).toBeNull();
  const port = new URL(first.url).port;
  const msg = first.other.err();
  expect(msg).toContain(String(first.who.pid));
  expect(msg).toContain(port);
  expect(waited).toBeGreaterThan(1000);

  await p.goto(`${first.url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  test.setTimeout(60_000);
  const w = fresh();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  w.seed("node.added", { id: "alpha", kind: "card", title: "Alpha card", parent: "root" });
  const old = w.serve(0);
  await old.url;
  old.proc.kill("SIGKILL");
  await old.exited;
  expect(existsSync(join(w.dir, ".werk", "serve.lock"))).toBe(true);

  const t0 = Date.now();
  const next = w.serve(0);
  const url = await next.url;
  const took = Date.now() - t0;
  expect(next.err()).not.toContain("another werk");
  // The lock wait is 5 s; a start that waited for the dead server would take at least that long.
  expect(took).toBeLessThan(5000);

  await p.goto(`${url}/map`);
  await expect(h1(p)).toHaveText("Root card");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = fresh();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  const s = w.serve(0);
  const url = await s.url;

  // Record every changed signal each tab's live channel receives, and every card read.
  await context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __changed: string[] }).__changed = seen;
    const Orig = window.EventSource;
    class Recording extends Orig {
      constructor(u: string | URL, init?: EventSourceInit) {
        super(u, init);
        this.addEventListener("changed", (e) => seen.push((e as MessageEvent).data));
        this.addEventListener("open", () => {
          (window as unknown as { __open: boolean }).__open = true;
        });
      }
    }
    window.EventSource = Recording as typeof EventSource;
    (window as unknown as { kept: boolean }).kept = true;
  });
  const tabs = [await context.newPage(), await context.newPage()];
  const reads: number[] = [0, 0];
  for (const [i, tab] of tabs.entries()) {
    tab.on("request", (r) => {
      if (r.url().includes("/api/card/")) reads[i]++;
    });
    await tab.goto(`${url}/map`);
    await expect(h1(tab)).toHaveText("Root card");
  }
  // Each tab has its live channel open (it reads once on connect).
  for (const tab of tabs)
    await tab.waitForFunction(() => (window as unknown as { __open?: boolean }).__open === true);
  await tabs[0].waitForTimeout(500);
  const readsBefore = [...reads];

  const add = w.werk("add", "second", "--title", "Second card", "--why", "w", "--parent", "root");
  expect(add.code).toBe(0);

  for (const [i, tab] of tabs.entries()) {
    await expect(tab.locator('a[data-tile="second"]')).toContainText("Second card");
    await expect(h1(tab)).toHaveText("Root card");
    const changed = await tab.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toEqual([""]);
    expect(reads[i]).toBeGreaterThan(readsBefore[i]);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = fresh();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  const add = w.werk(
    "add",
    "invoice",
    "--title",
    "Invoice shows seats",
    "--why",
    "Customers check the bill",
    "--body",
    "Each line names the seats billed",
    "--parent",
    "root",
  );
  expect(add.code).toBe(0);
  const s = w.serve(0);
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
  await expect(h1(p)).toHaveText("Root card");
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("Invoice shows seats");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  expect(bodies.join("")).not.toContain("Each line names the seats billed");

  await tile.click();
  await expect(h1(p)).toHaveText("Invoice shows seats");
  await expect(p.locator('[data-field="body"]')).toContainText("Each line names the seats billed");
  await expect(p.locator('[data-field="why"]')).toContainText("Customers check the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root card");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = fresh();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  const s = w.serve(0);
  const url = await s.url;
  // A change to accept: a ghost card proposed by the agent.
  expect(w.werk("add", "retry", "--title", "Retry sends a new link", "--why", "w", "--parent", "root").code).toBe(0);

  await p.goto(`${url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(readFileSync(w.log, "utf8")).toContain('"change.accepted"');

  expect(w.werk("add", "later", "--title", "Later card", "--why", "w", "--parent", "root").code).toBe(0);
  const before = readFileSync(w.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  const noToken = await send(url, "/api/accept", write);
  expect(noToken.status).toBe(403);
  expect(readFileSync(w.log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  const badHost = await send(url, "/api/accept", { ...write, token, host: "evil.example" });
  expect(badHost.status).toBe(403);
  expect(readFileSync(w.log, "utf8")).toBe(before);

  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root card" });
});
