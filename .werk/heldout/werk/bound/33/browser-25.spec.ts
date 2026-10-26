import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chat, composer, expect, PNG_HEAD, pasteImage, say, serve, test } from "./browser-support.ts";

const reply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen2")]] } } };
const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
const stored = (dir: string) => {
  const d = join(dir, ".werk", "attachments");
  return existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith(".")).map((f) => join(d, f)) : [];
};

test("25.1 pasted screenshot becomes numbered image read by path", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(s.url);
    await pasteImage(page);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    release();
    await expect(chips(page).getByRole("img")).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    // message appears in the chat with the image shown under [Image #1]
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("[Image #1]");
    await expect(turn.getByRole("img")).toBeVisible();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Open each image above with Read/);
    expect(text.length).toBeLessThan(2000);
  } finally {
    await s.dispose();
  }
});

test("25.2 oversized image shows refusal and is not sent", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    await page.goto(s.url);
    await pasteImage(page, 2 * 1024 * 1024, "image/png", PNG_HEAD);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, 25 * 1024 * 1024, "image/png", PNG_HEAD);
    await expect(chips(page).locator("li")).toHaveCount(2);
    await expect(chips(page).locator("li").nth(1).getByRole("alert")).toContainText("larger than 20 MB");
    await expect(composer(page)).toHaveValue(/\[Image #2\]/);
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    expect(text.match(/\[Image #\d+\] = /g)).toEqual(["[Image #1] = "]);
    expect(text).not.toContain("[Image #2]");
  } finally {
    await s.dispose();
  }
});

test("25.3 removing a chip renumbers", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    await page.goto(s.url);
    await pasteImage(page, 2000, "image/png", PNG_HEAD);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, 3000, "image/png", PNG_HEAD);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const c = composer(page);
    await expect(c).toHaveValue("[Image #1]");
    await expect(chips(page).locator("li")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    await c.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    const path = /\[Image #1\] = (\S+)/.exec(text)?.[1] as string;
    expect(path).toBeTruthy();
    expect(statSync(path).size).toBe(3000);
    expect(readFileSync(path).length).toBe(3000);
  } finally {
    await s.dispose();
  }
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(s.url);
    await pasteImage(page);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" my question");
    await composer(page).press("Enter");
    await page.waitForTimeout(1000);
    expect(s.messages()).toEqual([]);
    release();
    await expect(chips(page).getByRole("img")).toBeVisible().catch(() => {});
    await expect(chat(page).getByText("Seen")).toBeVisible({ timeout: 15000 });
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  } finally {
    await s.dispose();
  }
});

test("25.5 bad image name 404, server stays up", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    await page.goto(s.url);
    await pasteImage(page);
    await expect(chips(page).getByRole("img")).toBeVisible();
    expect(stored(s.dir).length).toBe(1);
    const base = `${s.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../project/.werk/log.jsonl")}`)).status).toBe(404);
    await pasteImage(page);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await composer(page).pressSequentially(" ok");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  } finally {
    await s.dispose();
  }
});
