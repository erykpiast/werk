import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "../e2e/support/fixtures.ts";
import { JPEG_BASE64, chat, composerOf, messages, putImage, say, withChat } from "./heldout-img-support.ts";

const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
const projectOf = (url: string) => new URL(url).pathname.split("/")[2] as string;

test("24.1 pick a card from the hash menu", async ({ page, app }) => {
  expect(app.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
  await page.goto(app.url);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const opt = menu.getByRole("option").filter({ hasText: "werk-shots" });
  await expect(opt).toContainText("Pasted screenshots");
  // the menu opens below the caret
  const mb = await menu.boundingBox();
  const cb = await composer.boundingBox();
  expect.soft(mb && cb && mb.y >= cb.y, "the menu opens below the caret").toBe(true);
  // arrow keys to werk-shots, then Enter
  const options = menu.getByRole("option");
  const n = await options.count();
  for (let i = 0; i < n; i++) {
    if ((await options.nth(i).getAttribute("aria-selected")) === "true" &&
        (await options.nth(i).innerText()).includes("werk-shots")) break;
    await composer.press("ArrowDown");
  }
  await composer.press("Enter");
  await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await composer.fill("`#wer");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.click();
    await composer.pressSequentially("What is wrong here? ");
    await putImage(page);
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open (each|that|the) image/i);
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(existsSync(join(server.dir, ".werk", "attachments"))).toBe(true);
    expect(status).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and not sent", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await putImage(page, { bytes: 25 * 1024 * 1024, how: "drop" });
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composerOf(page).press("Enter");
    // Whatever turn the agent gets, it carries no path for the refused image.
    for (const text of messages(server)) {
      expect(text).not.toMatch(/\[Image #1\] =/);
      expect(text).not.toContain(".werk/attachments");
    }
    const dir = join(server.dir, ".werk", "attachments");
    expect(existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).length : 0).toBe(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    await putImage(page, { name: "a.png", type: "image/png" });
    await putImage(page, { name: "b.jpg", type: "image/jpeg", base64: JPEG_BASE64 });
    await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+/);
    expect(text).not.toContain("[Image #2]");
    expect(text).toMatch(/\.jpe?g/);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.fill("hi");
    await composer.press("Enter");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const base = `${server.origin}/api/projects/${projectOf(server.url)}/image`;
    const get = (q: string) =>
      page.evaluate((u) => fetch(u).then(async (r) => ({ s: r.status, t: (await r.text()).slice(0, 80) })), `${base}${q}`);
    expect((await get("?name=")).s).toBe(404);
    for (const q of ["?name=..%2F..%2Flog.jsonl", "?name=..%2F..%2F..%2Fpackage.json", "?name=..%2F..%2F..%2F..%2F..%2Fetc%2Fhosts"]) {
      const r = await get(q);
      expect(r.s).toBe(404);
      expect(r.t).not.toContain("node.proposed");
    }
    await composer.click();
    await composer.pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  });
});
