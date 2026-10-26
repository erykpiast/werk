import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export async function withChat(
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

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const box = composer(page);
  await box.fill(text);
  await box.press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A clipboard paste of one image file of the given size (null: the tiny PNG). */
export async function pasteImage(
  page: Page,
  size: number | null = null,
  type = "image/png",
) {
  await composer(page).focus();
  await page.evaluate(
    ({ base64, size, type }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? png.length);
      data.set(type === "image/jpeg" ? [0xff, 0xd8, 0xff, 0xe0] : png);
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
    { base64: PNG_BASE64, size, type },
  );
}

export async function dropImage(page: Page, size: number) {
  await page.evaluate(
    ({ base64, size }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "big.png", { type: "image/png" }));
      document.querySelector("[data-slot=composer]")?.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { base64: PNG_BASE64, size },
  );
}

export const chips = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
