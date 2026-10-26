import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";

const h1 = (p: Page, t: string) => p.getByRole("heading", { name: t, level: 1 });
const mark = (p: Page) => p.evaluate(() => { (window as any).kept = true; });
const marked = (p: Page) => p.evaluate(() => (window as any).kept === true);
const edit = (file: string, from: string, to: string) => {
  const t = readFileSync(file, "utf8");
  if (!t.includes(from)) throw new Error(`no ${from}`);
  writeFileSync(file, t.replace(from, to));
};

test("14.1 addresses, back/forward and not found", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await p.goBack();
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.goForward();
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await p.goto(`${w.url}/map/no-such-card-zzz`);
  await expect(p.locator("#view")).toContainText(/No card .* is in the map/);
  await expect(h1(p, "Ship the checkout")).toHaveCount(0);
  await expect(h1(p, "Retry a failed payment once")).toHaveCount(0);
});

test("14.2 card added from CLI appears, no reload, composer kept", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 write made while server down shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  const port = w.port;
  await w.stop();
  w.werk("add", "off", "--title", "Written offline", "--parent", "root");
  await w.restart();
  expect(w.port).toBe(port);
  await expect(p.locator("#view")).toContainText("Written offline");
});

test("14.4 dev: server edit reuses live server, channel stays", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  let text = "";
  const req = request(`${w.url}/api/events`, (res) => res.on("data", (c: Buffer) => (text += c)));
  req.on("error", () => undefined);
  req.end();
  await expect.poll(() => text).toContain("retry:");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited here\\n"');
  await expect.poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 15000 }).toBe("werk: edited here\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  req.destroy();
});

test("14.5 dev: client edit reloads page and keeps draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p, "Ship the checkout")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});
