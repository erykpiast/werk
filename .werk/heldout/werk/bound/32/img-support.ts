import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { startBrowserServer, type BrowserServer } from "../e2e/support/server.ts";

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export const START = {
  event: {
    type: "system",
    subtype: "init",
    slash_commands: ["review", "recall"],
  },
};

export const OK_SCRIPT: Script = {
  roles: { chat: { replies: [[START, say("m1", "Seen")], [say("m2", "Seen")]] } },
};

export async function withServer(
  opts: { script?: Script; before?: (s: BrowserServer) => void },
  body: (s: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script: opts.script ?? OK_SCRIPT });
  opts.before?.(server);
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export const attachments = (s: BrowserServer) => {
  const dir = join(s.dir, ".werk", "attachments");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n !== ".gitignore") : [];
};

export const gitStatus = (s: BrowserServer) =>
  execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: s.dir,
    encoding: "utf8",
  });

export type Shot = { type?: "image/png" | "image/jpeg"; color?: string; pad?: number; name?: string };

/** Builds a real image in the page (canvas), pads it to a size, and hands it to the composer as paste or drop. */
export async function give(page: Page, how: "paste" | "drop", shot: Shot = {}) {
  await page.evaluate(
    async ({ how, shot }) => {
      const type = shot.type ?? "image/png";
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const g = canvas.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = shot.color ?? "red";
      g.fillRect(0, 0, 24, 24);
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b as Blob), type));
      const parts: BlobPart[] = [blob];
      if (shot.pad) parts.push(new Uint8Array(Math.max(0, shot.pad - blob.size)));
      const file = new File(parts, shot.name ?? (type === "image/png" ? "shot.png" : "shot.jpg"), { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      if (how === "paste") {
        const box = document.querySelector("textarea[data-composer]") as HTMLTextAreaElement;
        box.focus();
        box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        const zone = document.querySelector("[data-slot=composer]") as HTMLElement;
        zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
        zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    },
    { how, shot },
  );
}

export const chips = (page: Page) => page.locator("[data-slot=image-chip]");
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
export const MB = 1024 * 1024;
