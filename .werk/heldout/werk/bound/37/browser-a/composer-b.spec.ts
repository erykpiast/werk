import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { type Page } from "@playwright/test";
import { pasteImage } from "./composer-helpers.ts";
import {
  type BrowserServer,
  chat,
  expect,
  join,
  leftPane,
  messages,
  say,
  test,
} from "./support.ts";

const script = (n = 3) => ({
  roles: {
    chat: {
      replies: Array.from({ length: n }, (_, i) => [
        say(`m${i}`, `Seen ${i + 1}`),
      ]),
    },
  },
});
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const ready = async (page: Page, s: BrowserServer) => {
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
};
/** Holds each image upload until `release` is called. */
async function holdUploads(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  return release;
}
const PNG_B64_MARK = "iVBORw0KGgo";

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
  make,
}) => {
  const s = await make({ script: script(1) });
  await ready(page, s);
  const release = await holdUploads(page);
  const composer = composerOf(page);
  await composer.click();
  await pasteImage(page, { type: "png", color: "#c22" });
  await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  await expect(composer).toHaveValue(/\[Image #1\]/);
  release();
  const thumb = chips(page).getByRole("img");
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(chips(page)).toContainText("[Image #1]");
  await composer.pressSequentially(" Why is this red?");
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  // The message shows in the chat with the image shown under "[Image #1]".
  const turn = chat(page).locator("article").first();
  await expect(turn).toContainText("Why is this red?");
  await expect
    .soft(turn.getByRole("img"), "the chat message shows the image")
    .toHaveCount(1);
  const [text] = messages(s);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).toContain("Open each image above with Read");
  expect(text).not.toContain(PNG_B64_MARK);
});

test("25.2 an oversized image shows its refusal and is not sent", async ({
  page,
  make,
}) => {
  const s = await make({ script: script(1) });
  await ready(page, s);
  await pasteImage(page, { type: "png", color: "#c22", size: 2 * 1024 * 1024 });
  await expect(chips(page).getByRole("img")).toHaveCount(1);
  await pasteImage(page, { type: "png", color: "#22c", size: 25 * 1024 * 1024 });
  const composer = composerOf(page);
  await expect(composer).toHaveValue("[Image #1][Image #2]");
  const items = chips(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByRole("img")).toBeVisible();
  await expect(items.nth(0)).toContainText("[Image #1]");
  await expect(items.nth(1).getByRole("alert")).toContainText("larger than 20 MB");
  await items.nth(1).getByRole("button", { name: "Remove [Image #2]" }).click();
  await expect(composer).not.toHaveValue(/\[Image #2\]/);
  await composer.pressSequentially(" Why is this red?");
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  const [text] = messages(s);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).not.toContain("[Image #2]");
  expect(text).toContain("Why is this red?");
});

test("25.3 removing a chip renumbers the remaining images", async ({ page, make }) => {
  const s = await make({ script: script(1) });
  await ready(page, s);
  await pasteImage(page, { type: "png", color: "#c22" });
  await expect(chips(page).getByRole("img")).toHaveCount(1);
  await pasteImage(page, { type: "png", color: "#2c2" });
  const composer = composerOf(page);
  await expect(composer).toHaveValue("[Image #1][Image #2]");
  const imgs = chips(page).getByRole("img");
  await expect(imgs).toHaveCount(2);
  const stayed = (await imgs.nth(1).getAttribute("src")) as string;
  const stayedName = new URL(stayed, "http://x").searchParams.get("name") as string;
  await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  await expect(composer).toHaveValue("[Image #1]");
  await expect(imgs).toHaveCount(1);
  await expect(chips(page)).toContainText("[Image #1]");
  await expect(chips(page)).not.toContainText("[Image #2]");
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  const [text] = messages(s);
  expect(text).toMatch(new RegExp(`\\[Image #1\\] = .*${stayedName.replace(".", "\\.")}`));
  expect(text).not.toContain("[Image #2]");
});

test("25.4 Enter waits for a running upload", async ({ page, make }) => {
  const s = await make({ script: script(1) });
  await ready(page, s);
  const release = await holdUploads(page);
  const composer = composerOf(page);
  await composer.click();
  await pasteImage(page, { type: "png", color: "#c22" });
  await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  await composer.pressSequentially(" Why is this red?");
  await composer.press("Enter");
  // The message does not go out yet.
  await expect(chat(page).locator("article")).toHaveCount(0);
  expect(messages(s)).toEqual([]);
  release();
  // The chip turns into a thumbnail and the waiting message goes out in the same moment, so the
  // check is on the message that reaches the agent.
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  const [text] = messages(s);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).toContain("Why is this red?");
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({
  page,
  make,
}) => {
  const s = await make({
    script: script(1),
    seed: (srv) => {
      // A stored screenshot: a file with the form of a stored name, in the attachments folder.
      const dir = join(srv.dir, ".werk", "attachments");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".gitignore"), "*\n");
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      writeFileSync(join(dir, "20261025-100000000Z-abcdef12.png"), png);
    },
  });
  await ready(page, s);
  const base = `${s.origin}/api/projects/project/image`;
  expect((await fetch(`${base}?name=20261025-100000000Z-abcdef12.png`)).status).toBe(200);
  expect((await fetch(`${base}?name=`)).status).toBe(404);
  const climb = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
  expect(climb.status).toBe(404);
  expect(await climb.text()).not.toContain("node.");
  // Through the browser, as the person's browser asks.
  const viaPage = await page.evaluate(async (u) => (await fetch(`${u}?name=`)).status, base);
  expect(viaPage).toBe(404);
  await pasteImage(page, { type: "png", color: "#c22" });
  const thumb = chips(page).getByRole("img");
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const composer = composerOf(page);
  await composer.pressSequentially(" still works");
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  expect(existsSync(join(s.dir, ".werk", "attachments"))).toBe(true);
});
