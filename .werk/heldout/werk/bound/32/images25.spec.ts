import { expect, test, type Page } from "@playwright/test";
import {
  attachments, chips, composer, give, MB, messages, withServer,
} from "./img-support.ts";

const open = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};
const nameOf = async (page: Page, i: number) =>
  new URL((await chips(page).nth(i).locator("img").getAttribute("src"))!, "http://x").searchParams.get("name")!;

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await composer(page).click();
    await give(page, "paste");
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    release();
    await expect(chips(page).first().locator("img")).toBeVisible();
    await expect(chips(page).first()).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    // the message appears in the chat with the image shown under "[Image #1]"
    const user = page.locator("[data-role=user]").first();
    await expect(user).toContainText("Why is this red?");
    await expect.soft(page.getByRole("complementary", { name: "Chat pane" }).locator("img"), "chat message shows the image").toHaveCount(1);
    await expect.poll(() => messages(s).length).toBe(1);
    const msg = messages(s)[0];
    expect(msg).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(msg).toContain("Read");
    expect(msg).not.toContain("PNG");
    expect(msg.length).toBeLessThan(2000);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    await composer(page).click();
    await give(page, "paste", { pad: 2 * MB });
    await expect(chips(page).first().locator("img")).toBeVisible();
    await give(page, "paste", { pad: 25 * MB, color: "blue" });
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).first()).toContainText("[Image #1]");
    await expect(chips(page).nth(1).locator("[data-slot=image-reason]")).toContainText(/larger than 20 MB/);
    await page.getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/Image #2/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect.poll(() => messages(s).length).toBe(1);
    const msg = messages(s)[0];
    expect(msg).toMatch(/\[Image #1\] = \S+/);
    expect(msg).not.toContain("[Image #2]");
    expect(msg.match(/ = \S+attachments/g)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    await composer(page).click();
    await give(page, "paste", { color: "red" });
    await expect(chips(page).locator("img")).toHaveCount(1);
    await give(page, "paste", { color: "green" });
    await expect(chips(page).locator("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    const stays = await nameOf(page, 1);
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("[Image #1]");
    const text = await composer(page).inputValue();
    expect(text.match(/\[Image #1\]/g)).toHaveLength(1);
    expect(text).not.toContain("[Image #2]");
    await composer(page).press("Enter");
    await expect.poll(() => messages(s).length).toBe(1);
    const m = /\[Image #1\] = (\S+)/.exec(messages(s)[0]);
    expect(m![1].endsWith(stays)).toBe(true);
    expect(attachments(s).includes(stays)).toBe(true);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await composer(page).click();
    await give(page, "paste");
    await expect(chips(page).first().locator("[data-slot=spinner]")).toBeVisible();
    await composer(page).pressSequentially(" What is this?");
    await composer(page).press("Enter");
    await expect(page.locator("[data-role=user]")).toHaveCount(0);
    expect(messages(s)).toHaveLength(0);
    release();
    await expect(chips(page)).toHaveCount(0);
    await expect(page.locator("[data-role=user]")).toContainText("What is this?");
    await expect.poll(() => messages(s).length).toBe(1);
    expect(messages(s)[0]).toMatch(/\[Image #1\] = \S+attachments\S+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    await composer(page).click();
    await give(page, "paste");
    await expect(chips(page).first().locator("img")).toBeVisible();
    const project = encodeURIComponent(s.dir.split("/").pop()!);
    const base = `${s.origin}/api/projects/${project}/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(base)).status()).toBe(404);
    for (const bad of ["../log.jsonl", "..%2Flog.jsonl", "../../../../etc/passwd", "%2e%2e%2flog.jsonl"]) {
      expect((await page.request.get(`${base}?name=${bad}`)).status(), bad).toBe(404);
    }
    await give(page, "paste", { color: "blue" });
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    await expect
      .poll(() => chips(page).nth(1).locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await composer(page).pressSequentially(" ok");
    await composer(page).press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Seen")).toBeVisible();
  });
});
