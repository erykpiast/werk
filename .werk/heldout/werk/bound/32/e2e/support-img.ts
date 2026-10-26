import { type Page, expect } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export type ImageSpec = {
  kind?: "png" | "jpeg";
  /** Pads the file to this many bytes (the bytes after the image data are zeros). */
  size?: number;
  color?: string;
};

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export async function withServer(
  script: Script | undefined,
  body: (server: BrowserServer) => Promise<void>,
  before?: (server: BrowserServer) => void,
) {
  const server = await startBrowserServer(script ? { script } : {});
  before?.(server);
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const composerOf = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });
export const chipsOf = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

/** Builds an image file in the page and hands it over as a paste or as a drop. */
export async function giveImage(
  page: Page,
  how: "paste" | "drop",
  spec: ImageSpec = {},
) {
  if (how === "paste") await composerOf(page).focus();
  await page.evaluate(
    async ({ how, spec }) => {
      const kind = spec.kind ?? "png";
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const g = canvas.getContext("2d");
      if (g) {
        g.fillStyle = spec.color ?? "red";
        g.fillRect(0, 0, 8, 8);
      }
      const blob: Blob = await new Promise((done) =>
        canvas.toBlob((b) => done(b as Blob), `image/${kind}`),
      );
      const real = new Uint8Array(await blob.arrayBuffer());
      const bytes = new Uint8Array(Math.max(spec.size ?? 0, real.length));
      bytes.set(real);
      const file = new File([bytes], `shot.${kind}`, { type: `image/${kind}` });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (how === "paste") {
        document.querySelector("textarea")?.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        document.querySelector('[data-slot="composer"]')?.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { how, spec },
  );
}

export async function expectThumb(page: Page, index: number) {
  const thumb = chipsOf(page).getByRole("listitem").nth(index).getByRole("img");
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  return thumb;
}

export async function send(page: Page, text: string) {
  const composer = composerOf(page);
  await composer.pressSequentially(text);
  await composer.press("Enter");
}
