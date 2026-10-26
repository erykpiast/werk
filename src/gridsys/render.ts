// Geometry to SVG.
//
// No label plate, and that is the point of #vi-sysdiag-grid: a router that draws centre-to-
// centre lines needs an opaque rectangle behind a label, because the label can land on a line
// or a box and the plate hides the collision. Here a label owns its own cells, the checker's R4
// refuses a label cell that is also a path cell, and the track solver gives those cells real
// width. A collision is not possible, so there is nothing to hide.
import type { Point, ResolvedGrid, ResolvedGridEdge } from './resolve.ts'

const COLORS: Record<string, string> = {
  read: '#5fb0c9',
  state: '#5c8fd6',
  agent: '#9d7bd8',
  perm: '#d99a4e',
  write: '#5fbf8f',
  ext: '#8a93a6',
  dev: '#d9718a',
}

const TITLE_LINE_H = 16
const DESC_LINE_H = 13
const TOP_PAD = 20
const LABEL_LINE_H = 12
const BG = '#0a0d12'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const r2 = (n: number) => Math.round(n * 100) / 100

// Shades every even column with the actual track width the solver gave it (colX/colW), so
// a column-sizing question like #vi-sysdiag-grid-gaps's label-distance finding can be read
// off the picture instead of re-derived from a script each time.
//
// Always emitted, never built visible by default: the group carries a stable id and starts
// display:none, so the browser can toggle it (the Grid view's "Debug" checkbox) without a
// second file or a rebuild. debugColumns only changes whether *this* build starts visible —
// a diagnostic convenience for bun src/gridsys/build.ts ... --columns, not the mechanism
// the checkbox uses.
function renderColumnBands(g: ResolvedGrid, visible: boolean): string {
  const parts: string[] = [`<g id="debug-columns" style="display:${visible ? 'block' : 'none'}">`]
  for (let c = 0; c < g.colX.length; c += 2) {
    parts.push(`<rect x="${r2(g.colX[c])}" y="0" width="${r2(g.colW[c])}" height="${g.height}" fill="#ff5ca8" opacity="0.08"/>`)
  }
  parts.push('</g>')
  return parts.join('\n')
}

// The radius of a hop arc. R6 guarantees a junction's two path neighbours are the crossing
// edge's own cells, never a card border, so the arc always has a full cell of straight line
// on each side to sit in — it can never eat a turn or reach a card.
const HOP_R = 5

// The line, with a semicircle jumped over every crossing resolve.ts marked. A hop point is
// always an existing vertex of this path, and the path runs straight through it (R6), so the
// vertex is replaced by three commands: stop short of it, arc across it, carry on.
function edgePath(e: ResolvedGridEdge): string {
  const near = (p: Point, h: Point) => Math.abs(p.x - h.x) < 0.5 && Math.abs(p.y - h.y) < 0.5
  const parts: string[] = []
  e.points.forEach((p, i) => {
    const prev = e.points[i - 1]
    const next = e.points[i + 1]
    const hop = prev && next && e.hops.some((h) => near(p, h))
    if (!hop) {
      parts.push(`${i === 0 ? 'M' : 'L'}${r2(p.x)},${r2(p.y)}`)
      return
    }
    if (Math.abs(p.y - prev.y) < 0.5) {
      // Horizontal: bow north, whichever way the line travels.
      const dir = Math.sign(p.x - prev.x) || 1
      parts.push(`L${r2(p.x - dir * HOP_R)},${r2(p.y)}`)
      parts.push(`A${HOP_R},${HOP_R} 0 0 ${dir > 0 ? 1 : 0} ${r2(p.x + dir * HOP_R)},${r2(p.y)}`)
    } else {
      // Vertical: bow east. Unused while attachHops only ever hops the horizontal edge, but
      // the arithmetic belongs here, not in the rule that picks the hopping edge.
      const dir = Math.sign(p.y - prev.y) || 1
      parts.push(`L${r2(p.x)},${r2(p.y - dir * HOP_R)}`)
      parts.push(`A${HOP_R},${HOP_R} 0 0 ${dir > 0 ? 1 : 0} ${r2(p.x)},${r2(p.y + dir * HOP_R)}`)
    }
  })
  return parts.join(' ')
}

export function render(g: ResolvedGrid, debugColumns = false): string {
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.height}" width="${g.width}" height="${g.height}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif">`
  )
  parts.push(`<rect x="0" y="0" width="${g.width}" height="${g.height}" fill="${BG}"/>`)
  parts.push(renderColumnBands(g, debugColumns))
  parts.push('<defs>')
  for (const [cls, color] of Object.entries(COLORS)) {
    parts.push(
      `<marker id="arrow-${cls}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`
    )
  }
  parts.push('</defs>')

  // Frames first, under everything: a group is a backdrop, not an object in the drawing.
  for (const group of g.groups) {
    parts.push(
      `<rect x="${r2(group.box.x)}" y="${r2(group.box.y)}" width="${r2(group.box.w)}" height="${r2(group.box.h)}" rx="12" fill="none" stroke="#2a3a4d" stroke-width="1" stroke-dasharray="3 4"/>` +
        `<text x="${r2(group.box.x + 12)}" y="${r2(group.box.y + 16)}" font-size="11" letter-spacing="0.06em" fill="#5c7086">${esc(group.title)}</text>`
    )
  }

  for (const card of g.cards) {
    const cx = card.box.x + card.box.w / 2
    // A card's cells can be taller than its text needs, when another demand stretched one of
    // its rows. The text is then centred in the box it actually got, not pinned to the top.
    let ty = card.box.y + Math.max(0, (card.box.h - card.contentH) / 2) + TOP_PAD
    const tspans: string[] = []
    for (const line of card.titleLines) {
      tspans.push(`<tspan x="${r2(cx)}" y="${r2(ty)}" font-weight="700" font-size="12.5">${esc(line)}</tspan>`)
      ty += TITLE_LINE_H
    }
    if (card.descLines.length) ty += 6
    for (const line of card.descLines) {
      tspans.push(`<tspan x="${r2(cx)}" y="${r2(ty)}" font-size="10" fill="#9fb0c4">${esc(line)}</tspan>`)
      ty += DESC_LINE_H
    }
    // One group per element, carrying its own id and the map cards that decided it. This is
    // the whole mechanism behind #vi-sysdiag-link: the browser finds an element by card id
    // with one querySelectorAll, and reads the ids back off a clicked element, without a
    // second copy of the mapping anywhere.
    parts.push(
      `<g class="wd-node" data-node="${esc(card.id)}" data-cards="${esc(card.cards.join(','))}">` +
        `<rect x="${r2(card.box.x)}" y="${r2(card.box.y)}" width="${r2(card.box.w)}" height="${r2(card.box.h)}" rx="8" fill="#1b2536" stroke="#3a4a5f" stroke-width="1.4"/>` +
        `<text text-anchor="middle" fill="#eef2f7">${tspans.join('')}</text>` +
        `</g>`
    )
  }

  // g.edges is in paint order already (resolve.ts's paintOrder), so a hop arc is painted after
  // the line it jumps. Do not re-sort this loop.
  for (const e of g.edges) {
    const color = COLORS[e.cls] ?? COLORS.read
    const marker = COLORS[e.cls] ? e.cls : 'read'
    const d = edgePath(e)
    // The line, its plate and its label go in one group, so clicking the label selects the
    // connection — a 1.6px line is a hard target, its text is not. #vi-sysdiag-link.
    parts.push(`<g class="wd-edge" data-edge="${esc(e.id)}" data-cards="${esc(e.cards.join(','))}">`)
    // An invisible 11px-wide copy of the same path, under the real one: a 1.6px line is not a
    // pointer target a hand can hit. It carries no marker, so it adds nothing to the picture.
    parts.push(`<path class="wd-hitarea" d="${d}" fill="none" stroke="transparent" stroke-width="11"/>`)
    parts.push(
      `<path class="wd-line" d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" marker-end="url(#arrow-${marker})"/>`
    )
    if (!e.labelLines.length || !e.labelBox) {
      parts.push('</g>')
      continue
    }
    // An inline label's line runs straight underneath it (bridgedPathPoints in resolve.ts).
    // A plate in the canvas's own background colour, painted after the line and before the
    // text, reads as a gap in the line without the geometry needing one.
    if (e.labelInline) {
      parts.push(
        `<rect x="${r2(e.labelBox.x)}" y="${r2(e.labelBox.y)}" width="${r2(e.labelBox.w)}" height="${r2(e.labelBox.h)}" rx="3" fill="${BG}"/>`
      )
    }
    const cx = e.labelBox.x + e.labelBox.w / 2
    const textH = e.labelLines.length * LABEL_LINE_H
    let ty = e.labelBox.y + e.labelBox.h / 2 - textH / 2 + 9
    const tspans = e.labelLines
      .map((line) => {
        const span = `<tspan x="${r2(cx)}" y="${r2(ty)}">${esc(line)}</tspan>`
        ty += LABEL_LINE_H
        return span
      })
      .join('')
    parts.push(`<text text-anchor="middle" font-size="9.5" fill="${color}">${tspans}</text>`)
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('\n')
}
