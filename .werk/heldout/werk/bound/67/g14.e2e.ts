// Held-out steps 14.1-14.5: addresses, live updates, reconnects, and dev-mode reloads.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as plain } from "@playwright/test";
import { test as harnessed } from "../e2e/harness.ts";
import { makeProject } from "./srv.ts";

let cleanup: (() => Promise<void>) | undefined;
plain.afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function project() {
  const p = makeProject();
  cleanup = p.cleanup;
  p.card("root", { title: "Root" });
  return p;
}

const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

plain("14.1 a person moves between cards by address and sees a not-found page", async ({ page: p }) => {
  const w = project();
  w.card("child", { title: "Child", parent: "root" });
  const url = await w.serve().url;
  await p.goto(`${url}/map`);
  await expect(p.locator("#left-pane").getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await expect(p.locator("#chat-pane")).not.toContainText("Root");
  await p.goto(`${url}/map/child`);
  await expect(h1(p)).toHaveText("Child");
  await p.goBack();
  await expect(h1(p)).toHaveText("Root");
  await p.goForward();
  await expect(h1(p)).toHaveText("Child");
  await p.goto(`${url}/map/no-card-has-this-id`);
  await expect(p.locator("#view")).toContainText(/not found|does not hold|no card/i);
  await expect(p.getByRole("heading", { name: "Root", exact: true })).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Child", exact: true })).toHaveCount(0);
});

plain("14.2 a card added from the command line appears on the open page without a reload", async ({ page: p }) => {
  const w = project();
  const url = await w.serve().url;
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await mark(p);
  w.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await expect(p.locator("#view")).toContainText("Fresh idea");
  expect(await marked(p)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

plain("14.3 a write made while the server was down shows after the page reconnects", async ({ page: p }) => {
  const w = project();
  const first = w.serve();
  const url = await first.url;
  const port = Number(new URL(url).port);
  await p.goto(`${url}/map/root`);
  await expect(h1(p)).toHaveText("Root");
  await mark(p);
  first.proc.kill("SIGTERM");
  await first.exited;
  w.werk("add", "offline", "--title", "Written offline", "--parent", "root");
  await w.serve(port).url;
  await expect(p.locator("#view")).toContainText("Written offline");
  // The person never reloads; whether the page reloaded itself is recorded, not required.
  console.log(`14.3 page kept its document: ${await marked(p)}`);
});

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

harnessed(
  "14.4 in dev, a server edit changes a response and the live page stays connected",
  async ({ page: p, harness }) => {
    const w = await harness.start({ copy: true, hot: true });
    const pid = w.pid();
    await p.goto(`${w.url}/map/retry`);
    await expect(h1(p)).toHaveText("Retry a failed payment once");
    await mark(p);
    const before = await fetch(`${w.url}/no/such/address`);
    expect(await before.text()).toBe("werk: no such address\n");
    edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited answer\\n"');
    await expect.poll(() => w.err(), { timeout: 15_000 }).toContain("reusing the live server");
    expect(w.pid()).toBe(pid);
    const after = await fetch(`${w.url}/no/such/address`);
    expect(new URL(w.url).port).toBe(String(w.port));
    expect(await after.text()).toBe("werk: edited answer\n");
    w.werk("add", "after-edit", "--title", "After edit", "--parent", "retry");
    await expect(p.locator("#view")).toContainText("After edit");
    expect(await marked(p)).toBe(true);
  },
);

harnessed(
  "14.5 in dev, a client edit that cannot apply in place reloads the page and keeps the draft",
  async ({ page: p, harness }) => {
    const w = await harness.start({ copy: true, hot: true });
    await p.goto(`${w.url}/map/retry`);
    await expect(h1(p)).toHaveText("Retry a failed payment once");
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
  },
);
