/// <reference lib="dom" />
// Held-out steps 13.1-13.5: the store lock, the changed signal, the first load and write trust.
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeProject, serve, stopAll } from "./d-helpers.ts";

test.afterEach(stopAll);

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "Alpha root" });
  w.seed("node.added", { id: "beta", kind: "card", title: "Beta child", parent: "root" });
  w.seed("node.added", { id: "gamma", kind: "card", title: "Gamma child", parent: "root" });

  const a = serve(w);
  const b = serve(w);
  const started = Date.now();
  const results = await Promise.allSettled([a.ready, b.ready]);
  const winners = results.filter((r) => r.status === "fulfilled");
  expect(winners).toHaveLength(1);
  const [winner, loser] = results[0]?.status === "fulfilled" ? [a, b] : [b, a];
  const url = (
    results[0]?.status === "fulfilled" ? results[0].value : (results[1] as PromiseFulfilledResult<string>).value
  ) as string;

  const code = await loser.exited;
  expect(code).not.toBe(0);
  // The loser waited before it stopped.
  expect(Date.now() - started).toBeGreaterThan(1000);
  const port = new URL(url).port;
  expect(loser.err()).toContain(String(winner.proc.pid));
  expect(loser.err()).toContain(port);
  expect(winner.proc.exitCode).toBeNull();

  await p.goto(`${url}/map`);
  await expect(p.locator("#view")).toContainText("Alpha root");
  await expect(p.locator("#view")).toContainText("Beta child");
  await expect(p.locator("#view")).toContainText("Gamma child");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "First card" });
  w.seed("node.added", { id: "two", kind: "card", title: "Second card", parent: "root" });
  const first = serve(w);
  await first.ready;
  first.proc.kill("SIGKILL");
  await first.exited;
  expect(existsSync(join(w.dir, ".werk", "serve.lock"))).toBe(true);

  const t0 = Date.now();
  const second = serve(w);
  const url = await second.ready;
  // The default wait for a live lock is 5 s; a start with no wait is well below it.
  expect(Date.now() - t0).toBeLessThan(4000);

  await p.goto(`${url}/map`);
  await expect(p.locator("#view")).toContainText("First card");
  await expect(p.locator("#view")).toContainText("Second card");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "Only card" });
  const s = serve(w);
  const url = await s.ready;

  await context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __changed: string[] }).__changed = seen;
    const Original = window.EventSource;
    class Recording extends Original {
      constructor(u: string | URL, init?: EventSourceInit) {
        super(u, init);
        this.addEventListener("changed", (e) => seen.push(String((e as MessageEvent).data ?? "")));
      }
    }
    window.EventSource = Recording as typeof EventSource;
  });
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(`${url}/map`);
    await expect(tab.locator("#view")).toContainText("Only card");
    await tab.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }

  const add = w.werk("add", "second", "--title", "Second card here", "--why", "w", "--parent", "root");
  expect(add.code).toBe(0);
  for (const tab of tabs) {
    await expect(tab.locator("#view")).toContainText("Second card here");
    await expect(tab.locator("#view")).toContainText("Only card");
    expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
  }
  for (const tab of tabs) {
    const changed = await tab.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toContain("Second card here");
    expect(changed[0]).not.toContain("second");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  const add = w.werk(
    "add",
    "second",
    "--title",
    "Second card title",
    "--why",
    "The why of the second card",
    "--body",
    "The body text of the second card",
    "--parent",
    "root",
  );
  expect(add.code).toBe(0);
  const s = serve(w);
  const url = await s.ready;

  const bodies: string[] = [];
  p.on("response", (r) => {
    void r.text().then(
      (t) => bodies.push(t),
      () => undefined,
    );
  });
  await p.goto(`${url}/map`);
  await expect(p.locator("#view")).toContainText("Root card");
  await expect(p.locator("#view")).toContainText("Second card title");
  await expect(p.locator("body")).not.toContainText("The body text of the second card");
  expect(bodies.join("")).not.toContain("The body text of the second card");

  await p
    .getByRole("link", { name: /Second card title/ })
    .first()
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Second card title");
  await expect(p.locator("#view")).toContainText("The body text of the second card");
  await expect(p.locator("#view")).toContainText("The why of the second card");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root card");
});

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

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card" });
  const s = serve(w);
  const url = await s.ready;
  expect(w.werk("add", "pending", "--title", "Pending change", "--parent", "root").code).toBe(0);
  expect(w.werk("add", "other", "--title", "Other change", "--parent", "root").code).toBe(0);

  await p.goto(`${url}/map/pending`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  const before = readFileSync(w.log, "utf8");
  const body = JSON.stringify({ id: "other" });
  const noToken = await send(url, "/api/accept", { method: "POST", body });
  expect(noToken.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(w.log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  const badHost = await send(url, "/api/accept", { method: "POST", body, token, host: "evil.example" });
  expect(badHost.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(w.log, "utf8")).toBe(before);

  const read = await send(url, "/api/card/root", {});
  expect(read.status).toBe(200);
  expect(read.body).toContain("Root card");
});
