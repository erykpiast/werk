// The tile grammar of #vi-sysdiag-grid. Six rules, every one an error: a grid that breaks
// any of them is not a diagram with a defect, it is a placement the resolver cannot read at
// all. So the build refuses to write an SVG rather than emitting a plausible-looking wrong
// one.
//
// R1 is CSS grid-template-areas' rule, copied at its own strictness: a named area must be a
// filled rectangle. An L-shape has no single box, so there is nothing to draw.
import type { GridDoc } from './parse.ts'

export type Cell = { r: number; c: number }

const key = (r: number, c: number) => `${r},${c}`
const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const

export type CellIndex = {
  cardCells: Map<string, Cell[]>
  pathCells: Map<string, Cell[]>
  labelCells: Map<string, Cell[]>
  cardAt: Map<string, string>
  pathAt: Map<string, string>
  // Every junction placement, in the order the author wrote them. R6 reads this list to check
  // each crossing. Neither edge's path needs it — a junction cell is already in both edges'
  // own pathCells lists by the time either one walks — but resolve.ts's attachHops does, to
  // mark the one point where the crossing has to be drawn as a hop instead of a flat cross.
  junctions: (Cell & { ids: [string, string] })[]
  // Cells that hold a `~`. resolve.ts keeps their track at least one lane wide.
  spacers: Cell[]
  rows: number
  cols: number
  // Edges whose label sits INSIDE the lane rather than beside it — one label rectangle
  // touching every piece of an otherwise-cut path, standing in for the missing path cells.
  // resolve.ts reads this to know an edge's line must be drawn as two segments, not one.
  bridgedEdges: Set<string>
}

export function indexCells(doc: GridDoc): CellIndex {
  const cardCells = new Map<string, Cell[]>()
  const pathCells = new Map<string, Cell[]>()
  const labelCells = new Map<string, Cell[]>()
  const cardAt = new Map<string, string>()
  const pathAt = new Map<string, string>()
  const junctions: (Cell & { ids: [string, string] })[] = []
  const spacers: Cell[] = []
  let cols = 0
  doc.rows.forEach((row, r) => {
    cols = Math.max(cols, row.length)
    row.forEach((tok, c) => {
      if (tok.kind === 'card') {
        push(cardCells, tok.id, { r, c })
        cardAt.set(key(r, c), tok.id)
      } else if (tok.kind === 'path') {
        push(pathCells, tok.id, { r, c })
        pathAt.set(key(r, c), tok.id)
      } else if (tok.kind === 'label') {
        push(labelCells, tok.id, { r, c })
      } else if (tok.kind === 'spacer') {
        spacers.push({ r, c })
      } else if (tok.kind === 'junction') {
        // Both edges own this cell independently — each one's own connectivity check (R2)
        // only ever looks at ITS OWN cell list, so the other edge's cells on the crossing
        // axis are invisible to it, same as if the two lines had never met.
        push(pathCells, tok.ids[0], { r, c })
        push(pathCells, tok.ids[1], { r, c })
        junctions.push({ r, c, ids: tok.ids })
      }
    })
  })
  return { cardCells, pathCells, labelCells, cardAt, pathAt, junctions, spacers, rows: doc.rows.length, cols, bridgedEdges: new Set() }
}

function push<T>(map: Map<string, T[]>, k: string, v: T): void {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

// A filled rectangle: the bounding box's area equals the cell count, and every cell inside
// the bounding box is present. Both halves are needed — area alone accepts a swapped pair of
// cells on opposite corners of a larger box.
function rectProblem(cells: Cell[]): string | null {
  const r0 = Math.min(...cells.map((c) => c.r))
  const r1 = Math.max(...cells.map((c) => c.r))
  const c0 = Math.min(...cells.map((c) => c.c))
  const c1 = Math.max(...cells.map((c) => c.c))
  const area = (r1 - r0 + 1) * (c1 - c0 + 1)
  const present = new Set(cells.map((c) => key(c.r, c.c)))
  if (present.size !== cells.length) return 'the same cell is listed twice'
  if (area !== cells.length) {
    const missing: string[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) if (!present.has(key(r, c))) missing.push(`(${r},${c})`)
    }
    return `its cells span rows ${r0}-${r1} x cols ${c0}-${c1} but ${missing.length} cell(s) inside that box are not its own: ${missing.join(' ')}`
  }
  return null
}

export function check(doc: GridDoc): { errors: string[]; index: CellIndex } {
  const errors: string[] = []
  const index = indexCells(doc)

  // R5 first: every later rule reads (r,c) positions, and a ragged grid makes a column
  // number mean a different thing on each row.
  const widths = doc.rows.map((row) => row.length)
  const expected = widths[0] ?? 0
  doc.rows.forEach((row, r) => {
    if (row.length !== expected) errors.push(`R5: row ${r} has ${row.length} tokens, row 0 has ${expected}`)
  })

  // Unknown ids. Reported before the shape rules, since an unknown token is also an absent
  // cell for whatever card or edge the author meant to write.
  doc.rows.forEach((row, r) => {
    row.forEach((tok, c) => {
      if (tok.kind === 'unknown') errors.push(`unknown id at (${r},${c}): "${tok.raw}" is not a card or an edge`)
    })
  })

  // R1: every card is a filled rectangle.
  for (const card of doc.cards) {
    const cells = index.cardCells.get(card.id)
    if (!cells) {
      errors.push(`R1: card "${card.id}" has no cell in the grid`)
      continue
    }
    const problem = rectProblem(cells)
    if (problem) errors.push(`R1: card "${card.id}" is not a filled rectangle — ${problem}`)
  }

  for (const edge of doc.edges) {
    const cells = index.pathCells.get(edge.id) ?? []
    if (!cells.length) {
      errors.push(`R2: edge "${edge.id}" has no path cell in the grid`)
      continue
    }
    const own = new Set(cells.map((c) => key(c.r, c.c)))
    const labels = index.labelCells.get(edge.id) ?? []
    const labelSet = new Set(labels.map((c) => key(c.r, c.c)))

    // A one-cell path is its own degenerate case: it has no other path cell to be a
    // neighbour of, so the degree/branch/end machinery below would call it "isolated" even
    // when it correctly touches both its cards at once — two cards directly stacked across
    // a single gap row need exactly this. Handled directly, then straight through to R4.
    if (cells.length === 1) {
      const touchesCard = (cardId: string) =>
        NEIGHBOURS.some(([dr, dc]) => index.cardAt.get(key(cells[0].r + dr, cells[0].c + dc)) === cardId)
      if (!touchesCard(edge.from) || !touchesCard(edge.to)) {
        errors.push(
          `R3: edge "${edge.id}"'s single path cell (${cells[0].r},${cells[0].c}) must touch both "${edge.from}" and "${edge.to}"`
        )
      }
      // R4 rule: a one-cell path has no room to split around a label — a path cell on
      // each side needs at least two path cells to begin with. Widen the gap to fit one.
      if (labels.length) {
        errors.push(
          `R4: label of edge "${edge.id}" has only one path cell to sit beside — a label needs the path split around it, which takes at least two path cells`
        )
      }
      continue
    }

    // R2: one connected path, no branch. Degree is counted inside this edge's own cells only,
    // so two edges crossing the same region never see each other. A branch here is always a
    // real branch — an inline label bridges a gap between two ends, it never explains three
    // path cells meeting at one.
    const degree = new Map<string, number>()
    for (const cell of cells) {
      let n = 0
      for (const [dr, dc] of NEIGHBOURS) if (own.has(key(cell.r + dr, cell.c + dc))) n++
      degree.set(key(cell.r, cell.c), n)
    }
    const branches = cells.filter((c) => (degree.get(key(c.r, c.c)) ?? 0) > 2)
    if (branches.length) {
      errors.push(
        `R2: edge "${edge.id}" branches at ${branches.map((c) => `(${c.r},${c.c})`).join(' ')} — a path cell may have 1 or 2 neighbours, not more`
      )
    }

    // Connected components of the path alone, ignoring the label. One component is the
    // ordinary case below. More than one means the path is cut, and the only thing allowed
    // to explain that is this edge's own label sitting exactly in the gap.
    const components: Cell[][] = []
    {
      const visited = new Set<string>()
      for (const cell of cells) {
        const k0 = key(cell.r, cell.c)
        if (visited.has(k0)) continue
        const comp: Cell[] = []
        const queue: Cell[] = [cell]
        visited.add(k0)
        while (queue.length) {
          const cur = queue.pop()!
          comp.push(cur)
          for (const [dr, dc] of NEIGHBOURS) {
            const nk = key(cur.r + dr, cur.c + dc)
            if (own.has(nk) && !visited.has(nk)) {
              visited.add(nk)
              queue.push({ r: cur.r + dr, c: cur.c + dc })
            }
          }
        }
        components.push(comp)
      }
    }

    let ends: Cell[]
    let isolated: Cell[]
    let bridged = false

    if (components.length <= 1) {
      // The ordinary single-run case.
      ends = cells.filter((c) => (degree.get(key(c.r, c.c)) ?? 0) === 1)
      isolated = cells.filter((c) => (degree.get(key(c.r, c.c)) ?? 0) === 0)
      if (isolated.length) {
        errors.push(`R2: edge "${edge.id}" has isolated path cell(s) at ${isolated.map((c) => `(${c.r},${c.c})`).join(' ')}`)
      }
      if (!branches.length && !isolated.length && ends.length !== 2) {
        errors.push(`R2: edge "${edge.id}" has ${ends.length} path end(s), it needs exactly 2 — a closed loop or a broken path`)
      }
      // R4 rule: a label sits INSIDE its own lane, not beside it. A path that is already
      // one connected piece without the label's help means the label never split it — it is
      // sitting next to the line, not in it. Widen the gap and put a path cell on each side.
      if (labels.length) {
        errors.push(
          `R4: label of edge "${edge.id}" sits beside a fully-connected path instead of inside it — split the path around the label (a path cell touching each side), not next to it`
        )
      }
    } else {
      // Cut into pieces. The label is one filled rectangle (R4), so it is already connected
      // to itself — touching every piece is enough to make the whole thing one unit.
      const touchedComponents = new Set<number>()
      components.forEach((comp, i) => {
        const touches = comp.some((cell) => NEIGHBOURS.some(([dr, dc]) => labelSet.has(key(cell.r + dr, cell.c + dc))))
        if (touches) touchedComponents.add(i)
      })
      bridged = labels.length > 0 && touchedComponents.size === components.length

      if (!bridged) {
        errors.push(`R2: edge "${edge.id}" is in ${components.length} disconnected piece(s) — its path is cut`)
        ends = cells.filter((c) => (degree.get(key(c.r, c.c)) ?? 0) === 1)
        isolated = cells.filter((c) => (degree.get(key(c.r, c.c)) ?? 0) === 0)
        if (isolated.length) {
          errors.push(`R2: edge "${edge.id}" has isolated path cell(s) at ${isolated.map((c) => `(${c.r},${c.c})`).join(' ')}`)
        }
      } else {
        // Bridged: a path cell that touches the label counts that as a neighbour too, the
        // same way it would count a path cell it directly abuts.
        const total = new Map<string, number>()
        for (const cell of cells) {
          let n = degree.get(key(cell.r, cell.c)) ?? 0
          for (const [dr, dc] of NEIGHBOURS) if (labelSet.has(key(cell.r + dr, cell.c + dc))) n++
          total.set(key(cell.r, cell.c), n)
        }
        const bridgeBranches = cells.filter((c) => (total.get(key(c.r, c.c)) ?? 0) > 2)
        if (bridgeBranches.length) {
          errors.push(
            `R2: edge "${edge.id}" branches at its inline label near ${bridgeBranches.map((c) => `(${c.r},${c.c})`).join(' ')} — a path cell may touch 1 or 2 same-edge cells, not more`
          )
        }
        ends = cells.filter((c) => (total.get(key(c.r, c.c)) ?? 0) === 1)
        isolated = cells.filter((c) => (total.get(key(c.r, c.c)) ?? 0) === 0)
        if (isolated.length) {
          errors.push(`R2: edge "${edge.id}" has isolated path cell(s) at ${isolated.map((c) => `(${c.r},${c.c})`).join(' ')}`)
        }
        if (!bridgeBranches.length && !isolated.length && ends.length !== 2) {
          errors.push(`R2: edge "${edge.id}" has ${ends.length} path end(s), it needs exactly 2 — a closed loop or a broken path`)
        }
        if (!bridgeBranches.length && !isolated.length && ends.length === 2) index.bridgedEdges.add(edge.id)
      }
    }

    // R3: the two ends touch the right cards, and they touch them the right way round.
    if (ends.length === 2 && (components.length <= 1 || bridged)) {
      const touches = (cell: Cell, cardId: string) =>
        NEIGHBOURS.some(([dr, dc]) => index.cardAt.get(key(cell.r + dr, cell.c + dc)) === cardId)
      const ok =
        (touches(ends[0], edge.from) && touches(ends[1], edge.to)) || (touches(ends[1], edge.from) && touches(ends[0], edge.to))
      if (!ok) {
        errors.push(
          `R3: edge "${edge.id}" ends at ${ends.map((c) => `(${c.r},${c.c})`).join(' and ')}, which do not touch "${edge.from}" and "${edge.to}"`
        )
      }
    }

    // R4: the label is a filled rectangle that touches its own path. A label cell can never
    // also be a path cell, because a cell holds one token — but the rule is written out so a
    // future format that allows two tokens in a cell fails here instead of drawing text on a
    // line. When the label bridges a cut path (above), it already touches every piece, so this
    // "touches at least one" check is automatically satisfied — no separate inline case here.
    if (labels.length) {
      const problem = rectProblem(labels)
      if (problem) errors.push(`R4: label of edge "${edge.id}" is not a filled rectangle — ${problem}`)
      const onPath = labels.filter((c) => own.has(key(c.r, c.c)))
      if (onPath.length) {
        errors.push(`R4: label of edge "${edge.id}" sits on its own path at ${onPath.map((c) => `(${c.r},${c.c})`).join(' ')}`)
      }
      const adjacent = labels.some((cell) => NEIGHBOURS.some(([dr, dc]) => own.has(key(cell.r + dr, cell.c + dc))))
      if (!adjacent) {
        errors.push(
          `R4: label of edge "${edge.id}" at ${labels.map((c) => `(${c.r},${c.c})`).join(' ')} touches no cell of that edge's path`
        )
      }
    }
  }

  // R6: a junction is a crossing, not a turn and not a branch either edge would take on its
  // own — the whole point is that each edge reads, from its OWN side, as if the other one
  // were not there. So each of the two edges must pass straight through this exact cell (2
  // neighbours of its own, on opposite sides), and the two must cross on DIFFERENT axes —
  // two edges both running north-south through the same cell are not crossing, they are the
  // same lane, and that is a collision the format already refuses everywhere else.
  for (const j of index.junctions) {
    const axisOf = (edgeId: string): 'vertical' | 'horizontal' | null => {
      const own = new Set((index.pathCells.get(edgeId) ?? []).map((cell) => key(cell.r, cell.c)))
      const has = (dr: number, dc: number) => own.has(key(j.r + dr, j.c + dc))
      if (has(-1, 0) && has(1, 0) && !has(0, -1) && !has(0, 1)) return 'vertical'
      if (has(0, -1) && has(0, 1) && !has(-1, 0) && !has(1, 0)) return 'horizontal'
      return null
    }
    const axes = j.ids.map((id) => ({ id, axis: axisOf(id) }))
    for (const { id, axis } of axes) {
      if (!axis) {
        errors.push(
          `R6: junction at (${j.r},${j.c}) — edge "${id}" does not pass straight through (needs exactly 2 opposite neighbours of its own)`
        )
      }
    }
    if (axes[0].axis && axes[1].axis && axes[0].axis === axes[1].axis) {
      errors.push(`R6: junction at (${j.r},${j.c}) — "${j.ids[0]}" and "${j.ids[1]}" both run ${axes[0].axis}, not a crossing`)
    }
  }

  return { errors, index }
}
