import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { devServer, until } from "./browser.ts";

const mark = (page: Page) => page.evaluate(() => { (window as unknown as { loaded: boolean }).loaded = true; });
const still = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true).catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("14.1 a card added from the command line appears with no reload", async ({ page }) => {
  const s = await devServer();
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await mark(page);
    const added = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
    expect(await still(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

test("14.2 a server edit changes a response and the live page stays connected", async ({ page }) => {
  const s = await devServer({ appCopy: true });
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const before = s.listeningPid();
    expect(before).not.toBe("");
    const route = `${s.origin}/api/projects/project/graph`;
    expect((await fetch(route)).status).toBe(400);
    const file = join(s.appDir, "src", "serve", "routes.ts");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("the graph is read with shape=1");
    writeFileSync(file, text.replace("the graph is read with shape=1", "the graph answer was edited"));
    await until(() => s.output().includes("reusing the live server"), "the reuse line", 30000);
    expect(s.output()).toMatch(/hot reload: reusing the live server on port \d+/);
    expect(s.output()).toContain(`port ${s.port}`);
    expect(s.listeningPid()).toBe(before);
    await until(async () => (await (await fetch(route)).text()).includes("the graph answer was edited"), "edited response", 20000);
    const added = s.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(added.code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await still(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  const s = await devServer({ appCopy: true });
  try {
    await page.goto(s.url);
    const title = await leftPane(page).getByRole("heading", { level: 1 }).innerText();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await mark(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited by the held-out test\n`);
    await until(async () => !(await still(page)), "the page to reload", 30000);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("draft that must survive");
  } finally {
    await s.dispose();
  }
});
