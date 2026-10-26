import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Werk } from "../e2e/project.ts";

export type Rgb = { r: number; g: number; b: number; a: number };

/** A computed style property of an element, turned into RGBA through a canvas (handles oklch). */
export function rgbOf(at: Locator, prop: string): Promise<Rgb> {
  return at.evaluate((el, name) => {
    const value = getComputedStyle(el).getPropertyValue(name);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    return { r, g, b, a } as { r: number; g: number; b: number; a: number };
  }, prop);
}

export const isBlue = (c: Rgb) => c.a > 0 && c.b > c.r + 15 && c.b >= c.g;
export const isRed = (c: Rgb) => c.a > 0 && c.r > c.b + 15 && c.r > c.g + 15;
export const isGrey = (c: Rgb) => c.a > 0 && Math.abs(c.r - c.b) < 15 && Math.abs(c.r - c.g) < 15;
export const isWhiteish = (c: Rgb) => c.a === 0 || (c.r > 245 && c.g > 245 && c.b > 245);

export const logLines = (w: Pick<Werk, "dir">) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { seq: number; actor: string; type: string; payload: Record<string, unknown> });

export const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** One request with any Host header and no browser. */
export function send(
  url: string,
  path: string,
  options: { method?: string; host?: string; token?: string; body?: string } = {},
) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? `localhost:${port}`,
          "content-type": "application/json",
          ...(options.token === undefined ? {} : { "x-werk-token": options.token }),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** Seeds a decided card that holds every fact of the contract. */
export function decided(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", {
    id,
    kind: "card",
    title: id,
    parent: "root",
    status: "decided",
    who: "me",
    ...fields,
  });
  w.seed("kill.added", { id, criterion: { form: "revisit" } });
}
