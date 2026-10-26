import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  chat,
  chips,
  composerOf,
  dropImage,
  messages,
  pasteImage,
  say,
  send,
  slowUploads,
  withChat,
} from "./chat-support.ts";

const ok = (text = "Seen") => ({
  roles: { chat: { replies: [[say("m1", text)], [say("m2", "Again")]] } },
});
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const stored = (dir: string) =>
  existsSync(attachments(dir))
    ? readdirSync(attachments(dir)).filter((n) => !n.startsWith("."))
    : [];

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withChat(ok(), async (server) => {
    expect(server.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
    expect(server.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    await page.goto(server.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const composer = composerOf(page);
    await composer.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const option = menu.getByRole("option").filter({ hasText: "werk-shots" });
    await expect(option).toContainText("Pasted screenshots");
    await composer.press("ArrowDown");
    await composer.press("ArrowUp");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await composer.press("Enter");
    await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await composer.fill("");
    await composer.pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 1200);
    const composer = composerOf(page);
    await composer.pressSequentially("What is wrong here? ");
    await pasteImage(page, "png");
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    const git = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" });
    expect(git.stdout).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(ok("Ok"), async (server) => {
    await page.goto(server.url);
    await dropImage(page, "png", 25 * 1024 * 1024);
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText(/20 MB/);
    await composerOf(page).pressSequentially(" hello");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\[Image #1\] = /);
    expect(text).not.toContain(".werk/attachments");
    expect(stored(server.dir)).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await pasteImage(page, "jpeg");
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page).getByRole("img")).toHaveAttribute("src", /\.jpg/);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.jpg/);
    expect(messages(server)[0]).not.toContain("Image #2");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = {
    event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] },
  };
  await withChat(
    { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(chat(page).getByText("Hello")).toBeVisible();
      const base = `${server.origin}/api/projects/project/image`;
      expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
      const climb = await page.request.get(`${base}?name=${encodeURIComponent("../../.werk/log.jsonl")}`);
      expect(climb.status()).toBe(404);
      expect(await climb.text()).not.toContain("node.accepted");
      await composerOf(page).fill("");
      await composerOf(page).pressSequentially("/");
      await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
    },
  );
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 1200);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("img")).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // The sent message shows the image under its token.
    await expect(chat(page).locator("article [data-role=user] img")).toHaveCount(1, { timeout: 3000 });
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain("iVBOR");
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png", 2 * 1024 * 1024);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await pasteImage(page, "png", 25 * 1024 * 1024);
    const items = chips(page).getByRole("listitem");
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composerOf(page)).not.toHaveValue(/Image #2/);
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("Image #2");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await pasteImage(page, "png");
    await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    const second = await chips(page).getByRole("img").nth(1).getAttribute("src");
    const name = new URL(second as string, server.origin).searchParams.get("name");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page)).not.toContainText("[Image #2]");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toContain(`[Image #1] = `);
    expect(text).toContain(name as string);
    expect(text).not.toContain("Image #2");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 2500);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composerOf(page).pressSequentially(" what is this?");
    await composerOf(page).press("Enter");
    await page.waitForTimeout(500);
    expect(messages(server)).toHaveLength(0);
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withChat(ok(), async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("img")).toBeVisible();
    const base = `${server.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=${encodeURIComponent("../../.werk/log.jsonl")}`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=..%2F..%2F..%2Fetc%2Fpasswd`)).status()).toBe(404);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
