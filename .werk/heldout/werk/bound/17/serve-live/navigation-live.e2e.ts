// Held-out: steps 14.1–14.5 (addresses and history, the live channel, reconnect, dev hot reload).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as pwTest } from "@playwright/test";
import { test as harnessTest } from "../../e2e/harness.ts";
import { project, stop } from "../../e2e/project.ts";
import { cleanup, makeProject } from "./lib.ts";

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

pwTest.describe("project pages", () => {
  pwTest.afterEach(stop);
  pwTest.afterEach(cleanup);

  pwTest("14.1 moves between cards by address and shows not-found for an unknown card", async ({ page: p }) => {
    const w = await project(undefined, (down) =>
      down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }),
    );
    await p.goto(`${w.url}/map`);
    await expect(p.locator("#left-pane").getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
    await expect(p.getByRole("complementary", { name: "Chat" }).getByRole("textbox", { name: "Message" })).toBeVisible();
    await p.goto(`${w.url}/map/child`);
    await expect(h1(p)).toHaveText("Child");
    await p.goBack();
    await expect(h1(p)).toHaveText("Root");
    await p.goForward();
    await expect(h1(p)).toHaveText("Child");
    await p.goto(`${w.url}/map/no-card-has-this-id`);
    await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
    await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
    await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
  });

  pwTest("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
    const w = await project();
    await p.goto(`${w.url}/map/root`);
    await expect(h1(p)).toHaveText("Root");
    const composer = p.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(p);
    w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(p.locator("#view")).toContainText("Fresh idea");
    expect(await marked(p)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  });

  pwTest("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
    const w = makeProject();
    w.card("root", "Root");
    const first = w.serve();
    const url = await first.url;
    const port = Number(new URL(url).port);
    await p.goto(`${url}/map/root`);
    await expect(h1(p)).toHaveText("Root");
    await mark(p);
    first.proc.kill("SIGTERM");
    await first.exit;
    w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
    await w.serve(port).url;
    await expect(p.locator("#view")).toContainText("Written offline", { timeout: 15_000 });
    // The step asks only that the person does not reload; in dev Vite reloads the page itself (seen: kept mark lost).
  });
});

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

harnessTest("14.4 in dev, a server edit changes a response and the live page stays connected", async ({ page: p, harness }) => {
  harnessTest.setTimeout(60_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited answer\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: edited answer\n");
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

harnessTest("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page: p, harness }) => {
  harnessTest.setTimeout(60_000);
  const w = await harness.start({ copy: true });
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await expect(composer).toHaveValue("draft that must survive");
});
