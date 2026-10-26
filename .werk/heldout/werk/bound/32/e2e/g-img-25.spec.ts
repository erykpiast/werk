import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  chat,
  chipsOf,
  composerOf,
  expectThumb,
  giveImage,
  messages,
  say,
  send,
  withServer,
} from "./support-img.ts";

const ok = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    // hold the upload so the spinner state can be seen
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/projects/*/image", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await giveImage(page, "paste");
    const chips = chipsOf(page);
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    release();
    await expectThumb(page, 0);
    await expect(chips).toContainText("[Image #1]");
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // the message in the chat shows the image under its token
    await expect(chat(page).getByText("Why is this red?")).toBeVisible();
    await expect(chat(page).getByText("[Image #1]").first()).toBeVisible();
    await expect(chat(page).getByRole("img")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S+\.werk\/attachments\/\S+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain("iVBOR");
    expect(text).not.toMatch(/\x89PNG/);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "paste", { size: 2 * 1024 * 1024 });
    await giveImage(page, "paste", { size: 25 * 1024 * 1024 });
    const items = chipsOf(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expectThumb(page, 0);
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText("larger than 20 MB");
    await chipsOf(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composerOf(page)).not.toHaveValue(/Image #2/);
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect((text?.match(/\[Image #/g) ?? []).length).toBe(2); // header line + inline token
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "paste", { color: "red" });
    await giveImage(page, "paste", { color: "blue" });
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expectThumb(page, 0);
    await expectThumb(page, 1);
    const src2 = await chipsOf(page).getByRole("img").nth(1).getAttribute("src");
    await chipsOf(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chipsOf(page).getByRole("listitem")).toHaveCount(1);
    await expect(chipsOf(page)).toContainText("[Image #1]");
    await expect(chipsOf(page).getByRole("img")).toHaveAttribute("src", src2 ?? "");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    const name = /name=([^&]+)/.exec(src2 ?? "")?.[1];
    expect(text).toMatch(/\[Image #1\] = \S+/);
    expect(text).toContain(`${decodeURIComponent(name ?? "?")}`);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/projects/*/image", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await giveImage(page, "paste");
    await expect(
      chipsOf(page).getByRole("status", { name: "Uploading" }),
    ).toBeVisible();
    await send(page, " Why is this red?");
    // the message does not go out while the upload runs
    await expect(chipsOf(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    expect(messages(server)).toHaveLength(0);
    await expect(composerOf(page)).toHaveValue(/Why is this red\?/);
    release();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S+\.png/);
    expect(text).toMatch(/Why is this red\?$/);
    expect(messages(server)).toHaveLength(1);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "paste");
    await expectThumb(page, 0);
    const base = `${server.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../../../etc/passwd")}`)).status).toBe(404);
    await giveImage(page, "paste", { color: "green" });
    await expectThumb(page, 1);
    await composerOf(page).pressSequentially(" ok");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(existsSync(server.dir)).toBe(true);
  });
});
