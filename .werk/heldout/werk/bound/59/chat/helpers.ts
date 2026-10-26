import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export const say = (id: string, text: string, usage?: object) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {}),
    },
  },
});

export async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

export const argAfter = (args: string[], flag: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;

/** Adds cards to the project's map log. A card has an id, a title and a parent. */
export function addCards(
  server: BrowserServer,
  cards: { id: string; title: string }[],
) {
  const lines = cards
    .flatMap((c) => [
      JSON.stringify({
        type: "node.proposed",
        id: c.id,
        kind: "card",
        title: c.title,
        status: "open",
        parent: "root",
      }),
      JSON.stringify({ type: "node.accepted", id: c.id, actor: "you" }),
    ])
    .join("\n");
  appendFileSync(join(server.dir, ".werk", "log.jsonl"), `${lines}\n`);
}

export const attachmentsDir = (server: BrowserServer) =>
  join(server.dir, ".werk", "attachments");

export const storedImages = (server: BrowserServer) => {
  const dir = attachmentsDir(server);
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => !n.startsWith("."))
    : [];
};

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=";

/**
 * Builds one image file in the page and hands it to the composer, as a paste or as a drop.
 * "png" is a 1x1 PNG. A number is a PNG padded with zero bytes to that size. "jpeg" is a 1x1 JPEG.
 */
export async function giveImage(
  page: Page,
  kind: "png" | "jpeg" | number,
  how: "paste" | "drop" = "paste",
) {
  await composer(page).focus();
  await page.evaluate(
    ({ png64, jpg64, kind, how }) => {
      const bytes64 = (b: string) =>
        Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      let data: Uint8Array;
      let type = "image/png";
      if (kind === "jpeg") {
        data = bytes64(jpg64);
        type = "image/jpeg";
      } else if (typeof kind === "number") {
        const png = bytes64(png64);
        data = new Uint8Array(Math.max(kind, png.length));
        data.set(png);
      } else data = bytes64(png64);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data as BlobPart], "shot", { type }));
      if (how === "paste") {
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
          new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
        target?.dispatchEvent(
          new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    },
    { png64: PNG_BASE64, jpg64: JPEG_BASE64, kind, how },
  );
}

export const pasteImage = giveImage;

/** Holds each image upload for `ms`, so a test can look at the chip while it still spins. */
export async function slowUploads(page: Page, ms: number) {
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((r) => setTimeout(r, ms));
    }
    await route.continue();
  });
}

/** The stored name that a chip's thumbnail asks for. */
export async function thumbName(img: import("@playwright/test").Locator) {
  const src = (await img.getAttribute("src")) ?? "";
  return new URL(src, "http://x").searchParams.get("name") ?? "";
}

export const readLog = (server: BrowserServer) =>
  readFileSync(join(server.dir, ".werk", "log.jsonl"), "utf8");
