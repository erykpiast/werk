import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { served } from "./server.ts";

const mark = (page: Page) => page.evaluate(() => { (window as any).__loaded = true; });
const stillLoaded = (page: Page) =>
  page.evaluate(() => (window as any).__loaded === true).catch(() => false);
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  const s = await served();
  try {
    await page.goto(s.url);
    await expect(mapPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
    await composerOf(page).fill("half a thought");
    await mark(page);
    const added = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(mapPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composerOf(page)).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

const listener = (port: number) =>
  spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({ page }) => {
  const s = await served({ appCopy: true });
  try {
    await page.goto(s.url);
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const pidBefore = listener(s.port);
    expect(pidBefore).not.toBe("");
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    writeFileSync(
      routes,
      readFileSync(routes, "utf8").replace(
        "return json({ projects: entries(ctx.projects) });",
        'return json({ projects: entries(ctx.projects), edited: "yes" });',
      ),
    );
    await expect.poll(() => s.output(), { timeout: 20000 }).toMatch(/reusing the live server/);
    await expect
      .poll(async () => (await (await fetch(`${s.origin}/api/projects`)).json()).edited, { timeout: 20000 })
      .toBe("yes");
    expect(listener(s.port)).toBe(pidBefore);
    const added = s.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(mapPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  const s = await served({ appCopy: true });
  try {
    await page.goto(s.url);
    const title = mapPane(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const before = await title.innerText();
    await composerOf(page).fill("draft that must survive");
    await mark(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toHaveText(before);
    await expect(composerOf(page)).toHaveValue("draft that must survive");
  } finally {
    await s.dispose();
  }
});
