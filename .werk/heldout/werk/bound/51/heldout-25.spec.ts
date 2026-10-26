import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../e2e/support/fixtures.ts";
import { chat, composerOf, messages, putImage, say, withChat } from "./heldout-img-support.ts";

const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
const projectOf = (url: string) => new URL(url).pathname.split("/")[2] as string;
const reply = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await withChat(reply, async (server) => {
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    await putImage(page);
    await expect(chips(page).locator('[data-slot="image-chip"][data-state="uploading"]')).toHaveCount(1);
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    release();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    const composer = composerOf(page);
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    await expect.soft(chat(page).getByRole("img"), "the chat shows the image under [Image #1]").toBeVisible();
    await expect(chat(page)).toContainText("[Image #1]");
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain("iVBORw0KGgo");
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(reply, async (server) => {
    await page.goto(server.url);
    await putImage(page, { bytes: 2 * 1024 * 1024 });
    await putImage(page, { bytes: 25 * 1024 * 1024 });
    const items = chips(page).locator('[data-slot="image-chip"]');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByRole("img")).toBeVisible();
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composerOf(page)).not.toHaveValue(/Image #2/);
    const composer = composerOf(page);
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).not.toContain("[Image #2]");
    const dir = join(server.dir, ".werk", "attachments");
    expect(readdirSync(dir).filter((n) => n.endsWith(".png")).length).toBe(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(reply, async (server) => {
    await page.goto(server.url);
    await putImage(page);
    await putImage(page);
    await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator('[data-slot="image-chip"]')).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page)).not.toContainText("[Image #2]");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await withChat(reply, async (server) => {
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    await putImage(page);
    await expect(chips(page).locator('[data-state="uploading"]')).toHaveCount(1);
    const composer = composerOf(page);
    await composer.pressSequentially(" what is this?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toHaveCount(0);
    expect(messages(server)).toHaveLength(0);
    release();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withChat(reply, async (server) => {
    await page.goto(server.url);
    await putImage(page);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composerOf(page).press("Enter"); // stored screenshot
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(readdirSync(join(server.dir, ".werk", "attachments")).filter((n) => n.endsWith(".png")).length).toBe(1);
    const base = `${server.origin}/api/projects/${projectOf(server.url)}/image`;
    const get = (q: string) => page.evaluate((u) => fetch(u).then((r) => r.status), `${base}${q}`);
    expect(await get("?name=")).toBe(404);
    expect(await get("?name=..%2F..%2Flog.jsonl")).toBe(404);
    expect(await get("?name=..%2F..%2F..%2Fpackage.json")).toBe(404);
    await putImage(page);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composerOf(page).pressSequentially(" again");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen").first()).toBeVisible();
  });
});
