import { expect, test } from "@playwright/test";
import {
  chat,
  chips,
  composer,
  messages,
  pasteImage,
  say,
  withChat,
} from "./g4-support.ts";

const ok = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      await held;
      await route.continue();
    });
    await pasteImage(page);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    release();
    await expect(chips(page).getByRole("img")).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // The message in the chat shows the image under its token.
    await expect(chat(page).locator("article").first().getByRole("img")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).toMatch(/Read/);
    expect(text).not.toContain("iVBORw0KGgo");
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, 2 * 1024 * 1024);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await pasteImage(page, 25 * 1024 * 1024);
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/Image #2/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toContain("[Image #1] =");
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await pasteImage(page);
    await pasteImage(page);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const box = composer(page);
    await expect(box).toHaveValue("[Image #1]");
    await expect(chips(page).locator("li")).toHaveCount(1);
    await box.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      await held;
      await route.continue();
    });
    await pasteImage(page);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    await expect(chat(page).locator("article")).toHaveCount(0);
    expect(messages(server)).toHaveLength(0);
    release();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
  });
});

test("25.5 an empty name answers 404 and the server stays up", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    const base = `${server.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=../../log.jsonl`)).status).toBe(404);
    expect((await fetch(`${base}?name=..%2F..%2F.werk%2Flog.jsonl`)).status).toBe(404);
    await pasteImage(page);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
