// Shared helpers of the web-c held-out specs. Not a spec itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Werk } from "../e2e/project.ts";

export function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

export type Event = { seq: number; actor: string; type: string; payload: Record<string, unknown> };

export function events(w: Pick<Werk, "dir">): Event[] {
  return readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

export const logText = (w: Pick<Werk, "dir">) => readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");

export const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

export type RGBA = [number, number, number, number];

/** The computed colour of a CSS property, converted to sRGB through a canvas. */
export function rgbOf(at: Locator, property: string): Promise<{ css: string; rgba: RGBA }> {
  return at.evaluate((el, name) => {
    const css = getComputedStyle(el).getPropertyValue(name);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { css, rgba: [d[0], d[1], d[2], d[3]] as [number, number, number, number] };
  }, property);
}

export const isBlue = ([r, g, b, a]: RGBA) => a > 0 && b > g && b - r >= 14;
export const isRed = ([r, g, b, a]: RGBA) => a > 0 && r - Math.max(g, b) >= 8;
/** Grey: an HSL saturation of 0.25 or less (Tailwind's gray palette is a little blue, so a spread is not enough). */
export const isGrey = ([r, g, b, a]: RGBA) => {
  if (a === 0) return false;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return s <= 0.25;
};
export const isGreen = ([r, g, b, a]: RGBA) => a > 0 && g - Math.max(r, b) >= 20;
