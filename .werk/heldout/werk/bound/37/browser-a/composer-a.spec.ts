import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dropImage, pasteImage } from "./composer-helpers.ts";
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

const composerOf = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Message" });
const chips = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: "Attached images" });

const attachments = (s: BrowserServer) => join(s.dir, ".werk", "attachments");
const storedImages = (s: BrowserServer) =>
  existsSync(attachments(s))
    ? readdirSync(attachments(s)).filter((f) => !f.startsWith("."))
    : [];

test("24.1 a card is picked from the hash menu", async ({ page, make }) => {
  const s = await make({
    script: script(1),
    seed: (srv) => {
      expect(
        srv.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code,
      ).toBe(0);
      expect(srv.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    },
  });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const options = menu.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("#werk-shots");
  await expect(options.first()).toContainText("Pasted screenshots");
  // The menu opens below the caret.
  const caretLine = (await composer.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect
    .soft(menuBox.y, "the menu top is below the top of the composer line")
    .toBeGreaterThanOrEqual(caretLine.y);
  // Move to the card with the arrow keys and press Enter.
  for (let i = 0; i < 3; i++) {
    if ((await options.first().getAttribute("aria-selected")) === "true") break;
    await composer.press("ArrowDown");
  }
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await composer.press("Enter");
  await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);

  // A backtick before the hash opens no menu.
  await composer.fill("");
  await composer.pressSequentially("`#wer");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
  make,
}) => {
  const s = await make({ script: script(1) });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  // Hold the upload for a moment so the spinner can be seen.
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("What is wrong here? ");
  await pasteImage(page, { type: "png", color: "#d33" });
  await expect(composer).toHaveValue("What is wrong here? [Image #1]");
  await expect(chips(page)).toContainText("[Image #1]");
  await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  release();
  const thumb = chips(page).getByRole("img");
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(chips(page).getByRole("status")).toHaveCount(0);
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  const [text] = messages(s);
  const m = /\[Image #1\] = (.*\.werk\/attachments\/[^\s]+\.png)/.exec(text ?? "");
  expect(m, text).not.toBeNull();
  expect(existsSync(m![1] as string)).toBe(true);
  expect(text).toContain("Open each image above with Read");
  expect(text).toMatch(/What is wrong here\? \[Image #1\]$/);
  // Version control shows no change for the stored image.
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: s.dir,
    encoding: "utf8",
  });
  expect(status).not.toContain("attachments");
  expect(status).not.toContain(".png");
});

test("24.3 an oversized image is refused and is not sent", async ({ page, make }) => {
  const s = await make({ script: script(1) });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await dropImage(page, { type: "png", color: "#33d", size: 25 * 1024 * 1024 });
  const composer = composerOf(page);
  await expect(composer).toHaveValue(/\[Image #1\]/);
  await expect(chips(page)).toContainText("[Image #1]");
  await expect(chips(page).getByRole("alert")).toContainText("20 MB");
  await composer.press("Enter");
  // The step says a turn reaches the agent. Give the server time to record one.
  await expect.poll(() => messages(s).length, { message: "a turn reaches the agent" }).toBe(1);
  const [text] = messages(s);
  expect(text).not.toMatch(/\.werk\/attachments/);
  expect(text).not.toMatch(/\[Image #1\] =/);
  expect(storedImages(s)).toEqual([]);
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
  make,
}) => {
  const s = await make({ script: script(1) });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await pasteImage(page, { type: "png", color: "#d33" });
  await expect(chips(page).getByRole("img")).toHaveCount(1);
  await pasteImage(page, { type: "jpeg", color: "#3d3" });
  const composer = composerOf(page);
  await expect(composer).toHaveValue("[Image #1][Image #2]");
  const imgs = chips(page).getByRole("img");
  await expect(imgs).toHaveCount(2);
  const jpegSrc = (await imgs.nth(1).getAttribute("src")) as string;
  expect(jpegSrc).toMatch(/\.jpg$/);
  await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  await expect(composer).toHaveValue("[Image #1]");
  await expect(imgs).toHaveCount(1);
  await expect(chips(page)).toContainText("[Image #1]");
  await expect(chips(page)).not.toContainText("[Image #2]");
  expect(await imgs.getAttribute("src")).toBe(jpegSrc);
  await composer.press("Enter");
  await expect(chat(page).getByText("Seen 1")).toBeVisible();
  const [text] = messages(s);
  const m = /\[Image #1\] = (.*\.werk\/attachments\/[^\s]+\.jpg)/.exec(text ?? "");
  expect(m, text).not.toBeNull();
  expect(text).not.toContain("[Image #2]");
  expect(readFileSync(m![1] as string).subarray(0, 3)).toEqual(
    Buffer.from([0xff, 0xd8, 0xff]),
  );
});

test("24.5 a bad image request does not harm the server", async ({ page, make }) => {
  const s = await make({
    script: {
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "system",
                  subtype: "init",
                  slash_commands: ["review", "recall"],
                },
              },
              say("m1", "Hello"),
            ],
          ],
        },
      },
    },
  });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const base = `${s.origin}/api/projects/project/image`;
  expect((await fetch(`${base}?name=`)).status).toBe(404);
  expect((await fetch(base)).status).toBe(404);
  const climb = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
  expect(climb.status).toBe(404);
  expect(await climb.text()).not.toContain("node.accepted");
  const climb2 = await fetch(`${base}?name=${encodeURIComponent("../../../../../../etc/passwd")}`);
  expect(climb2.status).toBe(404);
  expect(await climb2.text()).not.toContain("root:");

  // The commands come from the agent's start line, so the conversation has had its first turn.
  const composer = composerOf(page);
  await composer.fill("hi");
  await composer.press("Enter");
  await expect(chat(page).getByText("Hello")).toBeVisible();
  await composer.click();
  await composer.pressSequentially("/");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option")).toHaveText(["/review", "/recall"]);
});
