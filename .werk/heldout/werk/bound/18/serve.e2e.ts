// Held-out steps 13.3, 13.4 and 13.5: the page of werk serve in a real browser.
/// <reference lib="dom" />
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

/** Records each changed signal that the page's live channel receives, with its data. */
const RECORD = () => {
  const signals: string[] = [];
  (window as unknown as { signals: string[] }).signals = signals;
  const Original = window.EventSource;
  class Recording extends Original {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      this.addEventListener("changed", (event) => signals.push((event as MessageEvent).data));
    }
  }
  window.EventSource = Recording;
};
const signals = (p: Page) => p.evaluate(() => (window as unknown as { signals: string[] }).signals);

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
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test("13.3 a page stays in step when a card is added on the command line", async ({ context }) => {
  const w = await project();
  await context.addInitScript(RECORD);
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(`${w.url}/map`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Root");
    await tab.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
  }
  w.werk("add", "second", "--title", "The second card arrives", "--parent", "root");
  for (const tab of tabs) {
    await expect(tab.locator("#view")).toContainText("The second card arrives");
    await expect(tab.locator("#view")).toContainText("Root");
    expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
  }
  for (const tab of tabs) {
    const got = await signals(tab);
    expect(got).toHaveLength(1);
    expect(got[0] ?? "").not.toContain("The second card arrives");
    expect(got[0] ?? "").not.toContain("second");
  }
});

test("13.4 a card added while the server was down shows on the first page load", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.werk(
      "add",
      "late",
      "--title",
      "Late card from the command line",
      "--why",
      "The why of the late card",
      "--body",
      "The body text of the late card",
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
  await expect(p.locator("#view")).toContainText("Late card from the command line");
  await expect(p.locator("body")).not.toContainText("The body text of the late card");
  expect(bodies.join("\n")).not.toContain("The body text of the late card");

  await p.locator("#view").getByText("Late card from the command line").first().click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Late card from the command line");
  await expect(p.locator("#view")).toContainText("The body text of the late card");
  await expect(p.locator("#view")).toContainText("The why of the late card");
  await expect(p.locator('[data-tag="status"]')).toHaveText("open");
  await expect(p.locator("#view")).toContainText("Root");
});

test("13.5 only the person's own page can write to the map", async ({ page: p }) => {
  const w = await project();
  const log = join(w.dir, ".werk", "log.jsonl");
  w.werk("add", "pending", "--title", "Pending proposal", "--parent", "root");
  await p.goto(`${w.url}/map/pending`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  expect(readFileSync(log, "utf8")).toContain('"change.accepted"');

  w.werk("add", "other", "--title", "Other proposal", "--parent", "root");
  const before = readFileSync(log, "utf8");
  const write = { method: "POST", body: JSON.stringify({ id: "other" }) };
  expect((await send(w.url, "/api/accept", write)).status).toBeGreaterThanOrEqual(400);
  expect(readFileSync(log, "utf8")).toBe(before);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  expect(token).not.toBe("");
  expect((await send(w.url, "/api/accept", { ...write, token, host: "attacker.example" })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(readFileSync(log, "utf8")).toBe(before);

  const read = await send(w.url, "/api/card/root", {});
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "root", title: "Root" });
});
