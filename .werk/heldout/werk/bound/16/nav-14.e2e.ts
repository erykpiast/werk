// Held-out tests for steps 14.1 to 14.5: card addresses, live redraw, reconnect after a restart,
// and the dev reloads of the server and of the client.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness";
import { Proj } from "./serve-helpers.ts";

let proj: Proj | undefined;
test.afterEach(async () => {
  await proj?.close();
  proj = undefined;
});

function rootAndChild(): Proj {
  proj = new Proj();
  proj.seed("node.added", { id: "root", kind: "card", title: "Root" });
  proj.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" });
  return proj;
}

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

test("14.1 addresses, Back and Forward, and a not-found page", async ({ page: p }) => {
  const w = rootAndChild();
  const url = await w.serve(0).url;

  await p.goto(`${url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  const chat = p.getByRole("complementary", { name: "Chat" });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(chat).not.toContainText("Root");

  await p.goto(`${url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");

  await p.goto(`${url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/No card #no-card-has-this-id is in the map|not found/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a command-line add appears on the open page without a reload, and the draft stays", async ({
  page: p,
}) => {
  const w = new Proj();
  proj = w;
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  const url = await w.serve(0).url;
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);

  const add = w.werk("add", "fresh", "--title", "Fresh idea", "--why", "w", "--parent", "root");
  expect(add.code).toBe(0);
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  test.setTimeout(60_000);
  const w = new Proj();
  proj = w;
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  const first = w.serve(0);
  const url = await first.url;
  const port = Number(new URL(url).port);
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");

  first.proc.kill("SIGTERM");
  await first.exited;
  const add = w.werk("add", "offline", "--title", "Written offline", "--why", "w", "--parent", "root");
  expect(add.code).toBe(0);
  const again = w.serve(port);
  await again.url;
  await expect(p.locator("#view")).toContainText("Written offline", { timeout: 20_000 });
});

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  test.setTimeout(90_000);
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const before = await (await fetch(`${w.url}/no/such/address`)).text();
  expect(before).toBe("werk: no such address\n");
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toHaveText("Ship the checkout");
  await p.waitForLoadState("networkidle");
  await mark(p);

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: nothing lives here\\n"');
  await expect.poll(() => w.err(), { timeout: 20_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(w.err()).toContain(`port ${w.port}`);
  const after = await (await fetch(`${w.url}/no/such/address`)).text();
  expect(after).toBe("werk: nothing lives here\n");

  w.werk("add", "after", "--title", "After edit", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
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

  // The entry module accepts no hot update, so this edit cannot apply in place.
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
