// Held-out: 13.1, 13.2, 69.4 — one server per project store.
import { expect, test } from "@playwright/test";
import { Raw, urlOf } from "./f-lib.ts";

let raw: Raw;
test.afterEach(() => raw?.close());

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  raw = new Raw();
  raw.card("root", "Root card");
  raw.card("alpha", "Alpha card", "root");
  raw.card("beta", "Beta card", "root");
  const a = raw.serve();
  const b = raw.serve();
  const [ua, ub] = await Promise.all([urlOf(a, 20000), urlOf(b, 20000)]);
  const running = [ua, ub].filter(Boolean);
  expect(running.length).toBe(1);
  const winner = ua ? a : b;
  const loser = ua ? b : a;
  const code = await loser.exited;
  expect(code).not.toBe(0);
  const port = new URL(running[0] as string).port;
  expect(loser.err()).toContain(String(winner.proc.pid));
  expect(loser.err()).toContain(port);
  expect(winner.proc.exitCode).toBeNull();
  await p.goto(`${running[0]}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  test.setTimeout(60_000);
  raw = new Raw();
  raw.card("root", "Root card");
  raw.card("alpha", "Alpha card", "root");
  const a = raw.serve();
  expect(await urlOf(a)).toBeDefined();
  a.proc.kill("SIGKILL");
  await a.exited;
  const started = Date.now();
  const b = raw.serve();
  const url = await urlOf(b);
  const took = Date.now() - started;
  expect(url).toBeDefined();
  expect(took).toBeLessThan(4500);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  test.setTimeout(60_000);
  raw = new Raw();
  raw.card("root", "Root card");
  raw.card("alpha", "Alpha card", "root");
  const a = raw.serve();
  const url = await urlOf(a);
  expect(url).toBeDefined();
  await p.goto(`${url}/map`);
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  const pid = String(a.proc.pid);
  const started = Date.now();
  const b = raw.serve();
  // The second server prints, while it waits, that it waits for the first server's pid.
  await expect.soft.poll(() => b.err(), { timeout: 3000 }).toMatch(new RegExp(`wait[^\\n]*${pid}`, "i"));
  const code = await b.exited;
  const took = Date.now() - started;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  console.log("second server stderr:", b.err(), "took", took);
  expect(b.err()).toContain(pid);
  await p.reload();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root card");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
});
