import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";
import { type Bare, bare, channelLog, mark, marked, serve, watchChannel } from "./web-a-util.ts";

let b: Bare | undefined;
test.afterEach(() => {
  b?.cleanup();
  b = undefined;
  stop();
});

const h1 = (p: Page, title: string) => p.getByRole("heading", { name: title, level: 1, exact: true });

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.1 a person moves between cards by address and sees a not-found page for an unknown card", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) =>
    down.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  const chat = p.getByRole("complementary", { name: "Chat" });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();
  const leftBox = await p.locator("#left-pane").boundingBox();
  const chatBox = await chat.boundingBox();
  expect(chatBox && leftBox && chatBox.x >= leftBox.x + leftBox.width - 1).toBe(true);

  await p.goto(`${w.url}/map/child`);
  await expect(h1(p, "Child")).toBeVisible();
  await p.goBack();
  await expect(h1(p, "Root")).toBeVisible();
  await p.goForward();
  await expect(h1(p, "Child")).toBeVisible();

  await p.goto(`${w.url}/map/no-such-card`);
  await expect(p.locator("[data-missing]")).toBeVisible();
  await expect(p.locator("#view")).toContainText(/not found|no card|does not hold|no such/i);
  await expect(h1(p, "Root")).toHaveCount(0);
  await expect(h1(p, "Child")).toHaveCount(0);
  await expect(p.locator("#view")).not.toContainText("Root");
  await expect(p.locator("#view")).not.toContainText("Child");
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p, "Root")).toBeVisible();
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
  test.setTimeout(60_000);
  b = bare();
  b.seed("node.added", { id: "root", kind: "card", title: "Root" });
  const first = serve(b);
  const url = (await first.url) as string;
  expect(url).toBeDefined();
  const port = Number(new URL(url).port);
  await p.goto(`${url}/map/root`);
  await expect(h1(p, "Root")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);

  first.proc.kill("SIGTERM");
  await first.exited;
  b.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  const again = serve(b, port);
  expect(await again.url, again.err()).toBeDefined();

  // The person does not reload; in dev mode Vite may load the page again by itself once the server is back.
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 20_000 });
  console.log(`14.3 same document kept: ${await marked(p)}`);
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  expect(await (await fetch(`${w.url}/no/such/address`)).text()).toBe("werk: no such address\n");
  await watchChannel(p);
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await expect.poll(async () => (await channelLog(p)).opens).toBe(1);
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: nothing lives here\\n"');
  await expect
    .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20_000 })
    .toBe("werk: nothing lives here\n");
  expect(w.err()).toMatch(/reus\w* the live server/);
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));

  w.werk("add", "after", "--title", "After edit", "--parent", "retry");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
  expect((await channelLog(p)).opens).toBe(1);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);

  // The entry module accepts no update, so this edit cannot apply in place.
  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.edited = "yes";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p, "Retry a failed payment once")).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});
