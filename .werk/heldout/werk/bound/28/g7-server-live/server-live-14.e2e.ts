/// <reference lib="dom" />
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test, type Werk } from "../../e2e/harness";

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function rootChildLog(w: Werk): void {
  const ev = (seq: number, payload: object) =>
    JSON.stringify({ seq, at: "2026-10-01T00:00:00.000Z", actor: "you", type: "node.added", payload });
  writeFileSync(
    join(w.dir, ".werk", "log.jsonl"),
    `${ev(1, { id: "root", kind: "card", title: "Root" })}\n${ev(2, { id: "child", kind: "card", title: "Child", parent: "root" })}\n`,
  );
}

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.1 moves between cards by address and an unknown card shows not found", async ({ page: p, harness }) => {
  const w = await harness.start();
  rootChildLog(w);
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view").getByRole("heading", { level: 1 })).toHaveText("Root");
  // Left pane is the view; the right pane is the chat.
  const view = await p.locator("#view").boundingBox();
  const chat = p.getByRole("complementary", { name: "Chat" });
  await expect(chat).toBeVisible();
  const chatBox = await chat.boundingBox();
  expect(view && chatBox && chatBox.x >= view.x + view.width - 1).toBeTruthy();

  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");

  await p.goto(`${w.url}/map/no-such-card-xyz`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(p.getByText("Root", { exact: true })).toHaveCount(0);
  await expect(p.getByText("Child", { exact: true })).toHaveCount(0);
});

test("14.2 a CLI add appears on the open page without a reload and keeps the draft", async ({ page: p, harness }) => {
  const w = await harness.start();
  rootChildLog(w);
  await w.restart();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle").catch(() => undefined);
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--why", "A reason", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  rootChildLog(w);
  await w.restart();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--why", "A reason", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 15_000 });
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect((await (await fetch(`${w.url}/no/such/address`)).text()).length).toBeGreaterThan(0);
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited answer\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  const res = await fetch(`${w.url}/no/such/address`);
  expect(await res.text()).toBe("werk: edited answer\n");
  expect(new URL(w.url).port).toBe(String(w.port));

  w.werk("add", "after", "--title", "After edit", "--why", "A reason", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle").catch(() => undefined);
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);

  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.edited = "yes";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p)).toHaveText("Ship the checkout");
  await expect(composer).toHaveValue("draft that must survive");
});
