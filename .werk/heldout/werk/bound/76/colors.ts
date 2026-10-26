// Colour helpers of the held-out browser tests: read a computed CSS colour as hue and chroma.

/** Hue (degrees) and chroma of a computed colour string such as `oklch(0.97 0.01 250)` or `rgb(1, 2, 3)`. */
export function hueChroma(css: string): { hue: number; chroma: number; alpha: number } {
  const ok = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(css);
  if (ok) {
    const a = ok[4] === undefined ? 1 : ok[4].endsWith("%") ? Number.parseFloat(ok[4]) / 100 : Number(ok[4]);
    return { hue: Number(ok[3]), chroma: Number(ok[2]), alpha: a };
  }
  const lab = /(?:oklab)\(\s*([\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(css);
  if (lab) {
    const aa = Number(lab[2]);
    const bb = Number(lab[3]);
    return { hue: ((Math.atan2(bb, aa) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(aa, bb), alpha: 1 };
  }
  const rgb = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)/.exec(css);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { hue: h, chroma: d / 255, alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  throw new Error(`cannot read colour ${css}`);
}

export const isBlue = (css: string, min = 0.012): boolean => {
  const c = hueChroma(css);
  return c.alpha > 0 && c.chroma > min && c.hue >= 200 && c.hue <= 280;
};
export const isTransparent = (css: string): boolean => css === "rgba(0, 0, 0, 0)" || hueChroma(css).alpha === 0;
export const isGrey = (css: string): boolean => hueChroma(css).chroma < 0.012;
export const isRed = (css: string): boolean => {
  const c = hueChroma(css);
  return c.alpha > 0 && c.chroma > 0.012 && (c.hue <= 40 || c.hue >= 340);
};
