import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { chat, composer, pasteImage, say, send, withServer } from "./support.ts";

const reply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const chipsOf = (page: import("@playwright/test").Page) =>
  page.getByRole("list", { name: "Attached images" });

test("24.1 hash menu picks a card; a backtick before the hash opens no menu", async ({ page }) => {
  await withServer({}, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const opt = menu.getByRole("option");
    await expect(opt).toHaveCount(1);
    await expect(opt.first()).toContainText("#werk-shots");
    await expect(opt.first()).toContainText("Pasted screenshots");
    // the menu opens below the caret: it sits under the composer text area top? record geometry
    const m = await menu.boundingBox();
    const c = await composer(page).boundingBox();
    expect(m && c).toBeTruthy();
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    expect((await composer(page).inputValue()).trim()).toBe("Look at #werk-shots");
    await expect(menu).toHaveCount(0);
    await composer(page).fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // the menu is placed below the caret
    await composer(page).fill("");
    await composer(page).pressSequentially("#wer");
    const m2 = await page.getByRole("listbox").boundingBox();
    const c2 = await composer(page).boundingBox();
    expect.soft(m2!.y, "BELOW-CARET").toBeGreaterThanOrEqual(c2!.y + c2!.height - 2);
  }, (s) => s.card("werk-shots", "Pasted screenshots", "root"));
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(s.url);
    await composer(page).pressSequentially("What is wrong here? ");
    await pasteImage(page);
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    const chips = chipsOf(page);
    await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(chips).toContainText("[Image #1]");
    release();
    const thumb = chips.getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(text).toContain("Open each image above with Read");
    const files = readdirSync(attachments(s.dir)).filter((f) => f.endsWith(".png"));
    expect(files).toHaveLength(1);
    const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: s.dir, encoding: "utf8" });
    expect(st.stdout).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and not sent", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await pasteImage(page, 25 * 1024 * 1024, "png", "drop");
    await expect(composer(page)).toHaveValue("[Image #1]");
    const chip = chipsOf(page);
    await expect(chip).toContainText("[Image #1]");
    await expect(chip.getByRole("alert")).toContainText("20 MB");
    await composer(page).pressSequentially(" why");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(text).not.toContain("[Image");
    expect(text).not.toContain("attachments");
    const dir = attachments(s.dir);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitignore") : [];
    expect(files).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer({ script: reply }, async (s) => {
    await page.goto(s.url);
    await pasteImage(page, null, "png");
    await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, null, "jpeg");
    await expect(chipsOf(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chipsOf(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
    await expect(chipsOf(page).getByRole("img")).toHaveAttribute("src", /\.jpg$/);
    await composer(page).pressSequentially(" x");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = \S*\.jpg/);
    expect(text).not.toContain("[Image #2]");
    expect(text).not.toMatch(/\.png/);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withServer({ script: { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } } }, async (s) => {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await send(page, "hi");
    await expect(chat(page).getByText("Hello", { exact: true })).toBeVisible();
    const base = `${s.origin}/api/projects/${s.dir.split("/").pop()}/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(base)).status()).toBe(404);
    for (const name of ["../log.jsonl", "../../project/.werk/log.jsonl", "%2e%2e%2flog.jsonl", "..%2F..%2F.werk%2Flog.jsonl"]) {
      const r = await page.request.get(`${base}?name=${name}`);
      expect(r.status()).toBe(404);
      expect(await r.text()).not.toContain("node.proposed");
    }
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 10000 });
  }, undefined);
});
