import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { expect, test } from "./fixtures.ts";
import type { Server } from "./server.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});
const START = {
  event: {
    type: "system",
    subtype: "init",
    slash_commands: ["review", "recall"],
  },
};
const script = (...texts: string[]): Script => ({
  roles: {
    chat: {
      replies: texts.map((t, i) => [START, say(`m${i}`, t)]),
    },
  },
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

type Kind = "png" | "jpeg";
type Mode = "paste" | "drop";

/** Puts one image file into the composer, as a paste of a clipboard or as a drop on the composer. */
async function put(
  page: Page,
  kind: Kind = "png",
  size?: number,
  mode: Mode = "paste",
) {
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.evaluate(
    ({ b64, mime, size, mode }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? raw.length);
      data.set(raw);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([data], mime === "image/png" ? "shot.png" : "shot.jpg", {
          type: mime,
        }),
      );
      if (mode === "paste") {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        const target = document.querySelector("[data-slot=composer]");
        target?.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    {
      b64: kind === "png" ? PNG : JPEG,
      mime: kind === "png" ? "image/png" : "image/jpeg",
      size,
      mode,
    },
  );
}

const composerOf = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });
const chipsOf = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
const chatOf = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
const turns = (app: Server) =>
  app.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachments = (app: Server) => join(app.dir, ".werk", "attachments");
const stored = (app: Server) =>
  existsSync(attachments(app))
    ? readdirSync(attachments(app)).filter((n) => n !== ".gitignore")
    : [];
const MB = 1024 * 1024;
const delayUploads = (page: Page, ms: number) =>
  page.route("**/image", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
const nameFrom = (src: string | null) =>
  new URL(src ?? "", "http://x").searchParams.get("name");

// ---- 24 -----------------------------------------------------------------

test("24.1 pick a card from the hash menu", async ({ page, withScript }) => {
  const app = await withScript(script("hi"));
  appendFileSync(
    join(app.dir, ".werk", "log.jsonl"),
    `${open("werk-shots", { title: "Pasted screenshots", parent: "root" })
      .map((e) => JSON.stringify(e))
      .join("\n")}\n`,
  );
  await page.goto(app.url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const composer = composerOf(page);
  await composer.pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const option = page.getByRole("option", { name: /werk-shots/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText("Pasted screenshots");
  // the menu opens below the caret
  const menuBox = await menu.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(menuBox && composerBox).toBeTruthy();
  expect(menuBox?.y ?? 0).toBeGreaterThanOrEqual(
    (composerBox?.y ?? 0) + (composerBox?.height ?? 0) / 2,
  );
  for (let i = 0; i < 5; i++) {
    if ((await option.getAttribute("aria-selected")) === "true") break;
    await composer.press("ArrowDown");
  }
  await composer.press("Enter");
  await expect(composer).toHaveValue(/^Look at #werk-shots ?$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await composer.fill("`#wer");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await delayUploads(page, 1500);
  const composer = composerOf(page);
  await composer.pressSequentially("What is wrong here? ");
  await put(page, "png");
  await expect(composer).toHaveValue("What is wrong here? [Image #1]");
  await expect(chipsOf(page)).toContainText("[Image #1]");
  await expect(chipsOf(page).locator("[data-state=uploading]")).toHaveCount(1);
  await expect(chipsOf(page).getByRole("img")).toBeVisible({ timeout: 15000 });
  await composer.press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
  const [text] = turns(app);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).toMatch(/open (each|that) image/i);
  const git = spawnSync("git", ["status", "--porcelain", "-uall"], {
    cwd: app.dir,
    encoding: "utf8",
  });
  expect(stored(app)).toHaveLength(1);
  expect(git.stdout).not.toContain("attachments");
});

test("24.3 an oversized image is refused and is not sent", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Ok"));
  await page.goto(app.url);
  await put(page, "png", 25 * MB, "drop");
  await expect(composerOf(page)).toHaveValue("[Image #1]");
  await expect(chipsOf(page).getByRole("alert")).toContainText("20 MB");
  await composerOf(page).pressSequentially(" hello");
  await composerOf(page).press("Enter");
  await expect(chatOf(page).getByText("Ok")).toBeVisible();
  const [text] = turns(app);
  expect(text).not.toMatch(/\[Image #1\] = /);
  expect(stored(app)).toHaveLength(0);
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await put(page, "png");
  await put(page, "jpeg");
  const composer = composerOf(page);
  await expect(composer).toHaveValue("[Image #1][Image #2]");
  await expect(chipsOf(page).getByRole("img")).toHaveCount(2);
  await chipsOf(page)
    .getByRole("button", { name: "Remove [Image #1]" })
    .click();
  await expect(composer).toHaveValue("[Image #1]");
  await expect(chipsOf(page).getByRole("listitem")).toHaveCount(1);
  await expect(chipsOf(page).getByRole("img")).toHaveAttribute("src", /\.jpg/);
  await composer.pressSequentially(" look");
  await composer.press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
  const [text] = turns(app);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
  expect(text).not.toContain("[Image #2]");
});

test("24.5 a bad image request does not harm the server", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("hi"));
  await page.goto(app.url);
  const project = new URL(app.url).pathname.split("/").pop();
  const api = `${app.origin}/api/projects/${project}/image`;
  expect((await fetch(`${api}?name=`)).status).toBe(404);
  const climb = await fetch(`${api}?name=..%2F..%2Flog.jsonl`);
  expect(climb.status).toBe(404);
  expect(await climb.text()).not.toContain("node.proposed");
  const climb2 = await fetch(`${api}?name=..%2Flog.jsonl`);
  expect(climb2.status).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const composer = composerOf(page);
  // The conversation is open: the person has sent one message and the agent has started.
  await composer.fill("hi");
  await composer.press("Enter");
  await expect(chatOf(page).getByText("hi", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("idle")).toBeVisible();
  await composer.pressSequentially("/");
  await expect(page.getByRole("option")).toHaveText(["/review", "/recall"]);
});

// ---- 25 -----------------------------------------------------------------

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await delayUploads(page, 1200);
  await put(page, "png");
  await expect(chipsOf(page).locator("[data-state=uploading]")).toHaveCount(1);
  await expect(chipsOf(page).locator("[data-slot=spinner]")).toBeVisible();
  await expect(composerOf(page)).toHaveValue(/\[Image #1\]/);
  const thumb = chipsOf(page).getByRole("img");
  await expect(thumb).toBeVisible({ timeout: 15000 });
  await expect(chipsOf(page)).toContainText("[Image #1]");
  await composerOf(page).pressSequentially(" Why is this red?");
  await composerOf(page).press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
  const log = chatOf(page).getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("Why is this red?");
  await expect(log.getByRole("img")).toHaveCount(1);
  const [text] = turns(app);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).toContain("Read");
  expect(text).not.toContain(PNG);
});

test("25.2 an oversized image shows its refusal and is not sent", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await put(page, "png", 2 * MB);
  await expect(chipsOf(page).getByRole("img")).toHaveCount(1, {
    timeout: 15000,
  });
  await put(page, "png", 25 * MB);
  const items = chipsOf(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("[Image #1]");
  await expect(items.nth(0).getByRole("img")).toBeVisible();
  await expect(items.nth(1).getByRole("alert")).toContainText(
    /larger than 20 MB/,
  );
  await chipsOf(page)
    .getByRole("button", { name: "Remove [Image #2]" })
    .click();
  await expect(composerOf(page)).not.toHaveValue(/\[Image #2\]/);
  await composerOf(page).pressSequentially(" Why is this red?");
  await composerOf(page).press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
  const [text] = turns(app);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  expect(text).not.toContain("[Image #2]");
  expect(stored(app)).toHaveLength(1);
});

test("25.3 removing a chip renumbers the remaining images", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await put(page, "png");
  await put(page, "png");
  const composer = composerOf(page);
  await expect(composer).toHaveValue("[Image #1][Image #2]");
  const imgs = chipsOf(page).getByRole("img");
  await expect(imgs).toHaveCount(2);
  const keep = nameFrom(await imgs.nth(1).getAttribute("src"));
  await chipsOf(page)
    .getByRole("button", { name: "Remove [Image #1]" })
    .click();
  await expect(chipsOf(page).getByRole("listitem")).toHaveCount(1);
  await expect(chipsOf(page)).toContainText("[Image #1]");
  const value = await composer.inputValue();
  expect(value.split("[Image #1]").length - 1).toBe(1);
  expect(value).not.toContain("[Image #2]");
  await composer.pressSequentially(" what");
  await composer.press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
  const [text] = turns(app);
  expect(text).toContain(`[Image #1] = `);
  expect(text).toContain(keep as string);
});

test("25.4 Enter waits for a running upload", async ({ page, withScript }) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  await delayUploads(page, 2500);
  await put(page, "png");
  await expect(chipsOf(page).locator("[data-state=uploading]")).toHaveCount(1);
  await composerOf(page).pressSequentially(" a question");
  await composerOf(page).press("Enter");
  expect(turns(app)).toHaveLength(0);
  // The send that waited goes out by itself once the upload answers.
  await expect(chatOf(page).getByText("Seen")).toBeVisible({ timeout: 15000 });
  const [text] = turns(app);
  expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script("Seen"));
  await page.goto(app.url);
  const project = new URL(app.url).pathname.split("/").pop();
  const api = `${app.origin}/api/projects/${project}/image`;
  await put(page, "png");
  await expect(chipsOf(page).getByRole("img")).toBeVisible({ timeout: 15000 });
  expect((await fetch(`${api}?name=`)).status).toBe(404);
  expect((await fetch(`${api}?name=..%2F..%2F..%2Fetc%2Fpasswd`)).status).toBe(
    404,
  );
  await put(page, "png");
  await expect(chipsOf(page).getByRole("img")).toHaveCount(2, {
    timeout: 15000,
  });
  await composerOf(page).pressSequentially(" hi");
  await composerOf(page).press("Enter");
  await expect(chatOf(page).getByText("Seen")).toBeVisible();
});
