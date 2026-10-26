// Scenarios 13.x: the werk server, its lock, its live channel and its trust rules.
import { request } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, type Proj, project, waitUrl } from "./e2e-harness.ts";

test.afterEach(cleanup);

function mapOf(titles: string[]): Proj {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: titles[0] as string });
  titles.slice(1).forEach((title, i) => w.seed("node.added", { id: `c${i + 1}`, kind: "card", title, parent: "root" }));
  return w;
}

function raw(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => {
        text += c.toString();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  const w = mapOf(["Shop", "Cart", "Checkout"]);
  const a = w.spawnServe();
  const b = w.spawnServe();
  const result = await Promise.race([
    Promise.all([a.exited, b.exited]).then(() => "both exited"),
    Promise.any([waitUrl(a), waitUrl(b)]).then(() => "one runs"),
  ]);
  expect(result).toBe("one runs");
  const loserExit = await Promise.race([a.exited.then((code) => ({ s: b, l: a, code })), b.exited.then((code) => ({ s: a, l: b, code }))]);
  const { s: winner, l: loser, code } = loserExit;
  expect(code).not.toBe(0);
  expect(winner.proc.exitCode).toBeNull();
  const url = await waitUrl(winner);
  const port = new URL(url).port;
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err()).toContain(port);
  await p.goto(`${url}/map`);
  for (const t of ["Shop", "Cart", "Checkout"]) await expect(p.getByText(t).first()).toBeVisible();
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  const w = mapOf(["Shop", "Cart"]);
  const first = await w.serve();
  first.proc.kill("SIGKILL");
  await first.exited;
  const started = Date.now();
  const second = await w.serve();
  const took = Date.now() - started;
  expect(took).toBeLessThan(5000);
  expect(second.err()).not.toContain("already serving");
  await p.goto(`${second.url}/map`);
  for (const t of ["Shop", "Cart"]) await expect(p.getByText(t).first()).toBeVisible();
});

async function recordChanged(p: Page) {
  await p.addInitScript(() => {
    const w = window as unknown as { __changed: string[]; EventSource: typeof EventSource };
    w.__changed = [];
    const Base = w.EventSource;
    w.EventSource = class extends Base {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("changed", (e) => w.__changed.push((e as MessageEvent).data));
      }
    } as typeof EventSource;
  });
}

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = mapOf(["Shop"]);
  const s = await w.serve();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await recordChanged(t);
    await t.goto(`${s.url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Shop");
  }
  await tabs[0]?.waitForTimeout(500);
  w.werk("add", "cart", "--title", "Cart holds items", "--parent", "root");
  for (const t of tabs) {
    await expect(t.getByText("Cart holds items")).toBeVisible();
    await expect(t.getByText("Shop").first()).toBeVisible();
  }
  for (const t of tabs) {
    const changed = await t.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toHaveLength(1);
    expect(changed[0] ?? "").not.toContain("Cart");
    expect(changed[0] ?? "").not.toContain("cart");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = mapOf(["Shop map"]);
  w.werk("add", "cart", "--title", "Cart holds items", "--why", "People buy many things at once", "--body", "The cart keeps items for seven days.", "--parent", "root");
  const s = await w.serve();
  await p.goto(`${s.url}/map`);
  await expect(p.getByText("Shop map").first()).toBeVisible();
  await expect(p.getByText("Cart holds items")).toBeVisible();
  await expect(p.locator("body")).not.toContainText("The cart keeps items for seven days.");
  await p.getByRole("link", { name: /Cart holds items/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Cart holds items");
  await expect(p.locator("body")).toContainText("The cart keeps items for seven days.");
  await expect(p.locator("body")).toContainText("People buy many things at once");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  // The neighbour of the card is its parent, "Shop map".
  await expect(p.locator("main")).toContainText("Shop map");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = mapOf(["Shop"]);
  w.werk("add", "cart", "--title", "Cart holds items", "--parent", "root");
  w.werk("add", "wish", "--title", "Wish list", "--parent", "root");
  const s = await w.serve();
  await p.goto(`${s.url}/map/cart`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");

  const before = w.lines().length;
  const noToken = await raw(`${s.url}/api/accept`, "POST", { "content-type": "application/json" }, JSON.stringify({ id: "wish" }));
  expect(noToken.status).toBe(403);
  expect(w.lines()).toHaveLength(before);
  const port = new URL(s.url).port;
  const badHost = await raw(
    `${s.url}/api/accept`,
    "POST",
    { "content-type": "application/json", "x-werk-token": token, host: `evil.example:${port}` },
    JSON.stringify({ id: "wish" }),
  );
  expect(badHost.status).toBe(403);
  expect(w.lines()).toHaveLength(before);
  expect(w.werk("show", "wish").split("\n")[0]).toContain("proposed");
  const read = await raw(`${s.url}/api/card/root`, "GET", {});
  expect(read.status).toBe(200);
  expect(read.text).toContain("Shop");
});
