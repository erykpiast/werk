/// <reference lib="dom" />
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Own } from "./own.ts";

let own: Own | undefined;
test.afterEach(async () => {
  await own?.close();
  own = undefined;
});

const heading = (p: Page) => p.getByRole("heading", { level: 1 });

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  own = new Own([
    { id: "root", title: "Root" },
    { id: "alpha", title: "Alpha card", parent: "root" },
    { id: "beta", title: "Beta card", parent: "root" },
  ]);
  const a = own.serve();
  const b = own.serve();
  const [ua, ub] = await Promise.all([a.url, b.url]);
  // Exactly one prints its address; the other exits.
  const winners = [ua, ub].filter((u) => u !== undefined);
  // Wait for the loser to exit (it may be waiting on the lock).
  const loser = ua === undefined ? a : b;
  const winner = ua === undefined ? b : a;
  const loserCode = await Promise.race([
    loser.exited,
    new Promise((r) => setTimeout(() => r("still running"), 20_000)),
  ]);
  const loserElapsed = Date.now() - loser.startedAt;
  expect(winners.length).toBe(1);
  expect(loserCode).not.toBe("still running");
  expect(loserCode).not.toBe(0);
  expect(winner.proc.exitCode).toBeNull();
  // The other start waits first (the lock wait is 5 s by default).
  expect(loserElapsed).toBeGreaterThan(3000);
  const url = winners[0] as string;
  const port = new URL(url).port;
  const msg = loser.err();
  expect(msg).toContain(String(winner.proc.pid));
  expect(msg).toContain(port);

  await p.goto(`${url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  test.setTimeout(60_000);
  own = new Own([
    { id: "root", title: "Root" },
    { id: "child", title: "Child card", parent: "root" },
  ]);
  const first = own.serve();
  expect(await first.url).toBeDefined();
  first.proc.kill("SIGKILL");
  await first.exited;
  // The killed server left its lock behind.
  expect(existsSync(join(own.dir, ".werk", "serve.lock"))).toBe(true);

  const second = own.serve();
  const url = await second.url;
  const elapsed = Date.now() - second.startedAt;
  expect(url).toBeDefined();
  // No wait for the old server: well under the 5 s lock wait.
  expect(elapsed).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('a[data-tile="child"]')).toContainText("Child card");
});

/** Records every "changed" event that the page's EventSource receives. */
async function recordChanged(p: Page) {
  await p.addInitScript(() => {
    const w = window as unknown as { changedData: string[]; EventSource: typeof EventSource };
    w.changedData = [];
    const Orig = w.EventSource;
    class Spy extends Orig {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => {
          w.changedData.push((e as MessageEvent).data);
        });
      }
    }
    w.EventSource = Spy;
  });
}
const changed = (p: Page) => p.evaluate(() => (window as unknown as { changedData: string[] }).changedData);
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  own = new Own([{ id: "root", title: "Root" }]);
  const s = own.serve();
  const url = await s.url;
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${url}/map`);
    await expect(heading(t)).toHaveText("Root");
    await t.waitForLoadState("networkidle").catch(() => undefined);
    await mark(t);
  }
  own.werk("add", "second", "--title", "Second card", "--why", "A reason", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('a[data-tile="second"]')).toContainText("Second card");
    expect(await marked(t)).toBe(true);
  }
  // Give any extra signal a moment to arrive, then check there was exactly one, with no data.
  await tabs[0].waitForTimeout(1000);
  for (const t of tabs) {
    const got = await changed(t);
    expect(got).toEqual([""]);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  own = new Own([{ id: "root", title: "Root" }]);
  own.werk(
    "add",
    "invoice",
    "--title",
    "The invoice shows the seat count",
    "--why",
    "A customer checks the bill against the team size",
    "--body",
    "Each line names the seats billed in the month",
    "--parent",
    "root",
  );
  const s = own.serve();
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
  await expect(heading(p)).toHaveText("Root");
  const tile = p.locator('a[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  expect((await p.content()).includes("Each line names the seats billed")).toBe(false);
  expect(bodies.join("")).not.toContain("Each line names the seats billed");

  await tile.click();
  await expect(heading(p)).toHaveText("The invoice shows the seat count");
  await expect(p.locator('[data-field="body"]')).toHaveText("Each line names the seats billed in the month");
  await expect(p.locator('[data-field="why"]')).toContainText("A customer checks the bill against the team size");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
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
  own = new Own([{ id: "root", title: "Root" }]);
  // A pending change (a proposed card) the person can accept from the page.
  own.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const s = own.serve();
  const url = (await s.url) as string;
  await p.goto(`${url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  own.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(own.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBe(403);
  expect(readFileSync(own.log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(own.log, "utf8")).toBe(before);

  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root" });
});
