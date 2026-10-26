import { readFileSync, statSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { chat, composer, pasteImage, say, send, withServer } from "./support.ts";

const reply = {
  roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")], [say("m3", "Third")]] } },
};
const chipsOf = (page: Page) => page.getByRole("list", { name: "Attached images" });
const gateUploads = async (page: Page) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  return release;
};
const pathOf = (text: string, n: number) =>
  text.match(new RegExp(`\\[Image #${n}\\] = (\\S+)`))?.[1] ?? null;

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    const release = await gateUploads(page);
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page);
    const chips = chipsOf(page);
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    release();
    await expect(chips.getByRole("img")).toBeVisible();
    await expect(chips).toContainText("[Image #1]");
    await composer(page).pressSequentially("Why is this red?");
    await composer(page).press("Enter");
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("[Image #1]");
    await expect(turn).toContainText("Why is this red?");
    // the message shows the image under its token
    await expect.soft(turn.locator("img"), "IMAGE-IN-CHAT").toHaveCount(1);
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    const p = pathOf(text as string, 1);
    expect(p).toMatch(/\.werk\/attachments\/.+\.png$/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain("iVBOR");
    expect(readFileSync(p as string).length).toBeGreaterThan(0);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page, 2 * 1024 * 1024);
    await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, 25 * 1024 * 1024);
    const chips = chipsOf(page);
    await expect(chips.locator("li").nth(0)).toContainText("[Image #1]");
    await expect(chips.locator("li").nth(1).getByRole("alert")).toContainText("larger than 20 MB");
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips.getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await composer(page).pressSequentially("Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = \S+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect(statSync(pathOf(text as string, 1) as string).size).toBe(2 * 1024 * 1024);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page, 1000);
    await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, 2000);
    await expect(chipsOf(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chipsOf(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const value = await composer(page).inputValue();
    expect(value.split("[Image #1]").length - 1).toBe(1);
    expect(value).not.toContain("[Image #2]");
    await expect(chipsOf(page).locator("li")).toHaveCount(1);
    await expect(chipsOf(page).locator("li").first()).toContainText("[Image #1]");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(statSync(pathOf(text as string, 1) as string).size).toBe(2000);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    const release = await gateUploads(page);
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page);
    await expect(chipsOf(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    await page.waitForTimeout(1500);
    expect(s.messages()).toHaveLength(0);
    await expect(chat(page).locator("article")).toHaveCount(0);
    release();
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = \S+\.werk\/attachments\/\S+\.png/);
  });
});

test("25.5 an image request with no name answers 404 and the server stays up", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page);
    await expect(chipsOf(page).getByRole("img")).toBeVisible();
    await composer(page).pressSequentially(" first");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const base = `${s.origin}/api/projects/${s.dir.split("/").pop()}/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    for (const name of ["../log.jsonl", "..%2F..%2Fproject%2F.werk%2Flog.jsonl", "../../../../etc/passwd"]) {
      expect((await page.request.get(`${base}?name=${name}`)).status()).toBe(404);
    }
    await pasteImage(page);
    await expect(chipsOf(page).getByRole("img")).toBeVisible();
    const thumb = chipsOf(page).getByRole("img");
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).pressSequentially(" second");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen again")).toBeVisible();
  });
});
