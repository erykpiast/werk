import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { addImage, chat, chips, composerOf, expect, jpegBase64, launchArgs, messages, say, send, withServer } from "./chatkit.ts";
import { test } from "./fixtures.ts";

const ok = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const MB = 1024 * 1024;
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const stored = (dir: string) => (existsSync(attachments(dir)) ? readdirSync(attachments(dir)).filter((n) => !n.startsWith(".")) : []);

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(ok, async (server) => {
    expect(server.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
    expect(server.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.click();
    await composer.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const options = menu.getByRole("option");
    await expect(options.filter({ hasText: "werk-shots" })).toContainText("Pasted screenshots");
    // The menu opens at the caret: below the line of the text the person types.
    const caretBox = await composer.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox && caretBox && menuBox.y >= caretBox.y).toBe(true);
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      if ((await options.nth(i).innerText()).includes("werk-shots")) break;
      await composer.press("ArrowDown");
    }
    await composer.press("Enter");
    await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(menu).toHaveCount(0);
    await composer.fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.click();
    await composer.pressSequentially("What is wrong here? ");
    await addImage(page);
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    const chip = chips(page).locator("[data-slot=image-chip]");
    await expect(chip).toContainText("[Image #1]");
    await expect(chip.getByRole("img")).toBeVisible();
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open each image|Open each image/i);
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(status).not.toContain("attachments");
  });
});

test("24.3 an oversized dropped image is refused and not sent", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await addImage(page, { size: 25 * MB, how: "drop" });
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\[Image #1\] =/);
    expect(stored(server.dir)).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await addImage(page, { name: "one.png", size: 120 });
    await addImage(page, { name: "two.jpg", mime: "image/jpeg", base64: jpegBase64() });
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    const src = await chips(page).getByRole("img").getAttribute("src");
    expect(src).toMatch(/\.jpg|\.jpeg/);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.(jpg|jpeg)/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request answers 404 and the server still runs", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withServer({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const base = `${server.origin}/api/projects/${new URL(server.url).pathname.split("/").pop()}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}`)).status).toBe(404);
    const up = await fetch(`${base}?name=${encodeURIComponent("../../log.jsonl")}`);
    expect(up.status).toBe(404);
    expect(await up.text()).not.toContain("node.proposed");
    const up2 = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(up2.status).toBe(404);
    expect(await up2.text()).not.toContain("node.proposed");
    const composer = composerOf(page);
    await composer.fill("");
    await composer.pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  });
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    // Slow the upload a little so the spinner can be seen.
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await addImage(page);
    const chip = chips(page).locator("[data-slot=image-chip]");
    await expect(chip).toBeVisible();
    await expect(chip.locator("[data-slot=spinner]")).toBeVisible();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chip.getByRole("img")).toBeVisible();
    await expect(chip).toContainText("[Image #1]");
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("[Image #1]");
    await expect(turn.locator("img")).toHaveCount(1);
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Read/);
    expect(text).not.toContain(PNG);
  });
});
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await addImage(page, { size: 2 * MB });
    await addImage(page, { size: 25 * MB });
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const items = chips(page).locator("[data-slot=image-chip]");
    await expect(items.nth(0).getByRole("img")).toBeVisible();
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer).not.toHaveValue(/Image #2/);
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
    expect(text.match(/\[Image #\d+\] =/g)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await addImage(page, { name: "a.png", size: 100 });
    await addImage(page, { name: "b.png", size: 200 });
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const imgs = chips(page).getByRole("img");
    await expect(imgs).toHaveCount(2);
    const second = (await imgs.nth(1).getAttribute("src")) as string;
    const name2 = new URL(second, "http://x").searchParams.get("name") as string;
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page)).not.toContainText("[Image #2]");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*/);
    expect(text).toContain(name2);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await addImage(page);
    const chip = chips(page).locator("[data-slot=image-chip]");
    await expect(chip.locator("[data-slot=spinner]")).toBeVisible();
    await composerOf(page).pressSequentially(" What is this?");
    await composerOf(page).press("Enter");
    await page.waitForTimeout(1000);
    expect(messages(server)).toHaveLength(0);
    release();
    await expect(chip.getByRole("img")).toBeVisible();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(launchArgs(server).length).toBe(1);
  });
});

test("25.5 an image request with no name answers 404, the server stays up, and a paste still works", async ({ page }) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await addImage(page);
    await expect(chips(page).getByRole("img")).toBeVisible();
    const base = `${server.origin}/api/projects/${new URL(server.url).pathname.split("/").pop()}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../.werk/log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("..")}`)).status).toBe(404);
    await addImage(page);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await send(page, "still works");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
