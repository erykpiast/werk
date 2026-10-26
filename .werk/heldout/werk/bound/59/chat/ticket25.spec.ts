import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  composer,
  giveImage,
  messages,
  say,
  slowUploads,
  storedImages,
  thumbName,
  withChat,
} from "./helpers.ts";

const chipList = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
const one = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
}) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 1500);
    await giveImage(page, "png");
    const chips = chipList(page);
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    const thumb = chips.getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // The message shows in the chat with the image under "[Image #1]".
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("[Image #1]");
    await expect
      .soft(turn.locator("img"), "an image in the chat log under [Image #1]")
      .toHaveCount(1);
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S*\/\.werk\/attachments\/\S+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toMatch(/iVBORw0KGgo/);
    expect(text.length).toBeLessThan(2000);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({
  page,
}) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await giveImage(page, 2 * 1024 * 1024);
    await giveImage(page, 25 * 1024 * 1024);
    const chips = chipList(page);
    const items = chips.getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByRole("img")).toBeVisible();
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText(
      "larger than 20 MB",
    );
    await items.nth(1).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S*\/\.werk\/attachments\/\S+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect(storedImages(server)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await giveImage(page, 100);
    await giveImage(page, 200);
    const chips = chipList(page);
    await expect(chips.getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips).toContainText("[Image #1]");
    await expect(chips).toContainText("[Image #2]");
    const stayed = await thumbName(chips.getByRole("img").nth(1));
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    const value = await composer(page).inputValue();
    expect(value.match(/\[Image #1\]/g)).toHaveLength(1);
    expect(value).not.toContain("[Image #2]");
    await expect(chips.getByRole("listitem")).toHaveCount(1);
    await expect(chips).toContainText("[Image #1]");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(new RegExp(`\\[Image #1\\] = \\S*${stayed}`));
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 2500);
    await giveImage(page, "png");
    const chips = chipList(page);
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" What is red?");
    await composer(page).press("Enter");
    // The upload still runs: nothing went out.
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    expect(messages(server)).toHaveLength(0);
    await expect(chat(page).locator("article")).toHaveCount(0);
    // The chip clears the moment the message goes out, so the thumbnail is not watched here.
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S*\/\.werk\/attachments\/\S+\.png/);
    expect(text).toMatch(/What is red\?$/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({
  page,
}) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "png");
    await expect(chipList(page).getByRole("img")).toBeVisible();
    expect(storedImages(server)).toHaveLength(1);
    const base = `${server.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    const up = await page.request.get(
      `${base}?name=${encodeURIComponent("../../log.jsonl")}`,
    );
    expect(up.status()).toBe(404);
    expect((await page.request.get(`${base}?name=../../log.jsonl`)).status()).toBe(404);
    await composer(page).fill("");
    await giveImage(page, "png");
    await expect(chipList(page).getByRole("img")).toBeVisible();
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
