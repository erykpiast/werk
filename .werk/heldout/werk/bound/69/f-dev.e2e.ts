/// <reference lib="dom" />
// Held-out: 14.4, 14.5 — dev mode on a copy of the app.
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
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

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({ page: p, harness }) => {
  test.setTimeout(60_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const port = w.port;
  // Count the drops of the page's live channel.
  await p.addInitScript(() => {
    const W = window as unknown as { drops: number; EventSource: typeof EventSource };
    W.drops = 0;
    const Real = W.EventSource;
    W.EventSource = class extends Real {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("error", () => W.drops++);
      }
    } as typeof EventSource;
  });
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 15_000 })
    .toBe("werk: edited reply\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(port));

  w.werk("add", "after", "--title", "After edit", "--why", "x", "--parent", "retry");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  expect(await p.evaluate(() => (window as unknown as { drops: number }).drops)).toBe(0);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(60_000);
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(p.getByRole("textbox", { name: "Message" })).toHaveValue("draft that must survive");
});
