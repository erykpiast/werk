// Held-out helper: reads a computed CSS colour as hue and chroma, for "blue", "grey" and "red" checks.
import type { Locator } from "@playwright/test";

export type Colour = { raw: string; chroma: number; hue: number; alpha: number };

export function parse(raw: string): Colour {
  const ok = /oklch\(([\d.]+%?) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+%?))?\)/.exec(raw);
  if (ok) {
    const a = ok[4] === undefined ? 1 : ok[4].endsWith("%") ? Number(ok[4].slice(0, -1)) / 100 : Number(ok[4]);
    return { raw, chroma: Number(ok[2]), hue: Number(ok[3]), alpha: a };
  }
  const rgb = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(raw);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
      if (max === r) hue = (60 * ((g - b) / (max - min)) + 360) % 360;
      else if (max === g) hue = 60 * ((b - r) / (max - min)) + 120;
      else hue = 60 * ((r - g) / (max - min)) + 240;
    }
    // A rough chroma on the same scale as oklch's (0 for grey).
    return { raw, chroma: (max - min) * 0.3, hue, alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  return { raw, chroma: 0, hue: 0, alpha: 0 };
}

/** Blue: a visible colour with real chroma and a hue between cyan and violet (oklch ~220-280, hsl ~190-260). */
export const isBlue = (c: Colour) => c.alpha > 0 && c.chroma > 0.015 && c.hue >= 190 && c.hue <= 285;
export const isGrey = (c: Colour) => c.alpha > 0 && c.chroma < 0.015;
export const isRed = (c: Colour) => c.alpha > 0 && c.chroma > 0.015 && (c.hue <= 40 || c.hue >= 340);

export const css = (at: Locator, prop: string) =>
  at.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop).then(parse);

/** The Tailwind colour family ("blue", "gray", "red", ...) whose palette holds this exact colour, or "other". */
export async function family(at: Locator, prop: string): Promise<string> {
  return at.evaluate((el, name) => {
    const value = getComputedStyle(el).getPropertyValue(name);
    const families = ["blue", "sky", "indigo", "gray", "slate", "zinc", "neutral", "stone", "red", "rose", "amber"];
    const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const probe = document.createElement("span");
    document.body.append(probe);
    try {
      for (const f of families)
        for (const s of shades) {
          probe.style.backgroundColor = `var(--color-${f}-${s})`;
          if (getComputedStyle(probe).backgroundColor === value) return f;
        }
      if (value === "rgba(0, 0, 0, 0)" || value === "transparent") return "none";
      return `other:${value}`;
    } finally {
      probe.remove();
    }
  }, prop);
}
