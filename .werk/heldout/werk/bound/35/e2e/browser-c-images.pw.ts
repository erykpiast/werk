import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { type Page, type Route, expect, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
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

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// A 1x1 JPEG.
const JPG_B64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const ACK: Script = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen2")]] } } };

async function withApp(
  script: Script | undefined,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer(script ? { script } : {});
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

type Img = { kind: "png" | "jpeg"; size?: number };

/** Pastes one image as a clipboard with one file. */
async function paste(page: Page, img: Img) {
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.evaluate(
    ({ b64, size, type }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? raw.length);
      data.set(raw);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "shot", { type }));
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    {
      b64: img.kind === "png" ? PNG_B64 : JPG_B64,
      size: img.size ?? null,
      type: img.kind === "png" ? "image/png" : "image/jpeg",
    },
  );
}

async function drop(page: Page, img: Img) {
  await page.evaluate(
    ({ b64, size, type }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? raw.length);
      data.set(raw);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "shot", { type }));
      document.querySelector("[data-slot=composer]")?.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    {
      b64: img.kind === "png" ? PNG_B64 : JPG_B64,
      size: img.size ?? null,
      type: img.kind === "png" ? "image/png" : "image/jpeg",
    },
  );
}

const composer = (p: Page) => p.getByRole("textbox", { name: "Message" });
const chips = (p: Page) => p.getByRole("list", { name: "Attached images" });
const chat = (p: Page) => p.getByRole("complementary", { name: "Chat pane" });
const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachments = (s: BrowserServer) => {
  const dir = join(s.dir, ".werk", "attachments");
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => !n.startsWith("."))
    : [];
};

/** Holds image uploads until release() is called. */
async function holdUploads(page: Page) {
  const held: Route[] = [];
  let open = false;
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST" && !open) held.push(route);
    else await route.continue();
  });
  return async () => {
    open = true;
    for (const r of held.splice(0)) await r.continue();
  };
}

test("24.1 hash menu picks a card", async ({ page }) => {
  await withApp(ACK, async (server) => {
    server.werk("add", "werk-shots", "--title", "Pasted screenshots");
    server.werk("accept", "werk-shots", "--actor", "you");
    await page.goto(server.url);
    const box = composer(page);
    await box.click();
    await box.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox", { name: "Cards" });
    await expect(menu).toBeVisible();
    const row = menu.getByRole("option").filter({ hasText: "werk-shots" });
    await expect(row).toContainText("Pasted screenshots");
    // Move with the arrow keys to werk-shots, then Enter.
    for (let i = 0; i < 5; i++) {
      if ((await row.getAttribute("aria-selected")) === "true") break;
      await box.press("ArrowDown");
    }
    await expect(row).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(box).toHaveValue(/^Look at #werk-shots\s*$/);
    await expect(menu).toHaveCount(0);
    // A backtick before the hash opens no menu.
    await box.fill("");
    await box.pressSequentially("`#wer");
    await expect(page.getByRole("listbox", { name: "Cards" })).toHaveCount(0);
  });
});

test("24.2 pasted PNG uploads and reaches the agent as a stored path", async ({
  page,
}) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    const release = await holdUploads(page);
    const box = composer(page);
    await box.click();
    await box.pressSequentially("What is wrong here? ");
    await paste(page, { kind: "png" });
    await expect(box).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await release();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await box.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: server.dir,
      encoding: "utf8",
    }).stdout;
    expect(st).not.toContain("attachments");
  });
});

test("24.3 oversized dropped image is refused and not sent", async ({ page }) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    await drop(page, { kind: "png", size: 25 * 1024 * 1024 });
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer(page).press("Enter");
    // The text was only the refused token, so what a send carries is empty; add words and send.
    await composer(page).pressSequentially(" hello");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toContain("[Image");
    expect(text).not.toMatch(/attachments/);
    expect(attachments(server)).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, { kind: "jpeg" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page).getByRole("img")).toHaveAttribute("src", /\.jpg$/);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const script: Script = {
    roles: {
      chat: {
        replies: [
          [
            { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } },
            say("m1", "Seen"),
          ],
        ],
      },
    },
  };
  await withApp(script, async (server) => {
    const base = `${server.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../../../etc/passwd")}`)).status).toBe(404);
    await page.goto(server.url);
    // A conversation is open: the agent has started and named its commands.
    await composer(page).fill("hi");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
  });
});

test("25.1 pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
}) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    const release = await holdUploads(page);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await release();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // The sent message shows the image under its token.
    await expect(chat(page).getByRole("img")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain(PNG_B64);
  });
});

test("25.2 oversized image shows refusal and is not sent", async ({ page }) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    await paste(page, { kind: "png", size: 2 * 1024 * 1024 });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    await paste(page, { kind: "png", size: 25 * 1024 * 1024 });
    const items = chips(page).getByRole("listitem");
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await items.nth(1).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect(attachments(server)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    const names = attachments(server);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const value = await composer(page).inputValue();
    expect(value.match(/\[Image #1\]/g)?.length).toBe(1);
    expect(value).not.toContain("[Image #2]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page)).not.toContainText("[Image #2]");
    const second = await chips(page).getByRole("img").getAttribute("src");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    const sent = /\[Image #1\] = (.+)/.exec(text ?? "")?.[1] ?? "";
    expect(names.length).toBe(2);
    // The path in the turn is the image that stayed (the second upload).
    const stayed = decodeURIComponent((second ?? "").split("name=")[1] ?? "");
    expect(sent).toContain(stayed);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    const release = await holdUploads(page);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    // The message does not go out while the chip shows a spinner.
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    expect(messages(server)).toHaveLength(0);
    await release();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  });
});

test("25.5 empty or climbing image name answers 404 and the server stays up", async ({
  page,
}) => {
  await withApp(ACK, async (server) => {
    await page.goto(server.url);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toBeVisible();
    const base = `${server.origin}/api/projects/project/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    await paste(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
  });
});
