import { expect, test } from "@playwright/test";
import {
  chatScript,
  chips,
  composer,
  messages,
  paste,
  slowUploads,
  withServer,
} from "./img-helpers.ts";

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 800);
    await paste(page, { type: "image/png" });
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    const img = chips(page).first().locator("img");
    await expect(img).toBeVisible();
    await expect(chips(page).first().locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("Why is this red?")).toBeVisible();
    // The sent message shows the image under its token.
    await expect.soft(log.locator("img").first(), "no image in the chat log").toBeVisible();
    await expect.poll(() => messages(server).length).toBe(1);
    const text = messages(server)[0] as string;
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(text).toMatch(/Open each image above with Read/);
    expect(text).not.toMatch(/iVBOR|PNG\r?\n/);
    expect(text.length).toBeLessThan(2000);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await paste(page, { type: "image/png", noise: true });
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, { type: "image/png", bytes: 25 * 1024 * 1024 });
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1).locator("[data-slot=image-reason]")).toContainText(/larger than 20 MB/);
    await page.getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect.poll(() => messages(server).length).toBe(1);
    const text = messages(server)[0] as string;
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await paste(page, { type: "image/png", color: "red" });
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, { type: "image/png", color: "blue" });
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    const keep = await chips(page).nth(1).locator("img").getAttribute("src");
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first().locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    const value = await composer(page).inputValue();
    expect(value.match(/\[Image #1\]/g)?.length).toBe(1);
    expect(value).not.toContain("[Image #2]");
    expect(await chips(page).first().locator("img").getAttribute("src")).toBe(keep);
    await composer(page).pressSequentially(" look");
    await composer(page).press("Enter");
    await expect.poll(() => messages(server).length).toBe(1);
    const stored = new URL(keep as string, "http://x").searchParams.get("name");
    expect(messages(server)[0]).toContain(`[Image #1] = `);
    expect(messages(server)[0]).toContain(stored as string);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 1500);
    await paste(page, { type: "image/png" });
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    await composer(page).pressSequentially(" Is this right?");
    await composer(page).press("Enter");
    // The upload still runs: the message has not gone out.
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    expect(messages(server)).toEqual([]);
    // The send fires as the upload ends, and it clears the chips.
    await expect.poll(() => messages(server).length).toBe(1);
    expect(messages(server)[0]).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withServer(chatScript(1), async (server) => {
    await page.goto(server.url);
    await paste(page, { type: "image/png" });
    const img = chips(page).first().locator("img");
    await expect(img).toBeVisible();
    const stored = await img.getAttribute("src");
    expect((await page.request.get(new URL(stored as string, server.url).href)).status()).toBe(200);
    const base = server.url.replace("/p/", "/api/projects/") + "/image";
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=../../package.json`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=..%2F..%2F..%2Fpackage.json`)).status()).toBe(404);
    await paste(page, { type: "image/png", color: "green" });
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    await composer(page).pressSequentially(" ok");
    await composer(page).press("Enter");
    await expect(page.getByText("Answer 1")).toBeVisible();
  });
});
