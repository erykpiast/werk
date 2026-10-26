// Held-out steps 13.x: werk serve, its lock, its live channel, its reads and its trust rules.
import { request } from "node:http";
import { expect, test } from "@playwright/test";
import { project, startServe, type Werk } from "./werk";

function cards(w: Werk, n: number): void {
  w.seed("node.added", { id: "root", kind: "card", title: "Root card", body: "ROOT-BODY-WORDS" });
  for (let i = 1; i < n; i++)
    w.seed("node.added", {
      id: `card-${i}`,
      kind: "card",
      title: `Child card ${i}`,
      body: `CHILD-BODY-${i}`,
      parent: "root",
    });
}

/** A raw HTTP request, so the test can set any Host header. */
function raw(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => {
        text += chunk.toString();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  const w = project();
  cards(w, 3);
  const a = startServe(w.dir);
  const b = startServe(w.dir);
  const results = await Promise.allSettled([a.url, b.url]);
  const won = results.findIndex((r) => r.status === "fulfilled");
  const lost = results.findIndex((r) => r.status === "rejected");
  expect(won).toBeGreaterThanOrEqual(0);
  expect(lost).toBeGreaterThanOrEqual(0);
  const winner = [a, b][won] as ReturnType<typeof startServe>;
  const loser = [a, b][lost] as ReturnType<typeof startServe>;
  const url = (results[won] as PromiseFulfilledResult<string>).value;
  const port = new URL(url).port;
  const message = loser.err();
  expect(message).toContain(String(winner.proc.pid));
  expect(message).toContain(port);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.getByText("Child card 1")).toBeVisible();
  await expect(p.getByText("Child card 2")).toBeVisible();
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const w = project();
  cards(w, 2);
  const first = startServe(w.dir);
  await first.url;
  first.proc.kill("SIGKILL");
  await new Promise((resolve) => first.proc.once("exit", resolve));
  const started = Date.now();
  const url = await startServe(w.dir).url;
  // The wait for a live holder is five seconds; a start with a stale lock takes none of it.
  expect(Date.now() - started).toBeLessThan(5000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.getByText("Child card 1")).toBeVisible();
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = project();
  cards(w, 1);
  const url = await w.serve();
  await context.addInitScript(() => {
    const Original = window.EventSource;
    const seen: string[] = [];
    (window as unknown as { __changed: string[] }).__changed = seen;
    (window as unknown as { __open: boolean }).__open = false;
    window.EventSource = class extends Original {
      constructor(source: string | URL, init?: EventSourceInit) {
        super(source, init);
        this.addEventListener("open", () => {
          (window as unknown as { __open: boolean }).__open = true;
        });
        this.addEventListener("changed", (event) => seen.push((event as MessageEvent).data));
      }
    };
  });
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(`${url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root card");
    await tab.waitForFunction(() => (window as unknown as { __open: boolean }).__open);
  }
  w.ok("add", "second", "--title", "Second card", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.getByText("Second card")).toBeVisible();
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root card");
  }
  for (const tab of tabs) {
    const changed = await tab.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toEqual([""]);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root card", body: "ROOT-BODY-WORDS" });
  w.ok(
    "add",
    "second",
    "--title",
    "Second card",
    "--why",
    "SECOND-WHY-WORDS",
    "--body",
    "SECOND-BODY-WORDS",
    "--parent",
    "root",
  );
  const url = await w.serve();
  await p.goto(`${url}/map`);
  await expect(p.getByText("Root card").first()).toBeVisible();
  await expect(p.getByText("Second card")).toBeVisible();
  const overview = await p.locator("body").innerText();
  const bodiesInOverview = ["ROOT-BODY-WORDS", "SECOND-BODY-WORDS"].filter((text) => overview.includes(text));

  await p.getByRole("link", { name: /Second card/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Second card");
  await expect(p.locator('[data-field="body"]')).toContainText("SECOND-BODY-WORDS");
  await expect(p.locator('[data-field="why"]')).toContainText("SECOND-WHY-WORDS");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect.soft(p.locator("main")).toContainText("Root card");
  expect.soft(bodiesInOverview).toEqual([]);
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = project();
  cards(w, 1);
  w.ok("add", "ghost", "--title", "A ghost card", "--parent", "root");
  const url = await w.serve();
  const port = new URL(url).port;
  const before = w.lines();

  const noToken = await raw(
    `${url}/api/notes`,
    "POST",
    { "content-type": "application/json", host: `127.0.0.1:${port}` },
    JSON.stringify({ id: "root", text: "sneaky" }),
  );
  expect(noToken.status).toBe(403);
  expect(w.lines()).toBe(before);

  await p.goto(`${url}/map/ghost`);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) as string;
  const badHost = await raw(
    `${url}/api/notes`,
    "POST",
    { "content-type": "application/json", host: `evil.example:${port}`, "x-werk-token": token },
    JSON.stringify({ id: "root", text: "sneaky" }),
  );
  expect(badHost.status).toBe(403);
  expect(w.lines()).toBe(before);

  const read = await raw(`${url}/api/card/root`, "GET", { host: `127.0.0.1:${port}` });
  expect(read.status).toBe(200);
  expect(read.text).toContain("Root card");

  // The person accepts the ghost from the page.
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 5000 });
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(w.lines()).toBe(before + 1);
});
