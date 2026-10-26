import { spawnSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import {
  addCards,
  chat,
  composer,
  giveImage,
  messages,
  say,
  send,
  slowUploads,
  storedImages,
  thumbName,
  withChat,
} from "./helpers.ts";

const chipList = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
const one = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withChat(one, async (server) => {
    addCards(server, [{ id: "werk-shots", title: "Pasted screenshots" }]);
    await page.goto(server.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const options = menu.getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("werk-shots");
    await expect(options.first()).toContainText("Pasted screenshots");
    // The menu opens below the caret.
    const box = await menu.boundingBox();
    const area = await composer(page).boundingBox();
    expect
      .soft(
        box && area && box.y >= area.y,
        `menu top ${box?.y} should be at or below the composer top ${area?.y}`,
      )
      .toBe(true);
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    expect((await composer(page).inputValue()).trimEnd()).toBe(
      "Look at #werk-shots",
    );
    await expect(menu).toHaveCount(0);
    await composer(page).fill("");
    await composer(page).pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
}) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await slowUploads(page, 1500);
    await composer(page).pressSequentially("What is wrong here? ");
    await giveImage(page, "png");
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    const chips = chipList(page);
    await expect(chips).toContainText("[Image #1]");
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips.getByRole("img");
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S*\/\.werk\/attachments\/\S+\.png/);
    expect(text).toContain("Open each image above with Read");
    const status = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: server.dir,
      encoding: "utf8",
    }).stdout;
    expect(storedImages(server)).toHaveLength(1);
    expect(status).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    // Text goes first: a message of only a refused token is empty and goes nowhere.
    await composer(page).pressSequentially("What is this?");
    await giveImage(page, 25 * 1024 * 1024, "drop");
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    const chips = chipList(page);
    await expect(chips).toContainText("[Image #1]");
    await expect(chips.getByRole("alert")).toContainText("20 MB");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toContain("[Image");
    expect(text).not.toContain("attachments");
    expect(storedImages(server)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
}) => {
  await withChat(one, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "png");
    await giveImage(page, "jpeg");
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    const chips = chipList(page);
    await expect(chips.getByRole("img")).toHaveCount(2);
    await expect(chips).toContainText("[Image #1]");
    await expect(chips).toContainText("[Image #2]");
    const jpegName = await thumbName(chips.getByRole("img").nth(1));
    expect(jpegName).toMatch(/\.jpg$/);
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips.getByRole("listitem")).toHaveCount(1);
    await expect(chips).not.toContainText("[Image #2]");
    expect(await thumbName(chips.getByRole("img"))).toBe(jpegName);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toContain(`[Image #1] = `);
    expect(text).toMatch(new RegExp(`\\[Image #1\\] = \\S*${jpegName}`));
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = {
    event: {
      type: "system",
      subtype: "init",
      slash_commands: ["review", "recall"],
    },
  };
  await withChat(
    { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(chat(page).getByText("Hello")).toBeVisible();
      const base = `${server.origin}/api/projects/project/image`;
      const empty = await page.request.get(`${base}?name=`);
      expect(empty.status()).toBe(404);
      const up = await page.request.get(
        `${base}?name=${encodeURIComponent("../../../package.json")}`,
      );
      expect(up.status()).toBe(404);
      expect(await up.text()).not.toContain("werk");
      const raw = await page.request.get(`${base}?name=../../../package.json`);
      expect(raw.status()).toBe(404);
      await composer(page).fill("");
      await composer(page).pressSequentially("/");
      await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
        "/review",
        "/recall",
      ]);
    },
  );
});
