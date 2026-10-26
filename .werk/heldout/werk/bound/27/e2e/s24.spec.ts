import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { decided } from "../../src/map/mark-fixtures.ts";
import { chat, chatScript, composer, dropImage, git, left, messages, pasteImage, say, send, serve, slowUploads } from "./helpers.ts";

const LOG = [...decided("root", { title: "Root" }), ...decided("werk-shots", { title: "Pasted screenshots", parent: "root" })];
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const SLASH = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([SLASH, say("m1", "Hi")]) }, async (server) => {
    await page.goto(server.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await send(page, "hello");
    await expect(chat(page).getByText("Hi", { exact: true })).toBeVisible();
    await composer(page).fill("");
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox", { name: "Cards" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    const input = await composer(page).boundingBox();
    // "below the caret": the menu starts at or under the top of the text box
    expect.soft(box && input && box.y >= input.y, `menu at y=${box?.y}, text box at y=${input?.y}`).toBe(true);
    const option = menu.getByRole("option", { name: /werk-shots/ });
    await expect(option).toContainText("Pasted screenshots");
    // the first row may be another card, so move down to werk-shots
    const options = menu.getByRole("option");
    const n = await options.count();
    for (let i = 0; i < n; i++) {
      if ((await options.nth(i).getAttribute("aria-selected")) === "true" && (await options.nth(i).innerText()).includes("werk-shots")) break;
      if ((await options.nth(i).innerText()).includes("werk-shots")) {
        for (let k = 0; k < i; k++) await composer(page).press("ArrowDown");
        break;
      }
    }
    await composer(page).press("Enter");
    expect((await composer(page).inputValue()).trimEnd()).toBe("Look at #werk-shots");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await composer(page).fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "Seen")]) }, async (server) => {
    await slowUploads(page, 1500);
    await page.goto(server.url);
    await composer(page).pressSequentially("What is wrong here? ");
    await pasteImage(page, "png");
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    const chips = page.getByRole("list", { name: "Attached images" });
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips.getByRole("img");
    await expect(thumb).toBeVisible({ timeout: 15000 });
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Open each image above with Read/);
    const status = git(server.dir, "status", "--porcelain", "--untracked-files=all");
    expect(status).not.toContain("attachments");
    expect(readdirSync(attachments(server.dir)).filter((n) => !n.startsWith(".")).length).toBe(1);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await page.goto(server.url);
    await dropImage(page, 25 * 1024 * 1024);
    await expect(composer(page)).toHaveValue("[Image #1]");
    const chips = page.getByRole("list", { name: "Attached images" });
    await expect(chips).toContainText("[Image #1]");
    await expect(chips.getByRole("alert")).toContainText("20 MB", { timeout: 30000 });
    await composer(page).pressSequentially(" hello");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\.werk\/attachments/);
    expect(text).not.toMatch(/\[Image #1\] =/);
    expect(!existsSync(attachments(server.dir)) || readdirSync(attachments(server.dir)).filter((n) => !n.startsWith(".")).length === 0).toBe(true);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await pasteImage(page, "jpeg");
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    const chips = page.getByRole("list", { name: "Attached images" });
    await expect(chips.getByRole("img")).toHaveCount(2);
    const jpegSrc = await chips.getByRole("img").nth(1).getAttribute("src");
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips.getByRole("img")).toHaveCount(1);
    await expect(chips.getByRole("img")).toHaveAttribute("src", jpegSrc as string);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([SLASH, say("m1", "Hi")]) }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi");
    await expect(chat(page).getByText("Hi", { exact: true })).toBeVisible();
    const base = `${server.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    const up = await page.request.get(`${base}?name=${encodeURIComponent("../../../package.json")}`);
    expect(up.status()).toBe(404);
    expect((await page.request.get(`${base}?name=..%2F..%2F..%2F.werk%2Flog.jsonl`)).status()).toBe(404);
    await composer(page).fill("");
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
  });
});
