import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appendLog, cardEv, chat, composer, expect, JPEG_HEAD, PNG_HEAD, pasteImage, say, send, serve, test } from "./browser-support.ts";

const reply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen2")]] } } };
const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
const attachments = (dir: string) => {
  const d = join(dir, ".werk", "attachments");
  return existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith(".")) : [];
};

test("24.1 hash menu", async ({ page }) => {
  const s = await serve();
  try {
    appendLog(s.dir, cardEv("werk-shots", "root", { title: "Pasted screenshots" }));
    await page.goto(s.url);
    const c = composer(page);
    await expect(c).toBeVisible();
    await c.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const opt = menu.getByRole("option", { name: /werk-shots/ });
    await expect(opt).toContainText("Pasted screenshots");
    // menu is below the caret: its top is at or below the composer's top
    const mb = await menu.boundingBox();
    const cb = await c.boundingBox();
    expect.soft((mb?.y ?? 0) >= (cb?.y ?? 1e9), "menu opens below the caret").toBe(true);
    await c.press("ArrowDown");
    await c.press("ArrowUp");
    const idx = await menu.getByRole("option").allTextContents();
    const at = idx.findIndex((t) => t.includes("werk-shots"));
    for (let i = 0; i < at; i++) await c.press("ArrowDown");
    await c.press("Enter");
    await expect(c).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await c.fill("");
    await c.pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  } finally {
    await s.dispose();
  }
});

test("24.2 pasted PNG uploads, reaches agent as path", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
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
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    release();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: s.dir, encoding: "utf8" });
    expect(status).not.toContain("attachments");
    expect(attachments(s.dir).length).toBe(1);
  } finally {
    await s.dispose();
  }
});

test("24.3 oversized image refused", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    await page.goto(s.url);
    await pasteImage(page, 25 * 1024 * 1024, "image/png", PNG_HEAD, "drop");
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await send(page, "hello");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    expect(text).not.toMatch(/\[Image #1\] = /);
    expect(text).not.toContain(".werk/attachments");
    expect(attachments(s.dir)).toEqual([]);
  } finally {
    await s.dispose();
  }
});

test("24.4 removing first image renumbers", async ({ page }) => {
  const s = await serve({ script: reply });
  try {
    await page.goto(s.url);
    await pasteImage(page, 2000, "image/png", PNG_HEAD);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteImage(page, 3000, "image/jpeg", JPEG_HEAD);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("li")).toHaveCount(1);
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = s.messages();
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
    expect(text).not.toContain("[Image #2]");
  } finally {
    await s.dispose();
  }
});

test("24.5 bad image requests do not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  const s = await serve({ script: { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } } });
  try {
    await page.goto(s.url);
    await send(page, "hi");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const base = `${s.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(404);
    const esc = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(esc.status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../../../etc/hosts")}`)).status).toBe(404);
    expect((await fetch(`${s.origin}/api/projects/project/image/..%2Flog.jsonl`)).status).toBe(404);
    await composer(page).fill("");
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
  } finally {
    await s.dispose();
  }
});
