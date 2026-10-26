import { basename } from "node:path";
import type { Page } from "@playwright/test";
import { chat, composerOf, expect, giveImage, messages, say, test, withChat } from "./pw.ts";

const replies = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });

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

const delayUploads = (page: Page, ms: number) =>
  page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(replies, async (server) => {
    await delayUploads(page, 1500);
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png" });
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer).toHaveValue(/\[Image #1\]/);
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer.pressSequentially("Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    await expect.soft(chat(page).getByRole("img"), "the message shows the image under [Image #1]").toBeVisible({ timeout: 3000 });
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).toMatch(/open each image/i);
    expect(text).toMatch(/\bRead\b/);
    expect(text.length).toBeLessThan(2000);
    expect(text).not.toMatch(/iVBOR/);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(replies, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png", bytes: 2 * 1024 * 1024 });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await giveImage(page, { type: "png", bytes: 25 * 1024 * 1024 });
    const items = chips(page).locator("li");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(0).getByRole("img")).toBeVisible();
    await expect(items.nth(1).getByRole("alert")).toContainText("larger than 20 MB");
    await items.nth(1).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer).not.toHaveValue(/\[Image #2\]/);
    await composer.pressSequentially("Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(replies, async (server) => {
    const names = uploadNames(page);
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png", color: "#c33" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await giveImage(page, { type: "png", color: "#33c" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page).locator("li")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    const value = await composer.inputValue();
    expect(value.split("[Image #1]").length - 1).toBe(1);
    expect(value).not.toContain("[Image #2]");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(names).toHaveLength(2);
    expect(text).toContain(names[1] as string);
    expect(text).not.toContain(names[0] as string);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(replies, async (server) => {
    await delayUploads(page, 2500);
    await page.goto(server.url);
    const composer = composerOf(page);
    await giveImage(page, { type: "png" });
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer.pressSequentially("What is this?");
    await composer.press("Enter");
    expect(messages(server)).toHaveLength(0);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(chat(page).getByText("Seen")).toBeVisible({ timeout: 20_000 });
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withChat(replies, async (server) => {
    await page.goto(server.url);
    await giveImage(page, { type: "png" });
    await expect(chips(page).getByRole("img")).toBeVisible();
    const api = `${server.origin}/api/projects/${basename(server.dir)}/image`;
    expect((await page.request.get(`${api}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${api}?name=${encodeURIComponent("../log.jsonl")}`)).status()).toBe(404);
    await giveImage(page, { type: "png", color: "#3c3" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await composerOf(page).pressSequentially("still works");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
