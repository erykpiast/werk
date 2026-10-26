import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { Werk } from "../../e2e/project.ts";
import { cleanEnv } from "../../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

export function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

export const logOf = (w: { dir: string }) => join(w.dir, ".werk", "log.jsonl");
export const events = (w: { dir: string }) =>
  readFileSync(logOf(w), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; actor: string; type: string; payload: Record<string, unknown> });

export const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** Copies the project and runs a CLI command on the copy; returns the copy's dir. */
export function cliOnCopy(dir: string, ...args: string[]): string {
  const copy = join(realpathSync(mkdtempSync(join(tmpdir(), "werk-g10-"))), "project");
  cpSync(dir, copy, { recursive: true });
  const run = spawnSync("bun", [CLI, ...args], { cwd: copy, env: cleanEnv(process.env, FAKE_BIN), encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return copy;
}

function toRgb(color: string): [number, number, number] | undefined {
  const rgb = /rgba?\((\d+(?:\.\d+)?),? (\d+(?:\.\d+)?),? (\d+(?:\.\d+)?)/.exec(color);
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const ok = /oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)/.exec(color);
  if (ok === null) return undefined;
  const L = Number(ok[1]) / (ok[2] === "%" ? 100 : 1);
  const C = Number(ok[3]);
  const h = (Number(ok[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const g = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  };
  return [g(lin[0] as number), g(lin[1] as number), g(lin[2] as number)];
}

/** Hue in degrees and HSL saturation of a computed colour. */
function hs(color: string): { h: number; s: number } | undefined {
  const rgb = toRgb(color);
  if (rgb === undefined) return undefined;
  if (/rgba\(0, 0, 0, 0\)/.test(color)) return undefined;
  const [r, g, b] = rgb.map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s };
}

export function isGrey(color: string): boolean {
  const x = hs(color);
  return x !== undefined && x.s < 0.3;
}
export function isBlue(color: string): boolean {
  const x = hs(color);
  return x !== undefined && x.s >= 0.4 && x.h >= 190 && x.h <= 260;
}
export function isRed(color: string): boolean {
  const x = hs(color);
  return x !== undefined && x.s >= 0.4 && (x.h <= 20 || x.h >= 340);
}
