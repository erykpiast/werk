// Held-out steps 13.1-13.5: the server lock, the live channel, the first load and write trust.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Proj, RECORD_CHANGED, send } from "./d-helpers.ts";

let proj: Proj | undefined;
test.afterEach(async () => {
  await proj?.close();
  proj = undefined;
});

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  proj = new Proj();
  proj.card("root", "Root of three");
  proj.card("alpha", "Alpha card", { parent: "root" });
  proj.card("beta", "Beta card", { parent: "root" });
  const a = proj.serve();
  const b = proj.serve();
  const results = await Promise.allSettled([a.url, b.url]);
  const won = results.filter((r) => r.status === "fulfilled");
  expect(won).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? a : b;
  const loser = winner === a ? b : a;
  const url = await winner.url;
  const port = new URL(url).port;
  const code = await loser.exit;
  expect(code).not.toBe(0);
  const msg = loser.err() + loser.out();
  expect(msg).toContain(String(winner.proc.pid));
  expect(msg).toContain(port);
  expect(winner.proc.exitCode).toBeNull();
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root of three");
  await expect(p.locator('a[data-tile="alpha"]')).toContainText("Alpha card");
  await expect(p.locator('a[data-tile="beta"]')).toContainText("Beta card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  proj = new Proj();
  proj.card("root", "Root of two");
  proj.card("other", "Other card", { parent: "root" });
  const first = proj.serve();
  await first.url;
  first.proc.kill("SIGKILL");
  await first.exit;
  const started = Date.now();
  const second = proj.serve();
  const url = await second.url;
  expect(Date.now() - started).toBeLessThan(4000);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root of two");
  await expect(p.locator('a[data-tile="other"]')).toContainText("Other card");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  proj = new Proj();
  proj.card("root", "Only root");
  const url = await proj.serve().url;
  await context.addInitScript(RECORD_CHANGED);
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(`${url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Only root");
    await tab.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }
  proj.werk("add", "second", "--title", "Second card from the CLI", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.locator('a[data-tile="second"]')).toContainText("Second card from the CLI");
    const changed = await tab.evaluate(() => (window as unknown as { __changed: string[] }).__changed);
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toContain("second");
    expect(changed[0]).not.toContain("Second card");
    expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  proj = new Proj();
  proj.card("root", "Lonely root");
  proj.werk(
    "add",
    "invoice",
    "--title",
    "Invoices list seats",
    "--why",
    "Customers check the bill",
    "--body",
    "Each line names the seats billed",
    "--parent",
    "root",
  );
  const url = await proj.serve().url;
  const bodies: string[] = [];
  p.on("response", (r) => {
    void r.text().then(
      (t) => bodies.push(t),
      () => undefined,
    );
  });
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Lonely root");
  await expect(p.locator('a[data-tile="invoice"]')).toContainText("Invoices list seats");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  expect(bodies.join("")).not.toContain("Each line names the seats billed");
  await p.locator('a[data-tile="invoice"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Invoices list seats");
  await expect(p.locator('[data-field="body"]')).toHaveText("Each line names the seats billed");
  await expect(p.locator('[data-field="why"]')).toContainText("Customers check the bill");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Lonely root");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  proj = new Proj();
  proj.card("root", "Root card");
  proj.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const url = await proj.serve().url;
  await p.goto(`${url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  proj.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(proj.log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  expect((await send(url, "/api/accept", write)).status).toBe(403);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(url, "/api/accept", { ...write, token, host: "evil.example" })).status).toBe(403);
  expect(readFileSync(proj.log, "utf8")).toBe(before);
  const read = await send(url, "/api/card/root");
  expect(read.status).toBe(200);
  expect(read.body).toContain("Root card");
});
