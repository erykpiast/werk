import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { decided, link, open, ghost } from "../../src/map/mark-fixtures.ts";
import { type BrowserServer, type ServerOptions, startBrowserServer } from "./server.ts";

export { decided, link, open, ghost };

export const ROOT = { type: "node.proposed", id: "root", kind: "card", title: "Root", status: "open", why: "The top." };
export const ROOT_EVENTS = [ROOT, { type: "node.accepted", id: "root", actor: "you" }];

/** Starts a server, runs the body, and removes the server. */
export async function serve(
  options: ServerOptions,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer(options);
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
export const chatScript = (...replies: Script["roles"][string]["replies"]): Script => ({
  roles: { chat: { replies } },
});

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const left = (page: Page) => page.getByRole("region", { name: "Map pane" });
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}
export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
export const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Pastes one image into the composer as a clipboard with one file. A number is the size in bytes of a PNG. */
export async function pasteImage(page: Page, kind: "png" | "jpeg" | number = "png") {
  await composer(page).focus();
  await page.evaluate(
    async ({ base64, kind }) => {
      let file: File;
      if (kind === "jpeg") {
        const canvas = document.createElement("canvas");
        canvas.width = 3;
        canvas.height = 3;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "#c00";
        ctx.fillRect(0, 0, 3, 3);
        const blob = await new Promise<Blob>((done) =>
          canvas.toBlob((b) => done(b as Blob), "image/jpeg"),
        );
        file = new File([blob], "shot.jpg", { type: "image/jpeg" });
      } else {
        const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const data = new Uint8Array(typeof kind === "number" ? kind : png.length);
        data.set(png);
        file = new File([data], "shot.png", { type: "image/png" });
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64: PNG_BASE64, kind },
  );
}

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** Drops one PNG of the given size in bytes on the composer. */
export async function dropImage(page: Page, size: number) {
  await page.evaluate(
    ({ base64, size }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "big.png", { type: "image/png" }));
      document.querySelector("[data-slot=composer]")?.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64: PNG_BASE64, size },
  );
}

/** Delays each image upload, so a spinner stays on screen long enough to see. */
export async function slowUploads(page: Page, ms: number) {
  await page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}
