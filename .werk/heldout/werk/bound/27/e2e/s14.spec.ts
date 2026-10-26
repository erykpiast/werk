import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { composer, left, ROOT_EVENTS, serve } from "./helpers.ts";

const markLoaded = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: import("@playwright/test").Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  await serve({ log: ROOT_EVENTS }, async (server) => {
    await page.goto(server.url);
    await expect(left(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    const r = server.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code, r.stderr).toBe(0);
    await expect(left(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  });
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  await serve({ log: ROOT_EVENTS, appCopy: true }, async (server) => {
    await page.goto(`${server.url}/map/root`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await markLoaded(page);
    const route = `${server.origin}/api/projects/project/commands`;
    const before = await (await fetch(route)).json();
    expect(before.edited).toBeUndefined();
    const file = join(server.appDir, "src", "serve", "routes.ts");
    const text = readFileSync(file, "utf8");
    const needle = "return json({ commands: context.chat?.commands() ?? [] });";
    expect(text).toContain(needle);
    writeFileSync(file, text.replace(needle, "return json({ commands: [], edited: true });"));
    await expect.poll(() => server.output(), { timeout: 30000 }).toContain("reusing the live server");
    await expect.poll(async () => (await (await fetch(route)).json()).edited, { timeout: 30000 }).toBe(true);
    // the same server still answers on the same port
    expect((await fetch(`${server.origin}/api/projects`)).ok).toBe(true);
    expect(server.output()).not.toMatch(/exited/);
    const r = server.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(r.code, r.stderr).toBe(0);
    await expect(left(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await stillLoaded(page)).toBe(true);
  });
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  await serve({ log: ROOT_EVENTS, appCopy: true }, async (server) => {
    await page.goto(`${server.url}/map/root`);
    const title = left(page).getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Root");
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
    await expect(title).toHaveText("Root");
    await expect(composer(page)).toHaveValue("draft that must survive");
  });
});
