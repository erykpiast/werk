import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test as base } from "../e2e/support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";
import type { Script } from "../src/fake-agent/script.ts";

export { expect } from "../e2e/support/fixtures.ts";
export const test = base;
export { startBrowserServer, type BrowserServer };

export const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});

export async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
  options: { appCopy?: boolean } = {},
) {
  const server = await startBrowserServer({ script, ...options });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
export const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
export const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  const composer = composerOf(page);
  await composer.fill(text);
  await composer.press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
export const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

/** Appends events to the project's map log, as an agent's command would. */
export function appendLog(server: BrowserServer, ...events: unknown[]) {
  appendFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const decideEvents = (id: string) => [
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

/** A value that a reload erases: it proves that the page did not reload. */
export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

/** Pastes (or drops) one image file made in the page, as a clipboard (or drop) with one file. */
export async function giveImage(
  page: Page,
  opts: { type?: "png" | "jpeg"; bytes?: number; how?: "paste" | "drop"; color?: string } = {},
) {
  await composerOf(page).focus();
  await page.evaluate(
    async ({ type, bytes, how, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 8, 8);
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob((b) => res(b as Blob), `image/${type}`),
      );
      let data = new Uint8Array(await blob.arrayBuffer());
      if (bytes && bytes > data.length) {
        const padded = new Uint8Array(bytes);
        padded.set(data);
        data = padded;
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], `shot.${type}`, { type: `image/${type}` }));
      if (how === "drop") {
        const event = new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
        document.querySelector("[data-slot=composer]")?.dispatchEvent(event);
      } else {
        const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
        document.querySelector("textarea")?.dispatchEvent(event);
      }
    },
    { type: opts.type ?? "png", bytes: opts.bytes ?? 0, how: opts.how ?? "paste", color: opts.color ?? "#c33" },
  );
}
