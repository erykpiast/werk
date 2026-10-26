import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";

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

type Kind = "png" | "jpeg";

/** Builds a file in the page and hands it over as a paste or a drop on the composer. */
async function give(
  page: Page,
  how: "paste" | "drop",
  kind: Kind,
  size: number | null,
) {
  await composerOf(page).focus();
  await page.evaluate(
    ({ base64, size, kind, how }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const head = kind === "png" ? png : new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
      const data = new Uint8Array(size ?? head.length);
      data.set(head);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([data], kind === "png" ? "shot.png" : "shot.jpg", {
          type: kind === "png" ? "image/png" : "image/jpeg",
        }),
      );
      if (how === "paste") {
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
    { base64: PNG_BASE64, size, kind, how },
  );
}

export const pasteImage = (page: Page, kind: Kind = "png", size: number | null = null) =>
  give(page, "paste", kind, size);
export const dropImage = (page: Page, kind: Kind = "png", size: number | null = null) =>
  give(page, "drop", kind, size);

export const chips = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });

/** Holds each image upload for `ms` before it reaches the server: a slow network. */
export async function slowUploads(page: Page, ms: number) {
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    return route.continue();
  });
}
