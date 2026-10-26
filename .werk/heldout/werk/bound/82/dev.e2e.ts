import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Harness } from "../e2e/harness.ts";

const heading = (p: Page, title: string) => p.getByRole("heading", { name: title, level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
function edit(file: string, from: string, to: string) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
  writeFileSync(file, text.replace(from, to));
}
function channel(url: string) {
  let text = "";
  const req = request(`${url}/api/events`, (res) => res.on("data", (c: Buffer) => (text += c.toString())));
  req.on("error", () => undefined);
  req.end();
  return { text: () => text, close: () => req.destroy() };
}

test("[14.4] in dev, a server edit changes a response and the live page stays connected", async ({ page: p }) => {
  const h = new Harness();
  try {
    const w = await h.start({ copy: true, hot: true });
    const pid = w.pid();
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Ship the checkout")).toBeVisible();
    await mark(p);
    const live = channel(w.url);
    await expect.poll(() => live.text()).toContain("retry:");
    edit(join(w.app, "src", "serve", "server.ts"), '"werk: no such address\\n"', '"werk: edited here\\n"');
    await expect
      .poll(async () => (await fetch(`${w.url}/no/such/address`)).text(), { timeout: 20000 })
      .toBe("werk: edited here\n");
    expect(w.err()).toMatch(/reus(es|ing) the live server/);
    expect(w.pid()).toBe(pid);
    w.werk("add", "afteredit", "--title", "After edit", "--parent", "root");
    await expect(p.locator("#view")).toContainText("After edit");
    expect(await marked(p)).toBe(true);
    live.close();
  } finally {
    await h.close();
  }
});

test("[14.5] in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page: p }) => {
  const h = new Harness();
  try {
    const w = await h.start({ copy: true });
    await p.goto(`${w.url}/map/root`);
    await expect(heading(p, "Ship the checkout")).toBeVisible();
    await p.waitForLoadState("networkidle");
    const box = p.getByRole("textbox", { name: "Message" });
    await box.fill("draft that must survive");
    await mark(p);
    edit(join(w.app, "web", "main.tsx"), "async function readHome()", 'document.body.dataset.heldout = "yes";\nasync function readHome()');
    await expect(p.locator("body")).toHaveAttribute("data-heldout", "yes", { timeout: 20000 });
    expect(await marked(p)).toBe(false);
    await expect(heading(p, "Ship the checkout")).toBeVisible();
    await expect(box).toHaveValue("draft that must survive");
  } finally {
    await h.close();
  }
});
