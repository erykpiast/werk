/**
 * The numbers behind the context-fill pie: the share of the window in use, and the colour band it
 * falls in (#werk-context-pie).
 */

export type PieLevel = "blue" | "yellow" | "red";

export type Pie = {
  /** The share of the window in use, from 0 to 1. */
  fraction: number;
  /** The share as a whole percent, as the popover shows it. */
  percent: number;
  /** Blue under a third, yellow from a third, red from two thirds. */
  level: PieLevel;
};

export function pieOf(used: number, window: number): Pie {
  const raw = window > 0 ? used / window : 0;
  const fraction = Math.min(1, Math.max(0, raw));
  const level: PieLevel =
    fraction >= 2 / 3 ? "red" : fraction >= 1 / 3 ? "yellow" : "blue";
  return { fraction, percent: Math.round(fraction * 100), level };
}

/** The colours of the three bands: the proto, open and stale colours of the map. */
export const PIE_COLOURS: Record<PieLevel, string> = {
  blue: "var(--status-proto)",
  yellow: "var(--status-open)",
  red: "var(--stale)",
};

/** A conic gradient that fills the share of the circle in the colour of its band. */
export function pieGradient(pie: Pie): string {
  const turns = `${(pie.fraction * 360).toFixed(1)}deg`;
  return `conic-gradient(${PIE_COLOURS[pie.level]} ${turns}, var(--color-border) 0)`;
}
