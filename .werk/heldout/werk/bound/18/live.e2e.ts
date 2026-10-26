// Held-out steps 14.1 to 14.5: addresses, the live channel and dev reloads in a real browser.
/// <reference lib="dom" />
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as plain } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";

const heading = (p: Page, title: string) => p.getByRole("heading", { name: title, level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const composer = (p: Page) => p.getByRole("textbox", { name: "Message" });

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

const ROOT_LOG = `${JSON.stringify({ seq: 1, at: "2026-10-01T00:00:00.000Z", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } })}\n`;

plain.describe("project harness", () => {
  plain.afterEach(stop);

  plain("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
    const w = await project(undefined, (down) => {
      down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" });
    });
    await p.goto(`${w.url}/map`);
    await expect(p.locator("#left-pane").getByRole("heading", { name: "Root", level: 1 })).toBeVisible();
    await expect(p.locator("#chat-pane")).toBeVisible();
    await expect(p.locator("#chat-pane")).not.toContainText("Root");
    await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();

    await p.goto(`${w.url}/map/child`);
    await expect(heading(p, "Child")).toBeVisible();
    await p.goBack();
    await expect(heading(p, "Root")).toBeVisible();
    await p.goForward();
    await expect(heading(p, "Child")).toBeVisible();

    await p.goto(`${w.url}/map/no-card-has-this-id`);
    await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
    await expect(heading(p, "Root")).toHaveCount(0);
    await expect(heading(p, "Child")).toHaveCount(0);
    await expect(p.locator("#view")).not.toContainText("Root");
    await expect(p.locator("#view")).not.toContainText("Child");
  });

  plain("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
    const w = await project();
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Root")).toBeVisible();
    await composer(p).fill("half a thought");
    await mark(p);
    w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(p.locator("#view")).toContainText("Fresh idea");
    expect(await marked(p)).toBe(true);
    await expect(composer(p)).toHaveValue("half a thought");
  });
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p, harness }) => {
  const w = await harness.start();
  // Setup: the project's map holds one root card "Root".
  await w.stop();
  writeFileSync(join(w.dir, ".werk", "log.jsonl"), ROOT_LOG);
  await w.restart();

  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Root")).toBeVisible();
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited handler answer\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  const next = await fetch(`${w.url}/no/such/address`);
  expect(new URL(next.url).port).toBe(String(w.port));
  expect(await next.text()).toBe("werk: edited handler answer\n");

  w.werk("add", "after", "--title", "After edit", "--parent", "retry");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await composer(p).fill("draft that must survive");
  await mark(p);

  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.edited = "yes";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p, "Retry a failed payment once")).toBeVisible();
  await expect(composer(p)).toHaveValue("draft that must survive");
});
