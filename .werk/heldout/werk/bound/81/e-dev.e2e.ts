/// <reference lib="dom" />
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test as base } from "@playwright/test";
import { Harness } from "../e2e/harness.ts";

const test = base.extend<{ harness: Harness }>({
  // biome-ignore lint/correctness/noEmptyPattern: fixture
  harness: async ({}, use) => {
    const h = new Harness();
    await use(h);
    await h.close();
  },
});
const heading = (p: Page, t: string) => p.getByRole("heading", { name: t, level: 1 });
const mark = (p: Page) => p.evaluate(() => { (window as unknown as { kept: boolean }).kept = true; });
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
function edit(file: string, from: string, to: string) {
  const t = readFileSync(file, "utf8");
  if (!t.includes(from)) throw new Error(`no ${from}`);
  writeFileSync(file, t.replace(from, to));
}

test("14.4 dev server edit reuses live server, channel stays", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  const pid = w.pid();
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  await mark(p);
  expect(await (await fetch(`${w.url}/no/such/route`)).text()).toBe("werk: no such address\n");
  edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited reply\\n"');
  await expect.poll(async () => (await fetch(`${w.url}/no/such/route`)).text(), { timeout: 20000 }).toBe("werk: edited reply\n");
  expect(w.err()).toContain("reusing the live server");
  expect(w.pid()).toBe(pid);
  w.werk("add", "after", "--title", "After edit", "--parent", "root");
  await expect(p.locator("#view")).toContainText("After edit");
  expect(await marked(p)).toBe(true);
});

test("14.5 client edit that cannot apply reloads page and keeps draft", async ({ page: p, harness }) => {
  const w = await harness.start({ copy: true, hot: true });
  await p.goto(`${w.url}/map/root`);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const c = p.getByRole("textbox", { name: "Message" });
  await c.fill("draft that must survive");
  await mark(p);
  edit(join(w.app, "web", "main.tsx"), 'mount("chat-pane")', 'document.body.dataset.edited = "yes";\nmount("chat-pane")');
  await expect(p.locator("body")).toHaveAttribute("data-edited", "yes", { timeout: 20000 });
  expect(await marked(p)).toBe(false);
  await expect(heading(p, "Ship the checkout")).toBeVisible();
  await expect(c).toHaveValue("draft that must survive");
});
