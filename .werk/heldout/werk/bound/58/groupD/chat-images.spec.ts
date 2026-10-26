import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const start = {
  event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] },
};

async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

async function paste(page: Page, kind: "png" | "jpeg" | number, delayMs = 0) {
  await composerOf(page).focus();
  await page.evaluate(
    ({ base64, kind, delayMs }) => {
      let data: Uint8Array;
      let type = "image/png";
      if (kind === "jpeg") {
        type = "image/jpeg";
        data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
      } else {
        const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        data = typeof kind === "number" ? new Uint8Array(kind) : png;
        if (typeof kind === "number") data.set(png);
      }
      if (delayMs) {
        const orig = window.fetch;
        window.fetch = async (...a) => {
          await new Promise((r) => setTimeout(r, delayMs));
          return orig(...a);
        };
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([data as BlobPart], "shot", { type }));
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64: PNG_BASE64, kind, delayMs },
  );
}
const attachments = (s: BrowserServer) => {
  const dir = join(s.dir, ".werk", "attachments");
  return existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : [];
};
const thumbLoaded = (page: Page) =>
  expect
    .poll(() => chips(page).getByRole("img").first().evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);

test("24.1 hash menu", async ({ page }) => {
  const server = await startBrowserServer({ script: { roles: { chat: { replies: [[say("m", "x")]] } } } });
  appendFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open" })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
  );
  await server.start();
  try {
    await page.goto(server.url);
    const c = composerOf(page);
    await c.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu).toContainText("werk-shots");
    await expect(menu).toContainText("Pasted screenshots");
    await c.press("ArrowDown");
    await c.press("ArrowUp");
    await c.press("Enter");
    await expect(c).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await c.fill("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  } finally {
    await server.dispose();
  }
});

test("24.2 pasted PNG uploads and reaches agent as path", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    const c = composerOf(page);
    await c.pressSequentially("What is wrong here? ");
    await paste(page, "png");
    await expect(c).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toContainText("[Image #1]");
    await thumbLoaded(page);
    await c.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text.toLowerCase()).toMatch(/open .*image/);
    const status = (await import("node:child_process")).spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(status).not.toContain("attachments");
  });
});

test("24.3 oversized image refused and not sent", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, 25 * 1024 * 1024);
    await expect(composerOf(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page).getByRole("alert")).toContainText(/20 MB/);
    await composerOf(page).press("Enter");
    // The refused token is dropped; nothing else was typed, so any turn must carry no path.
    for (const m of messages(server)) expect(m).not.toMatch(/\.werk\/attachments/);
    expect(attachments(server)).toEqual([]);
  });
});

test("24.4 removing first of two renumbers", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await paste(page, "jpeg");
    const c = composerOf(page);
    await expect(c).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(c).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await expect(chips(page)).not.toContainText("[Image #2]");
    await c.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Ok")).toBeVisible();
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.jpe?g/);
  });
});

test("24.5 bad image requests answer 404 and the server stays up", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    const get = (q: string) => fetch(`${server.origin}/api/projects/project/image?name=${q}`);
    expect((await get("")).status).toBe(404);
    const up = await get("..%2F..%2Flog.jsonl");
    expect(up.status).toBe(404);
    expect(await up.text()).not.toContain("node.proposed");
    expect((await get("../../log.jsonl")).status).toBe(404);
    await composerOf(page).press("Enter"); // no-op
    await composerOf(page).fill("hi");
    await composerOf(page).press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Hello")).toBeVisible();
    await composerOf(page).pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).not.toHaveCount(0);
  });
});

test("25.1 pasted screenshot becomes a numbered image", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png", 1500);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await expect(composerOf(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page).locator("[data-slot=spinner]")).toHaveCount(0);
    await thumbLoaded(page);
    await expect(chips(page)).toContainText("[Image #1]");
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("Seen")).toBeVisible();
    await expect(chat.getByText("[Image #1]").first()).toBeVisible();
    await expect(chat.getByRole("img")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).toContain("Read");
    expect(text).not.toContain(PNG_BASE64);
  });
});

test("25.2 oversized image refused beside a good one", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, 2 * 1024 * 1024);
    await paste(page, 25 * 1024 * 1024);
    const items = chips(page).locator("[data-slot=image-chip]");
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await items.nth(1).getByRole("button", { name: /Remove/ }).click();
    await expect(composerOf(page)).not.toHaveValue(/\[Image #2\]/);
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await paste(page, "png");
    await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await composerOf(page).press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*attachments/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png", 2500);
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    await composerOf(page).pressSequentially(" a question");
    await composerOf(page).press("Enter");
    expect(messages(server)).toEqual([]);
    await expect(chips(page).locator("[data-slot=spinner]")).toHaveCount(0);
    await expect.poll(() => messages(server).length).toBe(1);
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*attachments/);
  });
});

test("25.5 empty and climbing names answer 404, chat still works", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await thumbLoaded(page);
    expect((await fetch(`${server.origin}/api/projects/project/image?name=`)).status).toBe(404);
    expect((await fetch(`${server.origin}/api/projects/project/image?name=..%2F..%2Flog.jsonl`)).status).toBe(404);
    await paste(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await composerOf(page).press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Ok")).toBeVisible();
  });
});
