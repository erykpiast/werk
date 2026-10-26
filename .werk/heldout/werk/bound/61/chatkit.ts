import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { expect } from "./fixtures.ts";
import { type BrowserServer, startBrowserServer } from "./server.ts";

export const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function withServer(script: Script | undefined, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer(script ? { script } : {});
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const composer = composerOf(page);
  await composer.fill(text);
  await composer.press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
export const launchArgs = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

/** A JPEG made from the PNG with sips (macOS). Returns its base64. */
export function jpegBase64(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-jpg-"));
  const png = join(dir, "a.png");
  require("node:fs").writeFileSync(png, Buffer.from(PNG_BASE64, "base64"));
  const out = join(dir, "a.jpg");
  execFileSync("sips", ["-s", "format", "jpeg", png, "--out", out], { stdio: "ignore" });
  return readFileSync(out).toString("base64");
}

type Kind = { base64?: string; mime?: string; name?: string; size?: number; how?: "paste" | "drop" };

/** Pastes or drops one image into the composer. `size` pads the file with zeros to that many bytes. */
export async function addImage(page: Page, kind: Kind = {}) {
  await composerOf(page).focus();
  await page.evaluate(
    ({ base64, mime, name, size, how }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? bytes.length);
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], name, { type: mime }));
      if (how === "drop") {
        const target = document.querySelector("[data-slot=composer]") as HTMLElement;
        target.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      } else {
        const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
        document.querySelector("textarea")?.dispatchEvent(event);
      }
    },
    {
      base64: kind.base64 ?? PNG_BASE64,
      mime: kind.mime ?? "image/png",
      name: kind.name ?? "shot.png",
      size: kind.size ?? null,
      how: kind.how ?? "paste",
    },
  );
}

export const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
export { expect };
