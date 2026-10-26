import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";

const heading = (p: Page, t: string) => p.getByRole("heading", { name: t, level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as any).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as any).kept === true);
function edit(file: string, from: string, to: string) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
  writeFileSync(file, text.replace(from, to));
}

test("[14.3] a write made while the server was down shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--why", "w", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
});

function channel(url: string) {
  let text = "";
  const req = request(`${url}/api/events`, (res) => res.on("data", (c: Buffer) => (text += c.toString())));
  req.on("error", () => undefined);
  req.end();
  return { text: () => text, close: () => req.destroy() };
}

test("[14.4] in dev a server edit changes a response and the channel stays", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await mark(p);
  const live = channel(w.url);
  await expect.poll(() => live.text()).toContain("retry:");
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited response\\n"');
  await expect.poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 }).toBe("werk: edited response\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  w.werk("add", "after", "--title", "After edit", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  live.close();
});

test("[14.5] in dev a client edit that cannot apply reloads and keeps the draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});
