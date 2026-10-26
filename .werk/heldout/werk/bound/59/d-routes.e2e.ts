// Held-out steps 14.1-14.5: card addresses, the live page, reconnect, and dev reloads.
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { Proj } from "./d-helpers.ts";

let proj: Proj | undefined;
test.afterEach(async () => {
  await proj?.close();
  proj = undefined;
});

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

test("14.1 a person moves between cards by address and sees a not-found page for an unknown card", async ({
  page: p,
}) => {
  proj = new Proj();
  proj.card("root", "Root");
  proj.card("child", "Child", { parent: "root" });
  const url = await proj.serve().url;
  await p.goto(`${url}/map`);
  await expect(p.locator("#view").getByRole("heading", { level: 1 })).toHaveText("Root");
  const chat = p.getByRole("complementary", { name: "Chat" });
  await expect(chat).toBeVisible();
  const viewBox = await p.locator("#view").boundingBox();
  const chatBox = await chat.boundingBox();
  expect(viewBox && chatBox && chatBox.x > viewBox.x).toBe(true);
  await p.goto(`${url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/no card .*is in the map|not found/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  proj = new Proj();
  proj.card("root", "Root");
  const url = await proj.serve().url;
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  proj.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  proj = new Proj();
  proj.card("root", "Root");
  const first = proj.serve();
  const url = await first.url;
  const port = Number(new URL(url).port);
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await mark(p);
  first.proc.kill("SIGTERM");
  await first.exit;
  proj.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await proj.serve(port).url;
  await expect(p.locator("#view")).toContainText("Written offline");
  // The step asks only that the person does not reload; the binder notes whether the document itself loaded again.
  test.info().annotations.push({ type: "same-document", description: String(await marked(p)) });
});

function channel(url: string): { text(): string; close(): void } {
  let text = "";
  const req = request(`${url}/api/events`, (res) => res.on("data", (chunk: Buffer) => (text += chunk.toString())));
  req.on("error", () => undefined);
  req.end();
  return { text: () => text, close: () => req.destroy() };
}

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const before = await fetch(`${w.url}/no/such/address`);
  expect(await before.text()).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  const live = channel(w.url);
  await expect.poll(() => live.text()).toContain("retry:");
  await mark(p);
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 })
    .toBe("werk: edited reply\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  live.close();
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
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
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
