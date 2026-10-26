// Shared helpers of the held-out browser tests for steps 15, 17 and 18.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Werk } from "../../e2e/project.ts";

export function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields });
}

export const logLines = (w: Pick<Werk, "dir">) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean);

export const heading = (p: Page) => p.locator("article[data-card] > h1");

/** Parses a computed CSS colour into a hue in degrees, a chroma-ish value and alpha. */
function parse(colour: string): { hue: number; chroma: number; alpha: number } | undefined {
  const ok = /oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(colour);
  if (ok) return { hue: Number(ok[3]), chroma: Number(ok[2]), alpha: ok[4] === undefined ? 1 : Number(ok[4]) };
  const rgb = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/.exec(colour);
  if (!rgb) return undefined;
  const [r, g, b] = [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, chroma: d, alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

/** A visible colour with a blue hue (rgb hue 190–260, oklch hue 220–290). */
export function isBlue(colour: string, min = 0.05): boolean {
  const c = parse(colour);
  if (c === undefined || c.alpha === 0 || c.chroma < min) return false;
  return colour.startsWith("oklch") ? c.hue > 220 && c.hue < 290 : c.hue > 190 && c.hue < 260;
}

/** A visible colour with a red hue. */
export function isRed(colour: string): boolean {
  const c = parse(colour);
  if (c === undefined || c.alpha === 0 || c.chroma < 0.02) return false;
  return colour.startsWith("oklch") ? c.hue < 40 || c.hue > 340 : c.hue < 15 || c.hue > 340;
}

export const style = (at: Locator, prop: string) =>
  at.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);

/** A flag on the window that a reload would lose. */
export const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
