/// <reference lib="dom" />
// Held-out steps 14.1-14.5: addresses, live redraw, reconnect, and dev reloads on an app copy.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { makeProject, serve, stopAll } from "./d-helpers.ts";

test.afterEach(stopAll);

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function rootProject() {
  const w = makeProject();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  return w;
}

test("14.1 a person moves between cards by address and sees a not-found page for an unknown card", async ({
  page: p,
}) => {
  const w = rootProject();
  w.seed("node.added", { id: "child", kind: "card", title: "Child", parent: "root" });
  const url = await serve(w).ready;

  await p.goto(`${url}/map`);
  await expect(p.locator("#view").getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();

  await p.goto(`${url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");

  await p.goto(`${url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/not found|No card/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

test("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = rootProject();
  const url = await serve(w).ready;
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);

  expect(w.werk("add", "fresh", "--title", "Fresh idea", "--why", "w", "--parent", "root").code).toBe(0);
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  const w = rootProject();
  const first = serve(w);
  const url = await first.ready;
  const port = Number(new URL(url).port);
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await mark(p);

  first.proc.kill("SIGTERM");
  await first.exited;
  expect(w.werk("add", "offline", "--title", "Written offline", "--why", "w", "--parent", "root").code).toBe(0);
  await serve(w, port).ready;

  await expect(p.locator("#view")).toContainText("Written offline");
  // The step forbids only a reload by the person; the test never reloads. (The page itself reloads: Vite.)
});

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/root`);
  await expect(h1(p)).toBeVisible();
  await mark(p);
  const before = await fetch(`${w.url}/no/such/address`);
  expect(await before.text()).toBe("werk: no such address\n");

  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  expect(w.err()).toContain(`port ${w.port}`);
  const after = await fetch(`${w.url}/no/such/address`);
  expect(await after.text()).toBe("werk: edited reply\n");

  w.werk("add", "after-edit", "--title", "After edit", "--why", "w", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page: p,
  harness,
}) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toBeVisible();
  const title = await h1(p).textContent();
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);

  edit(
    join(w.app, "web", "main.tsx"),
    'mount("chat-pane")',
    'document.body.dataset.heldout = "1";\nmount("chat-pane")',
  );
  await expect(p.locator("body")).toHaveAttribute("data-heldout", "1", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText(title ?? "");
  await expect(composer).toHaveValue("draft that must survive");
});
