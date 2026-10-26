// #vi-sysdiag-grid's whole claim, in one file: the grid the author wrote is TOPOLOGICAL.
// A cell is "row r, column c" and never a pixel. Nothing in a .wgrid file is a coordinate,
// a width, or a gap. Every number below is derived here, from measured text, the way CSS
// auto tracks are derived from their contents.
//
// That is what the format buys. The author moves a card one cell left and the column widths
// re-solve; the author never has to restate a width because a title got longer.
import { measureText, wrapText } from './metrics.ts'
import { check, type Cell, type CellIndex } from './check.ts'
import type { GridDoc } from './parse.ts'

// Card metrics.
const NODE_PAD_X = 14
const TITLE_SIZE = 12.5
const TITLE_LINE_H = 16
const DESC_SIZE = 10
const DESC_LINE_H = 13
const TOP_PAD = 20
const BOTTOM_PAD = 12
const DESC_WRAP_W = 190

// Label metrics.
const LABEL_SIZE = 9.5
const LABEL_LINE_H = 12
const MAX_LABEL_W = 130
const PLATE_PAD_X = 18
const PLATE_PAD_Y = 10

// A track that only carries a line still needs room for the line to be seen as a lane rather
// than as a seam between two boxes.
const LANE_MIN = 26

export const COL_GAP = 14
export const ROW_GAP = 14
export const MARGIN = 30
const GROUP_PAD = 18
const GROUP_HEADER_H = 34

export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }

export type ResolvedCard = {
  id: string
  cls: string
  titleLines: string[]
  descLines: string[]
  contentH: number
  box: Rect
  /** Map card ids, carried straight through from the .wgrid line — #vi-sysdiag-backedge. */
  cards: string[]
}

export type ResolvedGroup = { id: string; title: string; box: Rect }

export type ResolvedGridEdge = {
  id: string
  cls: string
  points: Point[]
  label: string
  labelLines: string[]
  labelBox: Rect | null
  /** Map card ids, carried straight through from the .wgrid line — #vi-sysdiag-backedge. */
  cards: string[]
  // True when the label sits inline in the lane rather than beside it — the line is drawn
  // straight through its position, and render.ts paints a background-colour plate under the
  // text so the line reads as broken there without the geometry actually breaking.
  labelInline: boolean
  // Points on this edge's own path where it crosses another edge and must be drawn hopping
  // over it. Only the horizontal partner of a crossing carries one; see attachHops.
  hops: Point[]
}

export type ResolvedGrid = {
  width: number
  height: number
  cards: ResolvedCard[]
  groups: ResolvedGroup[]
  // In PAINT order, not document order: an edge that hops over another sits after it, so the
  // arc lands on top of the line it jumps. See paintOrder. Draw them in this order or the
  // hops are wrong.
  edges: ResolvedGridEdge[]
  colW: number[]
  rowH: number[]
  // Post-shift left/top edge of every column and row — the actual on-canvas position,
  // not colW/rowH's pre-normalise sizes. Exists so a debug overlay (or anything else that
  // wants to draw the grid itself) doesn't have to re-derive normalise()'s shift.
  colX: number[]
  rowY: number[]
  // Style, not grammar — a warning never blocks a build the way an error in check.ts does.
  // "Avoid a U-turn in general" cannot be a hard rule: a shared corridor sometimes needs one
  // short correction on entry, and that is a reasonable price to pay, not a defect.
  warnings: string[]
}

function sizeCard(title: string, desc: string): { titleLines: string[]; descLines: string[]; w: number; h: number } {
  const titleLines = wrapText(title, DESC_WRAP_W, TITLE_SIZE, 700)
  const descLines = desc ? wrapText(desc, DESC_WRAP_W, DESC_SIZE, 400) : []
  const textW = Math.max(
    ...titleLines.map((l) => measureText(l, TITLE_SIZE, 700)),
    ...descLines.map((l) => measureText(l, DESC_SIZE, 400)),
    0
  )
  const h = TOP_PAD + titleLines.length * TITLE_LINE_H + (descLines.length ? 6 + descLines.length * DESC_LINE_H : 0) + BOTTOM_PAD
  return { titleLines, descLines, w: textW + NODE_PAD_X * 2, h }
}

function sizeLabel(text: string): { lines: string[]; w: number; h: number } {
  if (!text) return { lines: [], w: 0, h: 0 }
  const lines = wrapText(text, MAX_LABEL_W, LABEL_SIZE, 400)
  const w = Math.min(MAX_LABEL_W, Math.max(...lines.map((l) => measureText(l, LABEL_SIZE, 400)))) + PLATE_PAD_X
  return { lines, w, h: lines.length * LABEL_LINE_H + PLATE_PAD_Y }
}

type SpanDemand = { a: number; b: number; need: number }

// Shortest spans first: a 1-track demand is unambiguous, so it is paid before any wider
// demand gets to count it as room it already has. Within one length, the largest demand
// first, so a smaller sibling is usually already satisfied by the time it is read.
//
// Distributing EQUALLY across a..b, rather than dumping the shortfall on one track, is what
// keeps a card centred over its own span instead of pinned to one edge of it.
function satisfy(tracks: number[], gap: number, demands: SpanDemand[]): void {
  const ordered = [...demands].sort((x, y) => x.b - x.a - (y.b - y.a) || y.need - x.need)
  for (const d of ordered) {
    let current = gap * (d.b - d.a)
    for (let i = d.a; i <= d.b; i++) current += tracks[i]
    if (d.need <= current) continue
    const share = (d.need - current) / (d.b - d.a + 1)
    for (let i = d.a; i <= d.b; i++) tracks[i] += share
  }
}

function bounds(cells: Cell[]): { r0: number; r1: number; c0: number; c1: number } {
  return {
    r0: Math.min(...cells.map((c) => c.r)),
    r1: Math.max(...cells.map((c) => c.r)),
    c0: Math.min(...cells.map((c) => c.c)),
    c1: Math.max(...cells.map((c) => c.c)),
  }
}

export function resolveGrid(doc: GridDoc, index?: CellIndex): ResolvedGrid {
  const idx = index ?? check(doc).index
  const rows = idx.rows
  const cols = idx.cols
  const colW = new Array<number>(cols).fill(0)
  const rowH = new Array<number>(rows).fill(0)

  // Baseline: a path cell claims a lane on both of its tracks. An empty cell claims nothing,
  // which is why a spacer column can collapse to zero width and still hold the grid's shape.
  for (const cells of idx.pathCells.values()) {
    for (const cell of cells) {
      colW[cell.c] = Math.max(colW[cell.c], LANE_MIN)
      rowH[cell.r] = Math.max(rowH[cell.r], LANE_MIN)
    }
  }

  // A spacer asks for the same room a lane does, and nothing more.
  for (const cell of idx.spacers) {
    colW[cell.c] = Math.max(colW[cell.c], LANE_MIN)
    rowH[cell.r] = Math.max(rowH[cell.r], LANE_MIN)
  }

  const colDemands: SpanDemand[] = []
  const rowDemands: SpanDemand[] = []

  const sized = new Map<string, ReturnType<typeof sizeCard>>()
  for (const card of doc.cards) {
    const cells = idx.cardCells.get(card.id)
    if (!cells) continue
    const size = sizeCard(card.title, card.desc)
    sized.set(card.id, size)
    const b = bounds(cells)
    colDemands.push({ a: b.c0, b: b.c1, need: size.w })
    rowDemands.push({ a: b.r0, b: b.r1, need: size.h })
  }

  const labelSized = new Map<string, ReturnType<typeof sizeLabel>>()
  for (const edge of doc.edges) {
    const cells = idx.labelCells.get(edge.id)
    const size = sizeLabel(edge.label)
    labelSized.set(edge.id, size)
    if (!cells || !size.lines.length) continue
    const b = bounds(cells)
    colDemands.push({ a: b.c0, b: b.c1, need: size.w })
    rowDemands.push({ a: b.r0, b: b.r1, need: size.h })
  }

  satisfy(colW, COL_GAP, colDemands)
  satisfy(rowH, ROW_GAP, rowDemands)

  const x: number[] = []
  const y: number[] = []
  let acc = MARGIN
  for (let c = 0; c < cols; c++) {
    x.push(acc)
    acc += colW[c] + COL_GAP
  }
  acc = MARGIN
  for (let r = 0; r < rows; r++) {
    y.push(acc)
    acc += rowH[r] + ROW_GAP
  }
  const cellRect = (r: number, c: number): Rect => ({ x: x[c], y: y[r], w: colW[c], h: rowH[r] })
  const centre = (r: number, c: number): Point => ({ x: x[c] + colW[c] / 2, y: y[r] + rowH[r] / 2 })

  // A card's box is the union of its cells' rects, so the gaps *inside* a multi-cell card
  // belong to the card. Only a gap between two different owners stays empty.
  const union = (cells: Cell[]): Rect => {
    const b = bounds(cells)
    return {
      x: x[b.c0],
      y: y[b.r0],
      w: x[b.c1] + colW[b.c1] - x[b.c0],
      h: y[b.r1] + rowH[b.r1] - y[b.r0],
    }
  }

  const cards: ResolvedCard[] = []
  const cardBox = new Map<string, Rect>()
  for (const card of doc.cards) {
    const cells = idx.cardCells.get(card.id)
    const size = sized.get(card.id)
    if (!cells || !size) continue
    const box = union(cells)
    cardBox.set(card.id, box)
    cards.push({
      id: card.id,
      cls: card.cls,
      titleLines: size.titleLines,
      descLines: size.descLines,
      contentH: size.h,
      box,
      cards: card.cards,
    })
  }

  // A nested group opens after its parent, so walking the list backwards boxes every inner
  // group before the frame that must contain it. The output keeps document order, so render.ts
  // still paints an outer frame under its inner ones.
  const groupBox = new Map<string, Rect>()
  const groups: ResolvedGroup[] = []
  for (const group of [...doc.groups].reverse()) {
    const boxes = [...group.members.map((m) => cardBox.get(m)), ...group.subgroups.map((s) => groupBox.get(s))].filter(
      (b): b is Rect => !!b,
    )
    if (!boxes.length) continue
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    const box = { x: x0 - GROUP_PAD, y: y0 - GROUP_HEADER_H, w: x1 - x0 + GROUP_PAD * 2, h: y1 - y0 + GROUP_HEADER_H + GROUP_PAD }
    groupBox.set(group.id, box)
    groups.push({ id: group.id, title: group.title, box })
  }
  groups.reverse()

  // A frame is the box around its members, so a card whose middle sits inside it without being a
  // member reads as a member. The author cannot see it in the grid. #vi-sysdiag-grid-gaps, gap 2.
  const warnings: string[] = []
  const membersOf = (id: string): Set<string> => {
    const g = doc.groups.find((x) => x.id === id)!
    return new Set([...g.members, ...g.subgroups.flatMap((s) => [...membersOf(s)])])
  }
  for (const frame of groups) {
    const members = membersOf(frame.id)
    const b = frame.box
    const swallowed = cards
      .filter((c) => !members.has(c.id))
      .filter((c) => c.box.x + c.box.w / 2 > b.x && c.box.x + c.box.w / 2 < b.x + b.w && c.box.y + c.box.h / 2 > b.y && c.box.y + c.box.h / 2 < b.y + b.h)
      .map((c) => c.id)
    if (swallowed.length) {
      warnings.push(`group "${frame.id}" frames ${swallowed.length} card(s) that are not its members: ${swallowed.join(', ')}`)
    }
  }

  const edges: ResolvedGridEdge[] = []
  for (const edge of doc.edges) {
    const cells = idx.pathCells.get(edge.id) ?? []
    if (!cells.length) continue
    const labelCells = idx.labelCells.get(edge.id)
    const size = labelSized.get(edge.id)!
    const labelBox = labelCells ? union(labelCells) : null

    const bridged = idx.bridgedEdges.has(edge.id) && !!labelCells
    let points: Point[]
    if (bridged) {
      points = bridgedPathPoints(cells, idx, edge.from, edge.to, labelCells!, centre, cardBox, labelBox!)
    } else {
      const walked = walkPath(cells, idx, edge.from, edge.to)
      points = walked.map((cell) => centre(cell.r, cell.c))
      // Insert the border points, don't replace the end cells' own centres with them — if
      // the walk turns right at the card, replacing would jump both axes at once (a visible
      // diagonal cutting the corner) instead of one perpendicular step plus the existing
      // turn. This also covers the one-cell path (touches both cards from the same cell):
      // with nothing to replace, both clips just add their own point, one on each side.
      if (points.length) {
        const startClip = clipToCard(points[0], neighbourDir(walked[0], idx, edge.from), cardBox.get(edge.from))
        const endClip = clipToCard(
          points[points.length - 1],
          neighbourDir(walked[walked.length - 1], idx, edge.to),
          cardBox.get(edge.to)
        )
        points = [startClip, ...points, endClip]
      }
    }

    const uTurn = findUTurn(points)
    if (uTurn) warnings.push(`edge "${edge.id}" turns back on itself on the ${uTurn} axis — a U-shaped detour, avoid where you can`)

    edges.push({
      id: edge.id,
      cls: edge.cls,
      points,
      label: edge.label,
      labelLines: labelCells && size.lines.length ? size.lines : [],
      labelBox,
      cards: edge.cards,
      labelInline: bridged,
      hops: [],
    })
  }

  warnings.push(...offCentreLanes(edges, doc, cardBox))

  const painted = paintOrder(edges, attachHops(edges, idx, centre), warnings)

  return normalise({ width: 0, height: 0, cards, groups, edges: painted, colW, rowH, colX: [...x], rowY: [...y], warnings })
}

// A lane sits in the middle of its own cell, so a card that is more than one cell wide and has
// one edge on a face shows that edge off the card's middle. The author cannot see this from
// the grid, which is #vi-sysdiag-grid-gaps's gap 1. A face with several edges is a fan and is
// off-centre by design, so only a face with exactly one edge is reported.
const OFF_CENTRE_PX = 3
const FACE_PX = 1.5

function offCentreLanes(edges: ResolvedGridEdge[], doc: GridDoc, cardBox: Map<string, Rect>): string[] {
  type Touch = { edge: string; card: string; side: 'top' | 'bottom' | 'left' | 'right'; lane: number }
  const touches: Touch[] = []
  const touch = (edge: string, card: string, p: Point | undefined) => {
    const b = cardBox.get(card)
    if (!b || !p) return
    const inX = p.x >= b.x - FACE_PX && p.x <= b.x + b.w + FACE_PX
    const inY = p.y >= b.y - FACE_PX && p.y <= b.y + b.h + FACE_PX
    if (inX && Math.abs(p.y - b.y) <= FACE_PX) touches.push({ edge, card, side: 'top', lane: p.x })
    else if (inX && Math.abs(p.y - (b.y + b.h)) <= FACE_PX) touches.push({ edge, card, side: 'bottom', lane: p.x })
    else if (inY && Math.abs(p.x - b.x) <= FACE_PX) touches.push({ edge, card, side: 'left', lane: p.y })
    else if (inY && Math.abs(p.x - (b.x + b.w)) <= FACE_PX) touches.push({ edge, card, side: 'right', lane: p.y })
  }
  const edgeOf = new Map(doc.edges.map((e) => [e.id, e]))
  for (const e of edges) {
    const def = edgeOf.get(e.id)
    if (!def) continue
    touch(e.id, def.from, e.points[0])
    touch(e.id, def.to, e.points[e.points.length - 1])
  }
  const perFace = new Map<string, Touch[]>()
  for (const t of touches) {
    const k = `${t.card}/${t.side}`
    perFace.set(k, [...(perFace.get(k) ?? []), t])
  }
  const out: string[] = []
  for (const list of perFace.values()) {
    if (list.length !== 1) continue
    const [t] = list
    const b = cardBox.get(t.card)!
    const mid = t.side === 'top' || t.side === 'bottom' ? b.x + b.w / 2 : b.y + b.h / 2
    const off = Math.round(t.lane - mid)
    if (Math.abs(off) > OFF_CENTRE_PX) {
      out.push(`edge "${t.edge}" touches the ${t.side} of "${t.card}" ${Math.abs(off)}px off its middle — give the card an odd number of cells there, or put the edge in the middle cell`)
    }
  }
  return out
}

// Two lines drawn flat across each other read as a corner or a branch — the one thing R6
// swears a junction is not. So one of them hops: a small arc over the other, the convention
// every wiring diagram has used since lines first had to cross on paper.
//
// WHICH one hops is fixed, not a choice the author makes: the horizontal edge hops, the
// vertical one runs straight. R6 already guarantees exactly one of each at every junction,
// so the rule always resolves, and it resolves the same way at every crossing in every
// diagram — a reader learns "the arc belongs to the line going across" once.
//
// The hop point is the junction cell's own centre, which is already a vertex of the
// horizontal edge's path (walkPath emits one point per cell). render.ts finds it there and
// swaps that vertex for the arc.
function attachHops(
  edges: ResolvedGridEdge[],
  idx: CellIndex,
  centre: (r: number, c: number) => Point
): { over: string; under: string }[] {
  const byId = new Map(edges.map((e) => [e.id, e]))
  const crossings: { over: string; under: string }[] = []
  for (const j of idx.junctions) {
    const horizontal = (id: string): boolean => {
      const own = new Set((idx.pathCells.get(id) ?? []).map((cell) => `${cell.r},${cell.c}`))
      return own.has(`${j.r},${j.c - 1}`) && own.has(`${j.r},${j.c + 1}`)
    }
    const over = j.ids.find(horizontal)
    const under = j.ids.find((id) => id !== over)
    if (!over || !under) continue
    byId.get(over)?.hops.push(centre(j.r, j.c))
    crossings.push({ over, under })
  }
  return crossings
}

// A hop is only half the picture. An arc drawn UNDER the line it is meant to be jumping over
// reads as two lines fighting, not as one passing above the other — SVG has no z-index, so
// the line that goes over has to be painted later, full stop.
//
// So edges are sorted before they are drawn: a hopping edge lands after every edge it hops.
// A topological sort, seeded in document order, so an edge that hops nothing keeps the place
// the author gave it. A cycle (A hops B here, B hops A there) has no paint order that works;
// the remaining edges keep document order and the build says so, because the alternative is
// one crossing silently drawn the wrong way round.
function paintOrder(
  edges: ResolvedGridEdge[],
  crossings: { over: string; under: string }[],
  warnings: string[]
): ResolvedGridEdge[] {
  const rank = new Map(edges.map((e, i) => [e.id, i]))
  const overs = new Map<string, string[]>() // an edge -> the edges that must come after it
  const waiting = new Map(edges.map((e) => [e.id, 0]))
  for (const { over, under } of crossings) {
    if (!rank.has(over) || !rank.has(under) || over === under) continue
    overs.set(under, [...(overs.get(under) ?? []), over])
    waiting.set(over, waiting.get(over)! + 1)
  }
  const ordered: ResolvedGridEdge[] = []
  const done = new Set<string>()
  while (ordered.length < edges.length) {
    const next = edges.find((e) => !done.has(e.id) && waiting.get(e.id) === 0)
    if (!next) break
    ordered.push(next)
    done.add(next.id)
    for (const id of overs.get(next.id) ?? []) waiting.set(id, waiting.get(id)! - 1)
  }
  if (ordered.length < edges.length) {
    const stuck = edges.filter((e) => !done.has(e.id))
    warnings.push(
      `hop paint order is circular (${stuck.map((e) => `"${e.id}"`).join(', ')}) — at least one crossing draws its arc under the line it jumps`
    )
    ordered.push(...stuck)
  }
  return ordered
}

// A U-turn: the walk moves one way on an axis, later moves the other way on the SAME axis,
// with only a perpendicular run in between — a detour that backtracks instead of arriving.
// Not every reversal is one worth avoiding (a shared corridor sometimes needs a short step
// back on entry), so this is advisory only; see the `warnings` field's own note.
function findUTurn(points: Point[]): 'x' | 'y' | null {
  type Run = { axis: 'x' | 'y'; sign: number }
  const runs: Run[] = []
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const run: Run | null = Math.abs(dx) > 0.5 ? { axis: 'x', sign: Math.sign(dx) } : Math.abs(dy) > 0.5 ? { axis: 'y', sign: Math.sign(dy) } : null
    if (!run) continue
    const last = runs[runs.length - 1]
    if (last && last.axis === run.axis && last.sign === run.sign) continue
    runs.push(run)
  }
  for (let i = 0; i + 2 < runs.length; i++) {
    if (runs[i].axis === runs[i + 2].axis && runs[i].sign === -runs[i + 2].sign && runs[i + 1].axis !== runs[i].axis) {
      return runs[i].axis
    }
  }
  return null
}

// The path is walked, not sorted: following 4-adjacency from one end to the other turns every
// corner in the order the author drew it, with no special case for an L, a Z, or a staircase.
function walkPath(cells: Cell[], idx: CellIndex, from: string, to: string): Cell[] {
  const key = (r: number, c: number) => `${r},${c}`
  const own = new Map(cells.map((cell) => [key(cell.r, cell.c), cell]))
  const neighbours = (cell: Cell): Cell[] =>
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
      .map(([dr, dc]) => own.get(key(cell.r + dr, cell.c + dc)))
      .filter((n): n is Cell => !!n)

  const ends = cells.filter((cell) => neighbours(cell).length === 1)
  const touches = (cell: Cell, cardId: string) =>
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].some(([dr, dc]) => idx.cardAt.get(key(cell.r + dr, cell.c + dc)) === cardId)

  const start = ends.find((cell) => touches(cell, from)) ?? ends[0] ?? cells[0]
  const out: Cell[] = [start]
  const seen = new Set([key(start.r, start.c)])
  let cur = start
  for (;;) {
    const next = neighbours(cur).find((n) => !seen.has(key(n.r, n.c)))
    if (!next) break
    seen.add(key(next.r, next.c))
    out.push(next)
    cur = next
  }
  // A single-cell path has no second end to aim at; the direction of travel still comes from
  // which card each end touches, so the order only matters when both ends are real.
  if (out.length > 1 && !touches(out[0], from) && touches(out[out.length - 1], from) && to !== from) out.reverse()
  return out
}

// A path cut by an inline label is exactly two components (check.ts refuses to build
// anything else). The line is drawn straight through, card border to card border, passing
// through the label's own centre in between — render.ts paints a plate over that midpoint so
// the label reads as a gap without the geometry actually having one.
function bridgedPathPoints(
  cells: Cell[],
  idx: CellIndex,
  from: string,
  to: string,
  labelCells: Cell[],
  centre: (r: number, c: number) => Point,
  cardBox: Map<string, Rect>,
  labelBox: Rect
): Point[] {
  const touchesCardId = (cell: Cell, cardId: string) =>
    (
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const
    ).some(([dr, dc]) => idx.cardAt.get(`${cell.r + dr},${cell.c + dc}`) === cardId)

  const comps = pathComponents(cells)
  const arms = comps.map((comp) => {
    const cardId = comp.some((cell) => touchesCardId(cell, from)) ? from : to
    return { cardId, walked: walkComponentFromCard(comp, idx, cardId) }
  })
  const fromArm = arms.find((a) => a.cardId === from) ?? arms[0]
  const toArm = arms.find((a) => a.cardId === to) ?? arms[1]
  const labelCentre: Point = { x: labelBox.x + labelBox.w / 2, y: labelBox.y + labelBox.h / 2 }

  const points = [
    ...fromArm.walked.map((cell) => centre(cell.r, cell.c)),
    labelCentre,
    ...[...toArm.walked].reverse().map((cell) => centre(cell.r, cell.c)),
  ]
  // Inserted, not substituted: if the walk turns a corner right at the card (the routed
  // edges below do, immediately), replacing the first point would jump both axes at once —
  // a visible diagonal cutting the corner. Adding the border point ahead of the cell's own
  // centre keeps that step perpendicular; the turn still happens on the next segment, same
  // as it would anywhere else in the walk.
  const startClip = clipToCard(points[0], neighbourDir(fromArm.walked[0], idx, from), cardBox.get(from))
  const endClip = clipToCard(points[points.length - 1], neighbourDir(toArm.walked[0], idx, to), cardBox.get(to))
  return [startClip, ...points, endClip]
}

function pathComponents(cells: Cell[]): Cell[][] {
  const k = (r: number, c: number) => `${r},${c}`
  const own = new Set(cells.map((c) => k(c.r, c.c)))
  const visited = new Set<string>()
  const comps: Cell[][] = []
  for (const cell of cells) {
    const key0 = k(cell.r, cell.c)
    if (visited.has(key0)) continue
    const comp: Cell[] = []
    const queue: Cell[] = [cell]
    visited.add(key0)
    while (queue.length) {
      const cur = queue.pop()!
      comp.push(cur)
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nk = k(cur.r + dr, cur.c + dc)
        if (own.has(nk) && !visited.has(nk)) {
          visited.add(nk)
          queue.push({ r: cur.r + dr, c: cur.c + dc })
        }
      }
    }
    comps.push(comp)
  }
  return comps
}

// Walk one side of a bridged path from its card-touching end toward the label. Same 4-
// adjacency walk as walkPath, restricted to this component's own cells.
function walkComponentFromCard(comp: Cell[], idx: CellIndex, cardId: string): Cell[] {
  const k = (r: number, c: number) => `${r},${c}`
  const own = new Map(comp.map((cell) => [k(cell.r, cell.c), cell]))
  const neighbours = (cell: Cell): Cell[] =>
    (
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const
    )
      .map(([dr, dc]) => own.get(k(cell.r + dr, cell.c + dc)))
      .filter((n): n is Cell => !!n)
  const touchesCard = (cell: Cell) =>
    (
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const
    ).some(([dr, dc]) => idx.cardAt.get(k(cell.r + dr, cell.c + dc)) === cardId)

  const ends = comp.filter((cell) => neighbours(cell).length <= 1)
  const start = ends.find((cell) => touchesCard(cell)) ?? comp[0]
  const out: Cell[] = [start]
  const seen = new Set([k(start.r, start.c)])
  let cur = start
  for (;;) {
    const next = neighbours(cur).find((n) => !seen.has(k(n.r, n.c)))
    if (!next) break
    seen.add(k(next.r, next.c))
    out.push(next)
    cur = next
  }
  return out
}

function neighbourDir(cell: Cell, idx: CellIndex, cardId: string): [number, number] | null {
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    if (idx.cardAt.get(`${cell.r + dr},${cell.c + dc}`) === cardId) return [dr, dc]
  }
  return null
}

function clipToCard(p: Point, dir: [number, number] | null, card: Rect | undefined): Point {
  if (!dir || !card) return p
  const [dr, dc] = dir
  const clampX = Math.min(Math.max(p.x, card.x + 6), card.x + card.w - 6)
  const clampY = Math.min(Math.max(p.y, card.y + 6), card.y + card.h - 6)
  if (dr === -1) return { x: clampX, y: card.y + card.h }
  if (dr === 1) return { x: clampX, y: card.y }
  if (dc === -1) return { x: card.x + card.w, y: clampY }
  return { x: card.x, y: clampY }
}

// A group frame reaches 34px above its topmost member for its header, so the top row's group
// hangs off the canvas. Rather than reserve that space in the track solver — where it would
// be a metric fact leaking into a topological model — the whole drawing is shifted once at
// the end so its true bounding box starts at MARGIN.
function normalise(g: ResolvedGrid): ResolvedGrid {
  const xs: number[] = []
  const ys: number[] = []
  for (const b of [...g.cards.map((c) => c.box), ...g.groups.map((gr) => gr.box), ...g.edges.map((e) => e.labelBox)]) {
    if (!b) continue
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
  }
  for (const e of g.edges) for (const p of e.points) {
    xs.push(p.x)
    ys.push(p.y)
  }
  const dx = MARGIN - Math.min(...xs)
  const dy = MARGIN - Math.min(...ys)
  const shiftRect = (r: Rect) => {
    r.x += dx
    r.y += dy
  }
  g.cards.forEach((c) => shiftRect(c.box))
  g.groups.forEach((gr) => shiftRect(gr.box))
  g.edges.forEach((e) => {
    if (e.labelBox) shiftRect(e.labelBox)
    e.points.forEach((p) => {
      p.x += dx
      p.y += dy
    })
    // A hop point must stay on its own path point, so it takes the same shift.
    e.hops.forEach((p) => {
      p.x += dx
      p.y += dy
    })
  })
  g.colX = g.colX.map((v) => v + dx)
  g.rowY = g.rowY.map((v) => v + dy)
  g.width = Math.round(Math.max(...xs) + dx + MARGIN)
  g.height = Math.round(Math.max(...ys) + dy + MARGIN)
  return g
}
