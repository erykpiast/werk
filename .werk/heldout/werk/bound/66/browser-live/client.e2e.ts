// Held-out: steps 14.1–14.5.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../../e2e/harness.ts";
import { closeAll, live } from "./live.ts";

test.afterEach(closeAll);

const heading = (p: Page) => p.locator("#left-pane").getByRole("heading", { level: 1 });
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

test("14.1 a person moves between cards by address and sees a not-found page for an unknown card", async ({
  page: p,
}) => {
  const w = await live("Root", (d) =>
    d.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator("#chat-pane")).toBeVisible();
  await expect(p.locator("#chat-pane").getByRole("textbox", { name: "Message" })).toBeVisible();

  await p.goto(`${w.url}/map/child`);
  await expect(heading(p)).toHaveText("Child");
  await p.goBack();
  await expect(heading(p)).toHaveText("Root");
  await p.goForward();
  await expect(heading(p)).toHaveText("Child");

  await p.goto(`${w.url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/not found|no card|does not hold|not in the map/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = await live();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  const w = await live();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p)).toHaveText("Root");
  await mark(p);
  await w.stop();
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.restart();
  await expect(p.locator("#view")).toContainText("Written offline");
  // The step only rules out a reload by the person; the page reloading itself is allowed.
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/retry`);
  await expect(heading(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: nothing lives here\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toMatch(/reus/i);
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: nothing lives here\n");

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
  await expect(heading(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  await p.getByRole("textbox", { name: "Message" }).fill("draft that must survive");
  await mark(p);

  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.edited = "yes";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p)).toHaveText("Retry a failed payment once");
  await expect(p.getByRole("textbox", { name: "Message" })).toHaveValue("draft that must survive");
});
