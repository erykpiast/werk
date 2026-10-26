/// <reference lib="dom" />
// Held-out: 14.1-14.5 (addresses, live redraw, reconnect, dev-mode server and client edits).
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness";
import { project, stop } from "../e2e/project.ts";

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
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

base.describe("project-based", () => {
  base.afterEach(stop);

  base("14.1 moves between cards by address, not-found page for unknown card", async ({ page: p }) => {
    const w = await project(undefined, (d) =>
      d.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }),
    );
    await p.goto(`${w.url}/map`);
    await expect(p.locator("#view").getByRole("heading", { level: 1 })).toHaveText("Root");
    await expect(p.locator("#chat-pane")).toBeVisible();
    const view = await p.locator("#view").boundingBox();
    const chat = await p.locator("#chat-pane").boundingBox();
    expect((chat?.x ?? 0) >= (view?.x ?? 0) + (view?.width ?? 0) - 1).toBe(true);
    await p.goto(`${w.url}/map/child`);
    await expect(heading(p)).toHaveText("Child");
    await p.goBack();
    await expect(heading(p)).toHaveText("Root");
    await p.goForward();
    await expect(heading(p)).toHaveText("Child");
    await p.goto(`${w.url}/map/no-card-has-this`);
    await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
    await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
    await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
  });

  base("14.2 a CLI add appears on the open page without reload and keeps the draft", async ({ page: p }) => {
    const w = await project();
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p)).toHaveText("Root");
    const composer = p.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(p);
    w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(p.locator("#view")).toContainText("Fresh idea");
    expect(await marked(p)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });
});

test("14.3 a write made while the server was down shows after reconnect", async ({ page: p, harness }) => {
  const w = await harness.start();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Ship the checkout");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
  // "without the person reloading it": the step does not forbid the page reloading by itself.
});

function channel(url: string): { text(): string; close(): void } {
  let text = "";
  const req = request(`${url}/api/events`, (res) => res.on("data", (c: Buffer) => (text += c.toString())));
  req.on("error", () => undefined);
  req.end();
  return { text: () => text, close: () => req.destroy() };
}

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const port = w.port;
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p)).toHaveText("Retry a failed payment once");
  await mark(p);
  const live = channel(w.url);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(port));
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: edited reply\n");
  w.werk("add", "after", "--title", "After edit", "--parent", "retry");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  live.close();
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p)).toHaveText("Retry a failed payment once");
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
  await expect(heading(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
