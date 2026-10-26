import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  chatScript,
  chips,
  composer,
  drop,
  gitStatus,
  messages,
  paste,
  slowUploads,
  withServer,
} from "./img-helpers.ts";

const addCards = (server: { werk: (...a: string[]) => { code: number; stderr: string } }) => {
  for (const args of [
    ["add", "werk-shots", "--title", "Pasted screenshots", "--why", "w", "--parent", "root"],
    ["add", "tower", "--title", "Power cards", "--why", "w", "--parent", "root"],
  ]) {
    const r = server.werk(...args);
    if (r.code !== 0) throw new Error(r.stderr);
    const a = server.werk("accept", args[1] as string, "--actor", "you");
    if (a.code !== 0) throw new Error(a.stderr);
  }
};

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    const box = composer(page);
    await box.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const options = menu.getByRole("option");
    await expect(options.first()).toContainText("#werk-shots");
    await expect(options.first()).toContainText("Pasted screenshots");
    // the menu sits below the caret line of the composer's text? record the geometry
    const m = await menu.boundingBox();
    const b = await box.boundingBox();
    expect.soft(m && b && m.y >= b.y + b.height / 2, `menu y=${m?.y} composer y=${b?.y} h=${b?.height}`).toBe(true);
    await box.press("ArrowDown");
    await box.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(box).toHaveValue("Look at #werk-shots ");
    await expect(menu).toHaveCount(0);
    await box.fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }, addCards);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 800);
    await composer(page).pressSequentially("What is wrong here? ");
    await paste(page, { type: "image/png" });
    await expect(composer(page)).toHaveValue(/What is wrong here\? \[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    const img = chips(page).first().locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect.poll(() => messages(server).length).toBe(1);
    const text = messages(server)[0] as string;
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(text).toMatch(/Open each image above with Read/);
    expect(gitStatus(server)).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    // Text is typed first: with only a token left, nothing would be sent at all.
    await composer(page).pressSequentially("What is this? ");
    await drop(page, { type: "image/png", bytes: 25 * 1024 * 1024 });
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first().locator("[data-slot=image-reason]")).toContainText(/20 MB/);
    await composer(page).press("Enter");
    await expect.poll(() => messages(server).length).toBe(1);
    const text = messages(server)[0] as string;
    expect(text).not.toContain("attachments");
    expect(text).not.toContain("[Image #");
    const dir = join(server.dir, ".werk", "attachments");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitignore") : [];
    expect(files).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await paste(page, { type: "image/png", color: "red" });
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, { type: "image/jpeg", color: "blue" });
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(composer(page)).toHaveValue("[Image #1]");
    const src = await chips(page).first().locator("img").getAttribute("src");
    expect(src).toMatch(/\.jpg$/);
    await composer(page).pressSequentially(" jpeg please");
    await composer(page).press("Enter");
    await expect.poll(() => messages(server).length).toBe(1);
    expect(messages(server)[0]).toMatch(/\[Image #1\] = \S*\.jpg/);
    expect(messages(server)[0]).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withServer(chatScript(2), async (server) => {
    await page.goto(server.url);
    const base = server.url.replace("/p/", "/api/projects/") + "/image";
    const empty = await page.request.get(`${base}?name=`);
    expect(empty.status()).toBe(404);
    const noParam = await page.request.get(base);
    expect(noParam.status()).toBe(404);
    for (const name of ["../../package.json", "..%2F..%2Fpackage.json", "/etc/passwd"]) {
      const res = await page.request.get(`${base}?name=${name}`);
      expect(res.status()).toBe(404);
      expect(await res.text()).not.toContain("\"name\"");
    }
    // The agent names its commands after its first turn; then the slash menu opens.
    await composer(page).fill("hi");
    await composer(page).press("Enter");
    await expect(page.getByText("Answer 1")).toBeVisible();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
  });
});
