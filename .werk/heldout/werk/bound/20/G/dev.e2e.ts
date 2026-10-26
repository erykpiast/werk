/// <reference lib="dom" />
// Held-out steps 14.4 and 14.5: dev mode on a copy of the app, a server edit and a client edit.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../../e2e/harness.ts";

test.setTimeout(90_000);
const h1 = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} does not hold ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

test("14.4 in dev, a server edit changes a response and the live page stays connected", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  const before = await fetch(`${w.url}/api/graph`);
  expect(before.status).toBe(400);
  expect(await before.text()).toContain("the map is read as its shape");
  await p.goto(`${w.url}/map/retry`);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  await mark(p);

  edit(
    join(w.app, "src", "serve", "server.ts"),
    '"the map is read as its shape: ?shape=1"',
    '"the edited graph route answers this"',
  );
  await expect
    .poll(() => w.err(), { timeout: 15_000 })
    .toContain("reusing the live server");
  const after = await fetch(`${w.url}/api/graph`);
  expect(await after.text()).toContain("the edited graph route answers this");
  expect(w.pid()).toBe(pid);
  expect(new URL(w.url).port).toBe(String(w.port));

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
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await p.waitForLoadState("networkidle");
  const composer = p.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 15_000 });
  expect(await marked(p)).toBe(false);
  await expect(h1(p)).toHaveText("Retry a failed payment once");
  await expect(composer).toHaveValue("draft that must survive");
});
