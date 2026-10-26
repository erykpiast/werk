import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "./server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
const REPLY: Script = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const messages = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachments = (s: BrowserServer) => join(s.dir, ".werk", "attachments");
const stored = (s: BrowserServer) =>
  existsSync(attachments(s)) ? readdirSync(attachments(s)).filter((n) => !n.startsWith(".")) : [];

type Img = { size?: number; fill?: number; type?: string; name?: string };
/** Puts an image on the composer by a clipboard paste, or by a drop. */
async function give(page: Page, how: "paste" | "drop", img: Img = {}) {
  await composer(page).focus();
  await page.evaluate(
    ({ base64, how, img }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(img.size ?? png.length);
      if (img.fill !== undefined) data.fill(img.fill);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], img.name ?? "shot.png", { type: img.type ?? "image/png" }));
      if (how === "paste") {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      } else {
        document.querySelector("[data-slot=composer]")?.dispatchEvent(
          new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    },
    { base64: PNG_BASE64, how, img },
  );
}
/** Slows the upload so a test can look at the spinner. A network delay, not a change of the product. */
async function slowUploads(page: Page, ms: number) {
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}
const gitStatus = (dir: string) =>
  spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" }).stdout;

// ---------------- ticket 24 ----------------

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(s.dir, ".werk", "log.jsonl"), [
      { type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" },
      { type: "node.accepted", id: "werk-shots", actor: "you" },
    ].map((e) => `${JSON.stringify(e)}\n`).join(""));
    await page.goto(s.url);
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox").or(page.getByRole("menu"));
    await expect(menu).toBeVisible({ timeout: 3000 });
    await expect(menu).toContainText("werk-shots");
    await expect(menu).toContainText("Pasted screenshots");
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("Look at #werk-shots");
    await expect(menu).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await slowUploads(page, 1500);
    await composer(page).fill("What is wrong here? ");
    await give(page, "paste");
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible({ timeout: 10000 });
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    const m = /\[Image #1\] = (\S*\.werk\/attachments\/\S+\.png)/.exec(text ?? "");
    expect(m).not.toBeNull();
    expect(existsSync(m![1]!)).toBe(true);
    expect(text).toMatch(/Open each image above with Read/);
    expect(gitStatus(s.dir)).not.toContain("attachments");
    expect(stored(s)).toHaveLength(1);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await give(page, "drop", { size: 25 * 1024 * 1024 });
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer(page).press("Enter");
    // The turn that the agent gets: look for it where a user would, in the chat and in the agent's launches.
    await expect.poll(() => messages(s).length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(messages(s)[0]).not.toMatch(/\.werk\/attachments/);
    expect(stored(s)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await give(page, "paste", { size: 700, fill: 1 });
    await give(page, "paste", { size: 900, fill: 2, type: "image/jpeg", name: "b.jpg" });
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2, { timeout: 10000 });
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await composer(page).press("Enter");
    await expect.poll(() => messages(s).length, { timeout: 8000 }).toBeGreaterThan(0);
    const m = /\[Image #1\] = (\S*\.werk\/attachments\/\S+)/.exec(messages(s)[0] ?? "");
    expect(m).not.toBeNull();
    // The JPEG was declared as image/jpeg, and the server judges by the first bytes; the file that stayed is the second upload.
    expect(statSync(m![1]!).size).toBe(900);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    const project = basename(s.dir);
    const base = `${s.origin}/api/projects/${project}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    const climb = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(climb.status).toBe(404);
    expect(await climb.text()).not.toContain("node.proposed");
    const climb2 = await fetch(`${base}?name=..%2F..%2F..%2Fetc%2Fpasswd`);
    expect(climb2.status).toBe(404);
    await composer(page).pressSequentially("/");
    const menu = page.getByRole("listbox").or(page.getByRole("menu"));
    await expect(menu).toBeVisible({ timeout: 3000 });
  });
});

// ---------------- ticket 25 ----------------

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await slowUploads(page, 1500);
    await give(page, "paste");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible({ timeout: 10000 });
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const user = chat(page).locator("[data-role=user]").first();
    await expect(user).toContainText("[Image #1]");
    await expect(chat(page).locator("[data-slot=chat-log]").getByRole("img", { name: "[Image #1]" })).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\//);
    expect(text).toMatch(/Open each image above with Read/);
    expect(text).not.toContain(PNG_BASE64);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await give(page, "paste", { size: 2 * 1024 * 1024 });
    await give(page, "paste", { size: 25 * 1024 * 1024 });
    const items = chips(page).locator("[data-slot=image-chip]");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByRole("img")).toBeVisible({ timeout: 15000 });
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText(/larger than 20 MB/);
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\//);
    expect(text).not.toContain("[Image #2]");
    expect(stored(s)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await give(page, "paste", { size: 700, fill: 1 });
    await give(page, "paste", { size: 900, fill: 2 });
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2, { timeout: 10000 });
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await expect(chips(page).locator("[data-slot=image-chip]")).toContainText("[Image #1]");
    await composer(page).press("Enter");
    await expect.poll(() => messages(s).length, { timeout: 8000 }).toBeGreaterThan(0);
    const m = /\[Image #1\] = (\S*\.werk\/attachments\/\S+)/.exec(messages(s)[0] ?? "");
    expect(m).not.toBeNull();
    expect(statSync(m![1]!).size).toBe(900);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await slowUploads(page, 3000);
    await give(page, "paste");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    await expect(chat(page).locator("[data-role=user]")).toHaveCount(0);
    expect(messages(s)).toHaveLength(0);
    await expect(chat(page).getByText("Seen")).toBeVisible({ timeout: 15000 });
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withChat(REPLY, async (s) => {
    await page.goto(s.url);
    await give(page, "paste");
    await expect(chips(page).getByRole("img")).toBeVisible({ timeout: 10000 });
    await composer(page).pressSequentially(" first");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const base = `${s.origin}/api/projects/${basename(s.dir)}/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}`)).status()).toBe(404);
    const climb = await page.request.get(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(climb.status()).toBe(404);
    await give(page, "paste");
    await expect(chips(page).getByRole("img")).toBeVisible({ timeout: 10000 });
    await composer(page).pressSequentially(" second");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen again")).toBeVisible();
  });
});
