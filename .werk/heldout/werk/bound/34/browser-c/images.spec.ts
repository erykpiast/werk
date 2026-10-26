import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { type Page, test as base } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

const REPLY: Script = {
  roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } },
};

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const test = base.extend<{ server: BrowserServer }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern.
  server: async ({}, use) => {
    const server = await startBrowserServer({ script: REPLY });
    await server.start();
    await use(server);
    await server.dispose();
  },
});

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

/** Pastes an image file into the composer, as the browser's paste event does. */
async function paste(
  page: Page,
  kind: "png" | "jpeg",
  megabytes?: number,
) {
  await composer(page).evaluate(
    (el, a) => {
      const sig =
        a.kind === "png"
          ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
          : [0xff, 0xd8, 0xff];
      let bytes: Uint8Array;
      if (a.mb) {
        bytes = new Uint8Array(a.mb * 1024 * 1024);
        bytes.set(sig);
      } else {
        bytes = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
      }
      const dt = new DataTransfer();
      dt.items.add(
        new File([bytes], a.kind === "png" ? "s.png" : "s.jpg", {
          type: a.kind === "png" ? "image/png" : "image/jpeg",
        }),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { kind, mb: megabytes, b64: kind === "png" ? PNG_B64 : JPEG_B64 },
  );
}

const chips = (page: Page) => page.locator('[data-slot="image-chip"]');
const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachments = (server: BrowserServer) => join(server.dir, ".werk", "attachments");
const stored = (server: BrowserServer) =>
  existsSync(attachments(server))
    ? readdirSync(attachments(server)).filter((n) => n !== ".gitignore")
    : [];
const api = (server: BrowserServer, rest: string) =>
  `${server.origin}/api/projects/${encodeURIComponent(basename(server.dir))}${rest}`;

test("24.1 pick a card from the hash menu", async ({ page, server }) => {
  appendFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
  );
  await page.goto(server.url);
  await composer(page).click();
  await composer(page).pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox", { name: "Cards" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("#werk-shots");
  await expect(menu).toContainText("Pasted screenshots");
  await composer(page).press("ArrowDown");
  await composer(page).press("ArrowUp");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue(/^Look at #werk-shots/);
  await expect(menu).toHaveCount(0);
  await composer(page).fill("");
  await composer(page).pressSequentially("`#wer");
  await expect(page.getByRole("listbox", { name: "Cards" })).toHaveCount(0);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
  server,
}) => {
  await page.goto(server.url);
  await composer(page).click();
  await composer(page).pressSequentially("What is wrong here? ");
  await paste(page, "png");
  await expect(composer(page)).toHaveValue(/\[Image #1\]/);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator("img")).toBeVisible();
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const [turn] = messages(server);
  expect(turn).toMatch(/\[Image #1\] = .*attachments\/.*\.png/);
  expect(turn).toContain("Open each image above with Read");
  const r = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd: server.dir, encoding: "utf8" });
  expect(r.stdout).not.toContain("attachments");
});

test("24.3 an oversized image is refused and is not sent", async ({ page, server }) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png", 25);
  await expect(composer(page)).toHaveValue(/\[Image #1\]/);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator('[data-slot="image-reason"]')).toContainText(/20 MB/);
  await composer(page).pressSequentially("hello");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const [turn] = messages(server);
  expect(turn).not.toContain("[Image #1] =");
  expect(turn).not.toContain("attachments");
  expect(stored(server)).toEqual([]);
});

test("24.4 removing the first of two images renumbers the second", async ({ page, server }) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await expect(chips(page).nth(0).locator("img")).toBeVisible();
  await paste(page, "jpeg");
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1).locator("img")).toBeVisible();
  await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/);
  const jpegName = await chips(page).nth(1).locator("img").getAttribute("src");
  await page.getByRole("button", { name: "Remove [Image #1]" }).click();
  await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
  await expect(composer(page)).toHaveValue(/\[Image #1\]/);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator("img")).toHaveAttribute("src", jpegName ?? "");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const [turn] = messages(server);
  expect(turn).toMatch(/\[Image #1\] = .*\.jpg/);
  expect(turn).not.toContain("[Image #2]");
});

test("24.5 a bad image request does not harm the server", async ({ page, server }) => {
  const slash: Script = {
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "system",
                subtype: "init",
                session_id: "s1",
                slash_commands: ["help", "clear"],
              },
            },
            say("m1", "Seen"),
          ],
        ],
      },
    },
  };
  await server.stop();
  writeFileSync(join(server.dir, "..", "script.json"), JSON.stringify(slash));
  await server.start();
  await page.goto(server.url);
  await composer(page).fill("hello");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const empty = await page.request.get(api(server, "/image?name="));
  expect(empty.status()).toBe(404);
  const climb = await page.request.get(api(server, "/image?name=../log.jsonl"));
  expect(climb.status()).toBe(404);
  const climb2 = await page.request.get(api(server, "/image?name=..%2F..%2Fpackage.json"));
  expect(climb2.status()).toBe(404);
  await composer(page).click();
  await composer(page).pressSequentially("/");
  await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
  server,
}) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator('[data-slot="spinner"]').or(chips(page).locator("img"))).toBeVisible();
  await expect(composer(page)).toHaveValue(/\[Image #1\]/);
  await expect(chips(page).locator("img")).toBeVisible();
  await expect(chips(page).locator('[data-slot="image-token"]')).toHaveText("[Image #1]");
  await composer(page).pressSequentially("Why is this red?");
  await composer(page).press("Enter");
  const chat = page.getByRole("complementary", { name: "Chat pane" });
  await expect(chat.getByText("Why is this red?")).toBeVisible();
  // The sent message shows the image under its token.
  await expect(chat.locator("img")).toBeVisible();
  const [turn] = messages(server);
  expect(turn).toMatch(/\[Image #1\] = .*\/attachments\/.*\.png/);
  expect(turn).toContain("Read");
  expect(turn).not.toContain(PNG_B64);
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page, server }) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await expect(chips(page).nth(0).locator("img")).toBeVisible();
  await paste(page, "png", 25);
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1).locator('[data-slot="image-reason"]')).toContainText(/larger than 20 MB/);
  await page.getByRole("button", { name: "Remove [Image #2]" }).click();
  await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
  await composer(page).pressSequentially("Why is this red?");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const [turn] = messages(server);
  expect(turn).toMatch(/\[Image #1\] = /);
  expect(turn).not.toContain("[Image #2]");
  expect(stored(server).length).toBe(1);
});

test("25.3 removing a chip renumbers the remaining images", async ({ page, server }) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await paste(page, "jpeg");
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1).locator("img")).toBeVisible();
  await expect(chips(page).nth(0).locator("img")).toBeVisible();
  const kept = await chips(page).nth(1).locator("img").getAttribute("src");
  await page.getByRole("button", { name: "Remove [Image #1]" }).click();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).locator('[data-slot="image-token"]')).toHaveText("[Image #1]");
  const value = await composer(page).inputValue();
  expect(value.match(/\[Image #1\]/g)?.length).toBe(1);
  expect(value).not.toContain("[Image #2]");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const keptName = new URL(kept ?? "", "http://x").searchParams.get("name");
  const [turn] = messages(server);
  expect(turn).toContain(`[Image #1] = `);
  expect(turn).toContain(keptName ?? "?");
});

test("25.4 Enter waits for a running upload", async ({ page, server }) => {
  // The test slows the upload route, as a slow network would.
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await expect(chips(page).locator('[data-slot="spinner"]')).toBeVisible();
  await composer(page).pressSequentially("What is this?");
  await composer(page).press("Enter");
  expect(messages(server)).toEqual([]);
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
  const [turn] = messages(server);
  expect(turn).toMatch(/\[Image #1\] = .*\.png/);
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({
  page,
  server,
}) => {
  await page.goto(server.url);
  await composer(page).click();
  await paste(page, "png");
  await expect(chips(page).locator("img")).toBeVisible();
  const name = stored(server)[0] ?? "";
  const ok = await page.request.get(api(server, `/image?name=${name}`));
  expect(ok.status()).toBe(200);
  const empty = await page.request.get(api(server, "/image?name="));
  expect(empty.status()).toBe(404);
  const climb = await page.request.get(api(server, "/image?name=..%2F..%2Flog.jsonl"));
  expect(climb.status()).toBe(404);
  await paste(page, "png");
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1).locator("img")).toBeVisible();
  await composer(page).pressSequentially("hi");
  await composer(page).press("Enter");
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();
});
