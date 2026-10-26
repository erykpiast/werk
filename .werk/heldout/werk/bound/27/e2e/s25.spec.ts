import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { chat, chatScript, composer, dropImage, left, messages, pasteImage, say, send, serve, slowUploads } from "./helpers.ts";

const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await serve({ script: chatScript([say("m1", "It is red because of CSS")]) }, async (server) => {
    await slowUploads(page, 1500);
    await page.goto(server.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible({ timeout: 15000 });
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    // the message shows in the chat with the image under "[Image #1]"
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("Why is this red?");
    await expect(turn).toContainText("[Image #1]");
    await expect(turn.getByRole("img")).toBeVisible();
    await expect(chat(page).getByText("It is red because of CSS")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).toMatch(/Read/);
    expect(text).not.toContain("iVBORw0KGgo");
    expect(text.length).toBeLessThan(5000);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await serve({ script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, 2 * 1024 * 1024);
    await expect(chips(page).getByRole("img")).toHaveCount(1, { timeout: 15000 });
    await pasteImage(page, 25 * 1024 * 1024);
    await expect(chips(page).getByRole("alert")).toContainText(/larger than 20 MB/, { timeout: 30000 });
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    expect(await composer(page).inputValue()).not.toContain("[Image #2]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
    expect(readdirSync(join(server.dir, ".werk", "attachments")).filter((n) => !n.startsWith(".")).length).toBe(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await serve({ script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await pasteImage(page, 2000);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2, { timeout: 15000 });
    const srcs = await chips(page).getByRole("img").evaluateAll((els) => els.map((e) => e.getAttribute("src") as string));
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const text = await composer(page).inputValue();
    expect(text.split("[Image #1]").length - 1).toBe(1);
    expect(text).not.toContain("[Image #2]");
    await expect(chips(page).getByRole("img")).toHaveAttribute("src", srcs[1] as string);
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const sent = messages(server)[0] as string;
    const kept = new URL(srcs[1] as string, "http://x").searchParams.get("name") as string;
    expect(sent).toContain(`[Image #1] = `);
    expect(sent).toContain(kept);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await serve({ script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await slowUploads(page, 3000);
    await page.goto(server.url);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    await page.waitForTimeout(500);
    expect(messages(server)).toHaveLength(0);
    await expect.poll(() => messages(server).length, { timeout: 15000 }).toBe(1);
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await serve({ script: chatScript([say("m1", "Ok")]) }, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("img")).toBeVisible({ timeout: 15000 });
    const base = `${server.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=..%2F..%2Fpackage.json`)).status()).toBe(404);
    await pasteImage(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(2, { timeout: 15000 });
    await send(page, "go");
    await expect(chat(page).getByText("Ok")).toBeVisible();
  });
});
