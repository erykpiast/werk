import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { served, type Server } from "./server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const SCRIPT = { roles: { chat: { replies: [[say("m1", "Seen it")], [say("m2", "Seen again")], [say("m3", "Third")]] } } };

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_B64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

type Img = { kind: "png" | "jpg" | "big"; name: string };

/** Pastes (or drops) generated image files into the composer as a user would. */
async function paste(page: Page, files: Img[], how: "paste" | "drop" = "paste") {
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.evaluate(
    ({ files, how, png, jpg }) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      for (const f of files) {
        let data: Uint8Array;
        let type = "image/png";
        if (f.kind === "png") data = bytes(png);
        else if (f.kind === "jpg") {
          data = bytes(jpg);
          type = "image/jpeg";
        } else {
          data = new Uint8Array(25 * 1024 * 1024);
          data.set(bytes(png).slice(0, 8));
        }
        dt.items.add(new File([data as BlobPart], f.name, { type }));
      }
      const box = document.querySelector("textarea[data-composer]") as HTMLElement;
      if (how === "paste") {
        box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        const host = box.closest("[data-slot=composer]") as HTMLElement;
        host.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    },
    { files, how, png: PNG_B64, jpg: JPG_B64 },
  );
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chips = (page: Page) => page.locator("[data-slot=image-chip]");
const attachments = (s: Server) => join(s.dir, ".werk", "attachments");
const stored = (s: Server) =>
  existsSync(attachments(s)) ? readdirSync(attachments(s)).filter((n) => /\.(png|jpg|gif|webp)$/.test(n)) : [];

async function withApp(body: (s: Server, page: Page) => Promise<void>, page: Page) {
  const s = await served({ script: SCRIPT });
  try {
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await body(s, page);
  } finally {
    await s.dispose();
  }
}

/** The last message that reached the fake agent. */
const lastTurn = (s: Server) => s.messages().at(-1) ?? "";

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await withApp(async (s) => {
    await composer(page).fill("What is wrong here? ");
    await paste(page, [{ kind: "png", name: "shot.png" }]);
    await expect(composer(page)).toHaveValue(/What is wrong here\? \[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    release();
    await expect(chips(page).locator("img")).toBeVisible();
    await composer(page).press("Enter");
    await expect.poll(() => s.messages().length).toBe(1);
    const turn = lastTurn(s);
    const m = /\[Image #1\] = (\S+)/.exec(turn);
    expect(m, turn).not.toBeNull();
    expect(m?.[1]).toContain(join(".werk", "attachments"));
    expect(existsSync(m?.[1] as string)).toBe(true);
    expect(turn).toMatch(/Open each image above with Read/i);
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: s.dir, encoding: "utf8" });
    expect(status.stdout).not.toContain("attachments");
  }, page);
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withApp(async (s) => {
    await paste(page, [{ kind: "big", name: "big.png" }], "drop");
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).locator("[data-slot=image-reason]")).toContainText(/20 ?MB/);
    await composer(page).fill(`${await composer(page).inputValue()} look`);
    await composer(page).press("Enter");
    await expect.poll(() => s.messages().length).toBe(1);
    expect(lastTurn(s)).not.toMatch(/attachments/);
    expect(stored(s)).toEqual([]);
  }, page);
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "one.png" }]);
    await expect(chips(page).locator("img")).toHaveCount(1);
    await paste(page, [{ kind: "jpg", name: "two.jpg" }]);
    await expect(chips(page).locator("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue(/\[Image #1\][\s\S]*\[Image #2\]/);
    const secondSrc = await chips(page).nth(1).locator("img").getAttribute("src");
    await chips(page).nth(0).getByRole("button", { name: /Remove \[Image #1\]/ }).click();
    await expect(chips(page)).toHaveCount(1);
    const text = await composer(page).inputValue();
    expect(text.match(/\[Image #1\]/g)?.length).toBe(1);
    expect(text).not.toContain("[Image #2]");
    await expect(chips(page).locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    await expect(chips(page).locator("img")).toHaveAttribute("src", secondSrc as string);
    await composer(page).press("Enter");
    await expect.poll(() => s.messages().length).toBe(1);
    const name = new URL(secondSrc as string, s.origin).searchParams.get("name") as string;
    expect(lastTurn(s)).toMatch(new RegExp(`\\[Image #1\\] = \\S*${name.replace(".", "\\.")}`));
  }, page);
});

const imageUrl = (s: Server, name: string) =>
  `${s.origin}/api/projects/${encodeURIComponent(basename(s.dir))}/image?name=${name}`;

test("24.5 a bad image request does not harm the server, and a slash opens the command menu", async ({ page }) => {
  await withApp(async (s) => {
    expect((await fetch(imageUrl(s, ""))).status).toBe(404);
    expect((await fetch(imageUrl(s, "..%2F..%2Flog.jsonl"))).status).toBe(404);
    expect((await fetch(imageUrl(s, "../../.werk/log.jsonl"))).status).toBe(404);
    await composer(page).fill("/");
    await expect(page.getByRole("listbox")).toBeVisible();
  }, page);
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "shot.png" }]);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    release();
    await expect(chips(page).locator("img")).toBeVisible();
    await expect(chips(page).locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    await composer(page).fill(`${await composer(page).inputValue()} Why is this red?`);
    await composer(page).press("Enter");
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log).toContainText("Why is this red?");
    await expect.poll(() => s.messages().length).toBe(1);
    const turn = lastTurn(s);
    expect(turn).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
    expect(turn).toMatch(/Open each image above with Read/i);
    expect(turn).not.toContain(PNG_B64);
    expect(turn).not.toMatch(/iVBOR/);
    await expect(log.locator("img")).toHaveCount(1);
  }, page);
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "small.png" }]);
    await expect(chips(page).locator("img")).toHaveCount(1);
    await paste(page, [{ kind: "big", name: "big.png" }]);
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(0).locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    await expect(chips(page).nth(1).locator("[data-slot=image-reason]")).toContainText(/larger than 20 ?MB/);
    await chips(page).nth(1).getByRole("button", { name: /Remove/ }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).fill(`${await composer(page).inputValue()} Why is this red?`);
    await composer(page).press("Enter");
    await expect.poll(() => s.messages().length).toBe(1);
    const turn = lastTurn(s);
    expect(turn.match(/\[Image #\d+\] = /g)).toHaveLength(1);
    expect(turn).toContain("[Image #1] = ");
    expect(turn).not.toContain("[Image #2]");
    expect(stored(s)).toHaveLength(1);
  }, page);
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "a.png" }]);
    await expect(chips(page).locator("img")).toHaveCount(1);
    await paste(page, [{ kind: "png", name: "b.png" }]);
    await expect(chips(page).locator("img")).toHaveCount(2);
    const keptSrc = await chips(page).nth(1).locator("img").getAttribute("src");
    await expect(composer(page)).toHaveValue(/\[Image #1\][\s\S]*\[Image #2\]/);
    await chips(page).nth(0).getByRole("button", { name: /Remove \[Image #1\]/ }).click();
    await expect(chips(page).locator("[data-slot=image-token]")).toHaveText("[Image #1]");
    const text = await composer(page).inputValue();
    expect(text.match(/\[Image #1\]/g)?.length).toBe(1);
    expect(text).not.toContain("[Image #2]");
    await composer(page).press("Enter");
    await expect.poll(() => s.messages().length).toBe(1);
    const name = new URL(keptSrc as string, s.origin).searchParams.get("name") as string;
    expect(lastTurn(s)).toContain(name);
    expect(lastTurn(s)).toMatch(/\[Image #1\] = /);
    expect(lastTurn(s)).not.toContain("[Image #2]");
  }, page);
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "shot.png" }]);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await composer(page).fill(`${await composer(page).inputValue()} Why is this red?`);
    await composer(page).press("Enter");
    await page.waitForTimeout(1500);
    expect(s.messages()).toHaveLength(0);
    release();
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => s.messages().length).toBe(1);
    expect(lastTurn(s)).toMatch(/\[Image #1\] = \S+\.png/);
  }, page);
});

test("25.5 an image request with no name answers 404 and the server stays up", async ({ page }) => {
  await withApp(async (s) => {
    await paste(page, [{ kind: "png", name: "shot.png" }]);
    await expect(chips(page).locator("img")).toBeVisible();
    expect((await fetch(imageUrl(s, ""))).status).toBe(404);
    expect((await fetch(imageUrl(s, "..%2F..%2F.werk%2Flog.jsonl"))).status).toBe(404);
    await paste(page, [{ kind: "png", name: "again.png" }]);
    await expect(chips(page).locator("img")).toHaveCount(2);
    await composer(page).fill(`${await composer(page).inputValue()} still works`);
    await composer(page).press("Enter");
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Seen it");
  }, page);
});
