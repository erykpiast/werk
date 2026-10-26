// #vi-sysdiag-grid, step 1: read a .wgrid file into two independent halves.
//
// CONTENT is what exists and what it says. GRID is where it sits. Neither half can express
// the other's job, which is the whole point of the split — CONTENT never names a cell, GRID
// never names a title.
//
// The Mermaid subset here is hand-rolled on purpose. We need four facts out of the content
// section (node, subgraph, edge, class) and nothing else; a real Mermaid parser would be a
// dependency this repo does not have and would still not give us cells.

export type GridCard = {
  id: string
  title: string
  desc: string
  cls: string
  // The map cards that decided this element — #vi-sysdiag-backedge. Inline on the node's own
  // line as `@id,id`, not in a separate mapping block, per #vi-sysdiag-intent-edgecard: a
  // node's citation already lives on the line that names the node.
  cards: string[]
}

export type GridGroup = {
  id: string
  title: string
  members: string[]
  // Ids of the groups opened directly inside this one. resolve.ts grows the frame to hold them.
  subgroups: string[]
}

export type GridEdge = {
  // `<from>-><to>`. Mermaid does not name an edge and does not need to: the pair is already
  // unique and already written in the content section. The grid section refers to the edge
  // by this derived id, so nothing has to be declared twice. The `->` separator (not `_`) is
  // what #vi-sysdiag-grid-gaps's gap 5 asked for: `_` collides with any card id containing an
  // underscore, and `a_b -> c` / `a -> b_c` both derived `a_b_c` before, a guess disguised as
  // a rule. No card id can contain `->`, so a grid token is unambiguous now, always.
  id: string
  from: string
  to: string
  label: string
  cls: string
  // Same `@id,id` suffix as a node's, for the same reason — #vi-sysdiag-intent-edgecard.
  // A list, not the single card that card accepted as a loss: the browser now uses these ids
  // as a live two-way link (#vi-sysdiag-link), so a dropped citation is a dead link, not just
  // a missing footnote.
  cards: string[]
}

export type Token =
  | { kind: 'empty' }
  // `~`: empty, but its column and row keep at least one lane's width. A column of `.` alone
  // collapses to nothing, so a spacer is the only way to buy air between two cards.
  // #vi-sysdiag-grid-gaps, gap 4.
  | { kind: 'spacer' }
  | { kind: 'card'; id: string }
  | { kind: 'path'; id: string }
  | { kind: 'label'; id: string }
  // Two edges crossing on purpose, at one cell the author names explicitly — never inferred,
  // per #vi-sysdiag-grid-lanewall. `<edgeA>+<edgeB>` (a `+` a card id or an edge id can never
  // contain). The two must pass straight through on different axes (check.ts's R6): a
  // junction is a crossing, not a turn, and not a branch either edge's own path would take on
  // its own.
  | { kind: 'junction'; ids: [string, string] }
  | { kind: 'unknown'; raw: string }

export type GridDoc = {
  cards: GridCard[]
  groups: GridGroup[]
  edges: GridEdge[]
  // Ragged until check.ts's R5 says otherwise — the parser reports what is written, it does
  // not pad a short row into a well-formed one.
  rows: Token[][]
  cardById: Map<string, GridCard>
  edgeById: Map<string, GridEdge>
}

const NODE_RE = /^([A-Za-z0-9_-]+)\s*\[\s*"([^"]*)"\s*\](?:\s*@([A-Za-z0-9_,:-]+))?$/
const SUBGRAPH_RE = /^subgraph\s+([A-Za-z0-9_-]+)\s*\[\s*([^\]]*?)\s*\]$/
const EDGE_RE = /^([A-Za-z0-9_-]+)\s*--+>\s*(?:\|([^|]*)\|\s*)?([A-Za-z0-9_-]+)(?:\s*@([A-Za-z0-9_,:-]+))?$/
const CLASS_RE = /^class\s+([A-Za-z0-9_,>-]+)\s+([A-Za-z0-9_-]+)$/

/** `@a,b` -> ['a','b']. An option id like `vi-sysdiag:opt0` keeps its colon. */
function cardList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseGrid(text: string): GridDoc {
  const cards: GridCard[] = []
  const groups: GridGroup[] = []
  const edges: GridEdge[] = []
  const rawRows: string[][] = []
  const classOf = new Map<string, string>()

  let section: 'none' | 'content' | 'grid' = 'none'
  const groupStack: GridGroup[] = []

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) continue

    // A section opens only at zero indentation. That is what keeps `content` and `grid` from
    // colliding with anything a Mermaid body might legitimately contain.
    const indented = /^\s/.test(raw)
    if (!indented && (line === 'content' || line === 'grid')) {
      section = line
      continue
    }

    if (section === 'content') {
      if (line === 'end') {
        groupStack.pop()
        continue
      }
      if (/^flowchart\b/.test(line) || /^graph\b/.test(line)) continue

      const sub = SUBGRAPH_RE.exec(line)
      if (sub) {
        const group: GridGroup = { id: sub[1], title: sub[2], members: [], subgroups: [] }
        if (groupStack.length) groupStack[groupStack.length - 1].subgroups.push(group.id)
        groups.push(group)
        groupStack.push(group)
        continue
      }

      const cls = CLASS_RE.exec(line)
      if (cls) {
        for (const id of cls[1].split(',')) classOf.set(id.trim(), cls[2])
        continue
      }

      const node = NODE_RE.exec(line)
      if (node) {
        const [title, ...rest] = node[2].split('|')
        const card: GridCard = {
          id: node[1],
          title: title.trim(),
          desc: rest.join('|').trim(),
          cls: '',
          cards: cardList(node[3]),
        }
        cards.push(card)
        if (groupStack.length) groupStack[groupStack.length - 1].members.push(card.id)
        continue
      }

      const edge = EDGE_RE.exec(line)
      if (edge) {
        edges.push({
          id: `${edge[1]}->${edge[3]}`,
          from: edge[1],
          to: edge[3],
          label: (edge[2] ?? '').trim(),
          cls: '',
          cards: cardList(edge[4]),
        })
        continue
      }

      throw new Error(`line ${i + 1}: cannot parse content line: ${line}`)
    }

    if (section === 'grid') {
      const quoted = /^"(.*)"$/.exec(line)
      if (!quoted) throw new Error(`line ${i + 1}: a grid row must be one quoted string: ${line}`)
      rawRows.push(quoted[1].trim().split(/\s+/).filter(Boolean))
      continue
    }

    throw new Error(`line ${i + 1}: content before any section header: ${line}`)
  }

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  // A class statement may name a card or an edge id. A card gets its class directly; an edge
  // with no class of its own inherits its source card's, so a line reads as leaving the thing
  // it leaves. `read` is the last resort.
  for (const c of cards) c.cls = classOf.get(c.id) ?? ''
  for (const e of edges) e.cls = classOf.get(e.id) || cardById.get(e.from)?.cls || 'read'

  // Second pass over the raw grid tokens, now that both id maps exist.
  const typed: Token[][] = rawRows.map((row) =>
    row.map((raw): Token => {
      if (raw === '.') return { kind: 'empty' }
      if (raw === '~') return { kind: 'spacer' }
      if (raw.startsWith('@')) {
        const id = raw.slice(1)
        return edgeById.has(id) ? { kind: 'label', id } : { kind: 'unknown', raw }
      }
      if (raw.includes('+')) {
        const parts = raw.split('+')
        if (parts.length === 2 && parts[0] !== parts[1] && edgeById.has(parts[0]) && edgeById.has(parts[1])) {
          return { kind: 'junction', ids: [parts[0], parts[1]] }
        }
        return { kind: 'unknown', raw }
      }
      if (cardById.has(raw)) return { kind: 'card', id: raw }
      if (edgeById.has(raw)) return { kind: 'path', id: raw }
      return { kind: 'unknown', raw }
    })
  )

  return { cards, groups, edges, rows: typed, cardById, edgeById }
}
