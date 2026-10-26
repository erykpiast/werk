import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Page } from "@playwright/test";
import { open } from "../src/map/mark-fixtures.ts";
import {
  appendLog, chat, composerOf, expect, giveImage, leftPane, messages, say, send, test, withChat,
} from "./pw.ts";

const oneReply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const stored = (dir: string) =>
  existsSync(attachments(dir)) ? readdirSync(attachments(dir)).filter((n) => n !== ".gitignore") : [];

/** Collects the names that the server gives to uploads, in order. */
function uploadNames(page: Page): string[] {
  const names: string[] = [];
  page.on("response", async (res) => {
    if (res.request().method() === "POST" && /\/image$/.test(new URL(res.url()).pathname)) {
      const body = await res.json().catch(() => null);
      if (body?.name) names.push(body.name);
    }
  });
  return names;
}

test("24.1 pick a card from the hash menu", async ({ page, app }) => {
  appendLog(app, ...open("werk-shots", { parent: "root", title: "Pasted screenshots" }));
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const composer = composerOf(page);
  await composer.pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const option = menu.getByRole("option", { name: /werk-shots/ });
  await expect(option).toContainText("Pasted screenshots");
  // The menu opens below the caret.
  const m = await menu.boundingBox();
  const c = await composer.boundingBox();
  expect.soft((m?.y ?? 0) >= (c?.y ?? 0), "the menu opens below the caret").toBe(true);
  const options = await menu.getByRole("option").all();
  for (let i = 0; i < options.length; i++) {
    if ((await options[i]?.getAttribute("aria-selected")) === "true" && (await options[i]?.innerText())?.includes("werk-shots")) break;
    if ((await options[i]?.innerText())?.includes("werk-shots")) break;
    await composer.press("ArrowDown");
  }
  await composer.press("Enter");
  expect((await composer.inputValue()).trimEnd()).toBe("Look at #werk-shots");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await composer.fill("");
  await composer.pressSequentially("`#wer");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat(oneReply, async (server) => {
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.pressSequentially("What is wrong here? ");
    await giveImage(page, { type: "png" });
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open each image|Open each image/i);
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(status).not.toContain("attachments");
    expect(stored(server.dir).length).toBe(1);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(oneReply, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png", bytes: 25 * 1024 * 1024, how: "drop" });
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer.press("Enter");
    await page.waitForTimeout(1000);
    for (const text of messages(server)) {
      expect(text).not.toContain("attachments");
      expect(text).not.toContain("[Image #1] =");
    }
    expect(stored(server.dir)).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat(oneReply, async (server) => {
    const names = uploadNames(page);
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png", color: "#c33" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await giveImage(page, { type: "jpeg", color: "#33c" });
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page).locator("li")).toHaveCount(1);
    const img = chips(page).getByRole("img");
    await expect(img).toHaveAttribute("src", /\.jpe?g/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    const jpeg = names.find((n) => /\.jpe?g$/.test(n)) as string;
    expect(jpeg).toBeTruthy();
    expect(text).toContain(`[Image #1] = `);
    expect(text).toMatch(new RegExp(`\\[Image #1\\] = [^\\n]*${jpeg.replace(".", "\\.")}`));
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const api = `${server.origin}/api/projects/${basename(server.dir)}/image`;
    const empty = await page.request.get(`${api}?name=`);
    expect(empty.status()).toBe(404);
    const climb = await page.request.get(`${api}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(climb.status()).toBe(404);
    const climb2 = await page.request.get(`${api}?name=${encodeURIComponent("../../../../etc/passwd")}`);
    expect(climb2.status()).toBe(404);
    expect(await climb.text()).not.toContain("node.proposed");
    const composer = composerOf(page);
    await composer.fill("");
    await composer.pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  });
});
