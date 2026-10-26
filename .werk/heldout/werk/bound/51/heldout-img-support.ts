import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});

export async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
export const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

/** Pastes one file into the composer, or drops it when `how` is "drop". */
export async function putImage(
  page: Page,
  opts: { bytes?: number | null; type?: string; name?: string; how?: "paste" | "drop"; base64?: string } = {},
) {
  await composerOf(page).focus();
  await page.evaluate(
    ({ base64, size, type, name, how }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? png.length);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], name, { type }));
      const target = document.querySelector("textarea");
      const event =
        how === "drop"
          ? new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true })
          : new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
      target?.dispatchEvent(event);
    },
    {
      base64: opts.base64 ?? PNG_BASE64,
      size: opts.bytes ?? null,
      type: opts.type ?? "image/png",
      name: opts.name ?? "shot.png",
      how: opts.how ?? "paste",
    },
  );
}

export const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
