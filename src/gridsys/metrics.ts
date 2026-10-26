// Pass 1 of #vi-sysdiag-resolve. Widths come from a real font's rendered output, generated
// once by headless Chrome's canvas measureText and checked in as .werk/font-metrics.json —
// #vi-sysdiag-metrics option B, chosen over option A (embed the font in every SVG) because
// werk has no npm dependencies and no font-parsing library to read glyph tables directly.
// The machine that generated the table is this one; a different system font elsewhere would
// disagree, which is the option's known cost.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type WidthTable = Record<string, Record<string, number>>

let table: WidthTable | null = null
function loadTable(): WidthTable {
  if (table) return table
  // The table belongs to werk's own checkout, so a diagram in any project measures with it.
  const path = join(import.meta.dirname, '..', '..', '.werk', 'font-metrics.json')
  table = JSON.parse(readFileSync(path, 'utf8'))
  return table!
}

const SIZES = [9.5, 10, 11, 12.5] as const
export type FontSize = (typeof SIZES)[number]
export type FontWeight = 400 | 700

// A char outside the generated table (non-ASCII) falls back to the space width at that
// size — wrong, but only for text this diagram never carries.
export function measureText(text: string, size: FontSize, weight: FontWeight): number {
  const widths = loadTable()[`${weight}:${size}`]
  if (!widths) throw new Error(`no metrics for ${weight}:${size} — regenerate .werk/font-metrics.json`)
  let total = 0
  for (const ch of text) total += widths[ch] ?? widths[' '] ?? 0
  return total
}

// Greedy word wrap: the only place a line break is chosen, and it is chosen from a real
// width, not a character count.
export function wrapText(text: string, maxWidth: number, size: FontSize, weight: FontWeight): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (current && measureText(trial, size, weight) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = trial
    }
  }
  if (current) lines.push(current)
  return lines
}
