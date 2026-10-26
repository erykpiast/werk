/// <reference lib="dom" />
// Held-out steps 14.3, 14.4, 14.5. The fixture project's root card plays "Root".
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness";

const h1 = (p: Page) => p.locator("#view").getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 15_000 });
  // The step forbids a reload by the person only; record whether the page loaded again by itself.
  test.info().annotations.push({ type: "page-kept", description: String(await marked(p)) });
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle");
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited handler\\n"');
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 15_000 })
    .toBe("werk: edited handler\n");
  expect(w.err()).toMatch(/reus\w* the live server/);
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));

  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
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
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
