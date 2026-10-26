import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export { expect, test } from "../../e2e/support/fixtures.ts";
export type { BrowserServer, Script };

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export async function withChat(
  script: Script | undefined,
  body: (server: BrowserServer) => Promise<void>,
  prepare?: (server: BrowserServer) => void,
) {
  const server = await startBrowserServer(script ? { script } : {});
  try {
    prepare?.(server);
    await server.start();
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
export const leftPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });
export const composerOf = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const composer = composerOf(page);
  await composer.fill(text);
  await composer.press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
export const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export type Shot = { kind: "png"; size?: number } | { kind: "jpeg" };

/** Gives the page a File for a shot. The file goes into a DataTransfer that the caller uses. */
async function transferScript(page: Page, shot: Shot, target: "paste" | "drop") {
  await page.evaluate(
    async ({ shot, base64, target }) => {
      let data: Uint8Array;
      let type: string;
      if (shot.kind === "jpeg") {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 3;
        const g = canvas.getContext("2d") as CanvasRenderingContext2D;
        g.fillStyle = "#c00";
        g.fillRect(0, 0, 4, 3);
        const blob = await new Promise<Blob>((r) =>
          canvas.toBlob((b) => r(b as Blob), "image/jpeg"),
        );
        data = new Uint8Array(await blob.arrayBuffer());
        type = "image/jpeg";
      } else {
        const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        data = new Uint8Array(shot.size ?? png.length);
        data.set(png);
        type = "image/png";
      }
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([data as BlobPart], type === "image/png" ? "shot.png" : "shot.jpg", { type }),
      );
      if (target === "paste") {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        document.querySelector("[data-slot=composer]")?.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { shot, base64: PNG_BASE64, target },
  );
}

export async function pasteShot(page: Page, shot: Shot = { kind: "png" }) {
  await composerOf(page).focus();
  await transferScript(page, shot, "paste");
}
export async function dropShot(page: Page, shot: Shot = { kind: "png" }) {
  await transferScript(page, shot, "drop");
}

export const chips = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });

/** The stored names of the thumbnails in the chip list, in order. */
export async function thumbNames(page: Page): Promise<string[]> {
  return chips(page)
    .getByRole("img")
    .evaluateAll((imgs) =>
      imgs.map((i) =>
        decodeURIComponent(
          new URL((i as HTMLImageElement).src).searchParams.get("name") ?? "",
        ),
      ),
    );
}

export const attachmentsDir = (server: BrowserServer) =>
  join(server.dir, ".werk", "attachments");
export function storedFiles(server: BrowserServer): string[] {
  const dir = attachmentsDir(server);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitignore") : [];
}

export const apiUrl = (server: BrowserServer, path: string) =>
  `${server.origin}/api/projects/project${path}`;
