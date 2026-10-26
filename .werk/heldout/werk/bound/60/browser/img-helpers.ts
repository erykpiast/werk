import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export const chatScript = (n = 3): Script => ({
  roles: {
    chat: {
      replies: Array.from({ length: n }, (_, i) => [
        {
          event: {
            type: "system",
            subtype: "init",
            slash_commands: ["review", "recall"],
          },
        },
        say(`m${i}`, `Answer ${i + 1}`),
      ]),
    },
  },
});

export async function withServer(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
  prepare?: (server: BrowserServer) => void,
) {
  const server = await startBrowserServer({ script });
  try {
    prepare?.(server);
    await server.start();
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export type ImageSpec = {
  type: "image/png" | "image/jpeg";
  /** A real decodable image of this colour, with random noise when `noise` is set. */
  color?: string;
  noise?: boolean;
  /** A file of this many bytes that starts like a PNG and does not decode. */
  bytes?: number;
};

/** Builds the image file in the page. */
const BUILD = `
async (spec) => {
  if (spec.bytes) {
    const data = new Uint8Array(spec.bytes);
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new File([data], "big.png", { type: spec.type });
  }
  const size = spec.noise ? 720 : 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = spec.color || "red";
  ctx.fillRect(0, 0, size, size);
  if (spec.noise) {
    const img = ctx.getImageData(0, 0, size, size);
    for (let o = 0; o < img.data.length; o += 65536) crypto.getRandomValues(img.data.subarray(o, o + 65536));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
  }
  const blob = await new Promise((r) => canvas.toBlob(r, spec.type));
  return new File([blob], spec.type === "image/png" ? "a.png" : "a.jpg", { type: spec.type });
}`;

export async function paste(page: Page, spec: ImageSpec) {
  await composer(page).focus();
  await page.evaluate(
    async ({ spec, build }) => {
      const make = (0, eval)(`(${build})`);
      const file: File = await make(spec);
      const data = new DataTransfer();
      data.items.add(file);
      const box = document.querySelector("textarea[data-composer]");
      box?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { spec, build: BUILD },
  );
}

export async function drop(page: Page, spec: ImageSpec) {
  await page.evaluate(
    async ({ spec, build }) => {
      const make = (0, eval)(`(${build})`);
      const file: File = await make(spec);
      const data = new DataTransfer();
      data.items.add(file);
      const target = document.querySelector("[data-slot=composer]");
      target?.dispatchEvent(
        new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
      );
    },
    { spec, build: BUILD },
  );
}

/** Holds each image upload for `ms`, so a test can see the spinner. */
export async function slowUploads(page: Page, ms: number) {
  await page.route("**/image", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

export const chips = (page: Page) => page.locator("[data-slot=image-chip]");

export function gitStatus(server: BrowserServer): string {
  return execFileSync("git", ["status", "--porcelain", "-uall"], {
    cwd: server.dir,
    encoding: "utf8",
  });
}
