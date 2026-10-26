import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { type Bare, bare, channelLog, mark, marked, send, serve, watchChannel } from "./web-a-util.ts";

let b: Bare | undefined;
test.afterEach(() => {
  b?.cleanup();
  b = undefined;
  stop();
});

function cards(x: Bare, children: string[]): void {
  x.seed("node.added", { id: "root", kind: "card", title: "Root" });
  children.forEach((title, i) => {
    x.seed("node.added", { id: `c${i + 1}`, kind: "card", title, parent: "root" });
  });
}

test("13.1 a second server on the same store refuses while the first one runs", async ({ page: p }) => {
  test.setTimeout(60_000);
  b = bare();
  cards(b, ["Second card", "Third card"]);
  const started = Date.now();
  const one = serve(b);
  const two = serve(b);
  const [u1, u2] = await Promise.all([one.url, two.url]);
  const winner = u1 !== undefined ? one : two;
  const loser = u1 !== undefined ? two : one;
  const url = (u1 ?? u2) as string;
  expect([u1, u2].filter((u) => u !== undefined)).toHaveLength(1);

  const code = await loser.exited;
  // The loser printed no address and exited non-zero after a wait.
  expect(code).not.toBe(0);
  expect(loser.out()).not.toMatch(/http:\/\//);
  const port = new URL(url).port;
  expect(loser.err()).toContain(String(winner.proc.pid));
  expect(loser.err()).toContain(port);
  expect(Date.now() - started).toBeGreaterThan(1000);
  expect(winner.proc.exitCode).toBeNull();

  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('[data-tile="c1"]')).toContainText("Second card");
  await expect(p.locator('[data-tile="c2"]')).toContainText("Third card");
});

test("13.2 a new server starts after a killed server left its lock behind", async ({ page: p }) => {
  b = bare();
  cards(b, ["Second card"]);
  const first = serve(b);
  expect(await first.url).toBeDefined();
  first.proc.kill("SIGKILL");
  await first.exited;
  expect(existsSync(join(b.dir, ".werk", "serve.lock"))).toBe(true);

  const started = Date.now();
  const again = serve(b);
  const url = await again.url;
  const took = Date.now() - started;
  expect(url, again.err()).toBeDefined();
  // The default wait for a live holder is 5 seconds; the start must not take it.
  expect(took).toBeLessThan(4000);

  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('[data-tile="c1"]')).toContainText("Second card");
});

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await project();
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) {
    await watchChannel(t);
    await t.goto(`${w.url}/map`);
    await expect(t.getByRole("heading", { level: 1 })).toHaveText("Root");
    await expect.poll(async () => (await channelLog(t)).opens).toBe(1);
    await mark(t);
  }
  w.werk("add", "second", "--title", "Second card", "--parent", "root");
  for (const t of tabs) {
    await expect(t.locator('[data-tile="second"]')).toContainText("Second card");
    expect(await marked(t)).toBe(true);
  }
  // Let any extra signal arrive before the count is read.
  await tabs[0]?.waitForTimeout(1000);
  for (const t of tabs) {
    const log = await channelLog(t);
    expect(log.changed).toHaveLength(1);
    expect(log.changed[0]?.trim()).toBe("");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
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
  });
  const bodies: string[] = [];
  p.on("response", (response) => {
    void response.text().then(
      (text) => bodies.push(text),
      () => undefined,
    );
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  const tile = p.locator('[data-tile="invoice"]');
  await expect(tile).toContainText("The invoice shows the seat count");
  await expect(p.locator("body")).not.toContainText("Each line names the seats billed");
  await p.waitForLoadState("networkidle");
  expect(bodies.join("")).not.toContain("Each line names the seats billed");

  await tile.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The invoice shows the seat count");
  await expect(p.locator('[data-field="body"]')).toContainText("Each line names the seats billed in the month");
  await expect(p.locator('[data-field="why"]')).toContainText("A customer checks the bill against the team size");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator('[data-section="refines"] [data-id="root"]')).toContainText("Root");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "retry", "--title", "Retry sends a new link", "--parent", "root");
  const log = join(w.dir, ".werk", "log.jsonl");

  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  w.werk("add", "later", "--title", "Later card", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "later" }) };
  const noToken = await send(w.url, "/api/accept", write);
  expect(noToken.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  const badHost = await send(w.url, "/api/accept", { ...write, token, host: "evil.example" });
  expect(badHost.status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);

  const read = await send(w.url, "/api/card/retry");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "retry", title: "Retry sends a new link" });
});
