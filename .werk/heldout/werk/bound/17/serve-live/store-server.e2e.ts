// Held-out: steps 13.1–13.5 (one server per store, the live channel, the first load, the write trust).
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, makeProject } from "./lib.ts";

test.afterEach(cleanup);

const tile = (p: Page, id: string) => p.locator(`a[data-tile="${id}"]`);

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  const w = makeProject();
  w.card("root", "Root card");
  w.card("one", "First child");
  w.card("two", "Second child");
  const a = w.serve();
  const b = w.serve();
  const settled = await Promise.race([
    a.url.then(() => ({ win: a, lose: b })),
    b.url.then(() => ({ win: b, lose: a })),
  ]);
  const code = await settled.lose.exit;
  expect(code).not.toBe(0);
  const url = await settled.win.url;
  const port = new URL(url).port;
  expect(settled.lose.err()).toContain(`pid ${settled.win.proc.pid}`);
  expect(settled.lose.err()).toContain(`port ${port}`);
  expect(settled.win.proc.exitCode).toBeNull();
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(tile(p, "one")).toContainText("First child");
  await expect(tile(p, "two")).toContainText("Second child");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const w = makeProject();
  w.card("root", "Root card");
  w.card("one", "Only child");
  const first = w.serve();
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exit;
  const started = Date.now();
  const second = w.serve();
  const url = await second.url;
  expect(Date.now() - started).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(tile(p, "one")).toContainText("Only child");
});

/** Records every changed signal the page's live channel receives, with its data. */
async function recordChanged(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { changed: string[] }).changed = seen;
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => seen.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
    (window as unknown as { kept: boolean }).kept = true;
  });
}

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = makeProject();
  w.card("root", "Root card");
  const s = w.serve();
  const url = await s.url;
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root card");
    await t.evaluate(() => {
      (window as unknown as { mark: boolean }).mark = true;
    });
  }
  w.werk("add", "second", "--title", "Second card here", "--parent", "root");
  for (const t of tabs) {
    await expect(tile(t, "second")).toContainText("Second card here");
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root card");
    expect(await t.evaluate(() => (window as unknown as { mark?: boolean }).mark)).toBe(true);
    const changed = await t.evaluate(() => (window as unknown as { changed: string[] }).changed);
    expect(changed.length).toBe(1);
    expect(changed[0]).not.toContain("Second card here");
    expect(changed[0]).not.toContain("second");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = makeProject();
  w.card("root", "Root card");
  w.werk(
    "add", "second", "--title", "Second card here", "--why", "Because of the reason", "--body", "The secret body words", "--parent", "root",
  );
  const url = await w.serve().url;
  const bodies: string[] = [];
  p.on("response", (r) => {
    void r.text().then((t) => bodies.push(t), () => undefined);
  });
  await p.goto(`${url}/map`);
  await expect(tile(p, "second")).toContainText("Second card here");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator("body")).not.toContainText("The secret body words");
  expect(bodies.join("")).not.toContain("The secret body words");
  await tile(p, "second").click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Second card here");
  await expect(p.locator('[data-field="body"]')).toContainText("The secret body words");
  await expect(p.locator('[data-field="why"]')).toContainText("Because of the reason");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root card");
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

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = makeProject();
  w.card("root", "Root card");
  w.werk("add", "idea", "--title", "A proposed idea", "--parent", "root");
  const url = await w.serve().url;
  await p.goto(`${url}/map/idea`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(w.logText()).toContain('"change.accepted"');

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(w.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBe(403);
  expect(readFileSync(w.log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(w.log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root card" });
});
