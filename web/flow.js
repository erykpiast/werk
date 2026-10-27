// The Flow tab: telemetry on the map, beside the map, the graph, the diagram, and the board.
// See #vi-flowtab, #vi-flow-telemetry, #vi-flowtab-subtrees, #vi-flowtab-list.
//
// The server sends the status history of each card (/api/flow). Everything here is an
// aggregation of that history over a scope: the whole map, or one subtree. A click on a
// subtree row narrows every section to it, the stats and the list together. Measures that
// belong to passes, runs and conversations are in the Measure tab (#vi-measure).

import { WHAT } from './md.js'

const STATUSES = ['open', 'proto', 'decided']
// #vi-flowtab-removed: removed cards show under their own filter only, never under all.
const FILTERS = ['all', ...STATUSES, 'stale', 'postponed', 'proposed', 'removed']

/** A card is in a status filter by its status, in a mark filter by the mark set. */
const inFilter = (G, id, f) => (STATUSES.includes(f) ? G.byId.get(id)?.status === f : G[f].has(id))

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let opts = null // { root, graph, openCard, openScope, rollupBar }
let flows = null // the last /api/flow
let mounted = false
let scope = WHAT
let filter = 'all'
let query = ''
let sortKey = 'last' // the Cards list: 'id', 'status', or 'last'
let sortDir = 'desc'
let depth = 'top' // which subtrees get a row: 'top' (children of the scope) or 'all' (every parent)

export function initFlow(o) {
  opts = o
  opts.root.addEventListener('click', onClick)
  opts.root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('th[data-sort]')) {
      e.preventDefault()
      onClick(e)
    }
  })
  opts.root.addEventListener('input', (e) => {
    if (!e.target.matches('.flow-search')) return
    query = e.target.value.trim().toLowerCase()
    renderList()
  })
}

/** The scope is part of the address, `/flow/<id>` (#vi-routes). A row click asks for a new
 *  address through `openScope`, and the address sets the scope here. */
export function setFlowScope(id) {
  if (id === scope) return
  scope = id
  if (mounted && flows) render()
}

export const flowScope = () => scope

export async function mountFlow() {
  mounted = true
  await refreshFlow()
}

export function unmountFlow() {
  mounted = false
}

/** Called on every log change. A hidden tab does not fetch. */
export async function refreshFlow() {
  if (!mounted) return
  flows = await (await fetch('/api/flow')).json()
  render()
}

// ---------- the data ----------

function children(G) {
  const map = new Map()
  for (const e of G.edges) {
    if (e.type !== 'refines') continue
    const list = map.get(e.to) ?? []
    list.push(e.from)
    map.set(e.to, list)
  }
  return map
}

/** The card ids in the refines subtree of `id`, the card included. */
function subtree(G, kids, id) {
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    for (const k of kids.get(queue.shift()) ?? []) {
      if (seen.has(k)) continue
      seen.add(k)
      queue.push(k)
    }
  }
  return new Set([...seen].filter((x) => G.byId.get(x)?.kind === 'card'))
}

/** The live depends_on edges between two cards. Held edges of a ghost are not in G.edges. */
function cardDeps(G) {
  const isCard = (id) => G.byId.get(id)?.kind === 'card'
  return G.edges.filter((e) => e.type === 'depends_on' && isCard(e.from) && isCard(e.to))
}

/**
 * Cross-tree depends_on edges in the scope: an edge counts when its ends sit under different
 * direct children of the scope, the scope card being one more part. See #vi-flowtab-xdeps.
 */
function crossTotal(G, kids, deps) {
  const part = new Map([[scope, scope]])
  for (const k of kids.get(scope) ?? []) for (const id of subtree(G, kids, k)) part.set(id, k)
  return deps.filter((e) => part.has(e.from) && part.has(e.to) && part.get(e.from) !== part.get(e.to)).length
}

/** Edges into and out of one subtree. */
function crossInOut(ids, deps) {
  let inN = 0
  let outN = 0
  for (const e of deps) {
    const f = ids.has(e.from)
    const t = ids.has(e.to)
    if (f && !t) outN++
    else if (t && !f) inN++
  }
  return { in: inN, out: outN }
}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The loop numbers for a set of cards:
 * - how long a card holds each status before it moves, and how long the cards in it now
 *   have held it
 * - the traffic on each arrow, reopens split by reason
 */
function loopStats(ids, byFlow, now) {
  const held = { open: [], proto: [], decided: [] }
  const holding = { open: [], proto: [], decided: [] }
  const arrows = new Map() // "from>to" -> { n, reasons: {} }
  const toDecide = []
  const born = { open: 0, proto: 0, decided: 0 } // the status a card enters the map with
  for (const id of ids) {
    const steps = byFlow.get(id)
    if (!steps) continue
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const t = Date.parse(s.at)
      if (s.from) {
        const key = `${s.from}>${s.to}`
        const a = arrows.get(key) ?? { n: 0, reasons: {} }
        a.n++
        if (s.reason) a.reasons[s.reason] = (a.reasons[s.reason] ?? 0) + 1
        arrows.set(key, a)
      }
      const next = steps[i + 1]
      if (next) held[s.to]?.push(Date.parse(next.at) - t)
      else holding[s.to]?.push(now - t)
    }
    // A card that enters already decided has no time to decide. It is counted apart, not as 0.
    if (steps[0].to in born) born[steps[0].to]++
    if (steps[0].to !== 'decided') {
      const firstDecided = steps.find((s) => s.to === 'decided')
      if (firstDecided) toDecide.push(Date.parse(firstDecided.at) - Date.parse(steps[0].at))
    }
  }
  return {
    held: Object.fromEntries(STATUSES.map((k) => [k, median(held[k])])),
    heldN: Object.fromEntries(STATUSES.map((k) => [k, held[k].length])),
    holding: Object.fromEntries(STATUSES.map((k) => [k, median(holding[k])])),
    toDecide: median(toDecide),
    born,
    arrows,
  }
}

function dur(ms) {
  if (ms == null) return '—'
  const m = ms / 60000
  if (m < 1) return '<1m'
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// ---------- render ----------

function render() {
  const G = opts.graph()
  if (!G || !flows) return
  if (!G.byId.has(scope)) scope = WHAT
  const kids = children(G)
  const ids = subtree(G, kids, scope)
  const byFlow = new Map(flows.cards.map((c) => [c.id, c.steps]))
  const st = loopStats(ids, byFlow, Date.now())
  const r = G.rollup?.[scope] ?? {}
  const proposed = proposals(G, ids)
  const deps = cardDeps(G)

  opts.root.innerHTML = `
    <div class="flow-scope">
      ${scope === WHAT ? '<b>Whole map</b>' : `<button data-scope="${WHAT}">Whole map</button> › <b>${esc(G.byId.get(scope)?.title)}</b> <button class="flow-open" data-open="${esc(scope)}">open card</button>`}
    </div>
    <section class="flow-tiles">
      ${tile('cards', r.cards ?? ids.size)}
      ${STATUSES.map((k) => tile(k, r[k] ?? 0, k, k)).join('')}
      ${tile('stale', r.stale ?? 0, 'stale', 'stale')}
      ${tile('postponed', r.postponed ?? 0, 'postponed', 'postponed')}
      ${tile('proposed', proposed.length, 'pending', 'proposed')}
      ${tile('median to decide', dur(st.toDecide))}
      ${tile('cross-tree deps', crossTotal(G, kids, deps))}
    </section>
    <section class="flow-section">
      <h3>The loop</h3>
      ${loopHtml(st)}
    </section>
    <section class="flow-section">
      <h3>Subtrees
        <span class="flow-seg">
          <button data-depth="top" class="${depth === 'top' ? 'on' : ''}">direct children</button><button data-depth="all" class="${depth === 'all' ? 'on' : ''}">every parent</button>
        </span>
      </h3>
      ${subtreesHtml(G, kids, byFlow, deps)}
    </section>
    <section class="flow-section">
      <h3>Cards</h3>
      <div class="flow-filters">
        ${FILTERS.map((f) => `<button data-filter="${f}" class="${f === filter ? 'on' : ''} f-${f}">${f} <small>${filterCount(G, ids, proposed, f)}</small></button>`).join('')}
        <input class="flow-search" type="search" placeholder="filter by id or title…" value="${esc(query)}">
      </div>
      <div id="flow-list"></div>
    </section>`
  renderList()
}

function tile(label, value, color, filterKey) {
  const attr = filterKey ? ` data-filter="${filterKey}"` : ''
  const style = color ? ` style="--c:var(--${color === 'pending' ? 'proto' : color})"` : ''
  return `<button class="flow-tile${color ? ' colored' : ''}"${attr}${style}><span class="v">${value}</span><span class="l">${esc(label)}</span></button>`
}

/**
 * The status loop drawn as a diagram: three boxes, an arrow for every move between them,
 * and an arrow into each box for the cards that enter the map at that status. The layout is
 * CSS only: a container query turns the row of boxes into a column when the pane is narrow.
 */
function loopHtml(st) {
  const label = (from, to, text) => {
    const x = st.arrows.get(`${from}>${to}`)
    const reasons = x && Object.keys(x.reasons).length
      ? `<small>${Object.entries(x.reasons).map(([k, v]) => `${v} ${k}`).join(' · ')}</small>`
      : ''
    return `<span class="lab"><b>${x?.n ?? 0}</b> ${text}</span>${reasons}`
  }
  // A short arrow between two neighbor boxes. `fwd` points toward decided, `back` toward open.
  const step = (from, to, dir) => `<div class="fl-step ${dir}"><i class="ln"></i><span class="fl-txt">${label(from, to, `${from} → ${to}`)}</span></div>`
  const box = (k) => `<div class="flow-box fl-${k}" style="--c:var(--${k})">
      <b>${k}</b>
      <span>holds <em>${dur(st.held[k])}</em> before it moves <small>(${st.heldN[k]} moves)</small></span>
      <span>cards in it now: <em>${dur(st.holding[k])}</em> so far</span>
    </div>`
  const enter = (k) => `<div class="fl-in fl-in-${k}"><i class="ln"></i><span><b>${st.born[k]}</b> new</span></div>`
  return `<div class="fl-wrap"><div class="fl">
      ${STATUSES.map(enter).join('')}
      ${STATUSES.map(box).join('')}
      <div class="fl-mid fl-op">${step('open', 'proto', 'fwd')}${step('proto', 'open', 'back')}</div>
      <div class="fl-mid fl-pd">${step('proto', 'decided', 'fwd')}</div>
      <div class="fl-u fl-skip"><span class="fl-txt">${label('open', 'decided', '<span class="w-only">open → decided, </span>no prototype')}</span></div>
      <div class="fl-u fl-reop"><span class="fl-txt">${label('decided', 'open', 'reopen<span class="w-only">: decided → open</span>')}</span></div>
    </div></div>
    <p class="flow-note">Numbers on arrows count moves. One card can make the same move more than once. "New" counts the cards that entered the map at that status.
      Times are medians. Every card added in the first seeding of the log shares one timestamp, so very old moves read as &lt;1m.</p>`
}

/**
 * The first column of a flow table: the id, and the title beside it. The column takes the
 * width the other columns leave. When that width is too small for the title, CSS hides the
 * title and only the id stays. The row keeps the title as a tooltip. See #vi-flowtab-narrow.
 *
 * The id and the title open the card on the map. The rest of the row narrows the scope to
 * it. See #vi-flowtab-click.
 */
function nameCell(id, title) {
  return `<td class="flow-name" title="${esc(title ?? '')}"><div><span class="flow-id flow-link" data-open="${esc(id)}">#${esc(id)}</span><span class="flow-tw"><span class="flow-title flow-link" data-open="${esc(id)}">${esc(title ?? '')}</span></span></div></td>`
}

function subtreesHtml(G, kids, byFlow, deps) {
  let rows
  if (depth === 'top') rows = (kids.get(scope) ?? []).filter((id) => G.byId.get(id)?.kind === 'card')
  else {
    const inScope = subtree(G, kids, scope)
    rows = [...inScope].filter((id) => id !== scope && (kids.get(id) ?? []).some((k) => G.byId.get(k)?.kind === 'card'))
  }
  rows = rows
    .map((id) => ({ id, r: G.rollup?.[id] ?? { cards: 1 } }))
    .sort((x, y) => y.r.cards - x.r.cards)
  if (!rows.length) return '<p class="flow-note">No subtrees below this card.</p>'
  const now = Date.now()
  // Rows for every parent nest, so one edge is out for a child and internal to its parent.
  // The in / out column only means something for disjoint rows. See #vi-flowtab-xdeps.
  const showXdeps = depth === 'top'
  return `<table class="flow-table">
    <thead><tr><th>subtree</th><th class="num">cards</th><th class="bar-col">status</th><th class="num">open</th><th class="num">proto</th><th class="num">decided</th><th class="num">stale</th><th class="num">postponed</th><th class="num">reopens</th><th class="num">to decide</th>${showXdeps ? '<th class="num" title="depends_on edges into / out of this subtree">in / out</th>' : ''}</tr></thead>
    <tbody>${rows
      .map(({ id, r }) => {
        const ids = subtree(G, kids, id)
        const st = loopStats(ids, byFlow, now)
        const reopens = st.arrows.get('decided>open')?.n ?? 0
        const x = showXdeps ? crossInOut(ids, deps) : null
        return `<tr data-scope="${esc(id)}">
          ${nameCell(id, G.byId.get(id)?.title)}
          <td class="num">${r.cards}</td>
          <td class="bar-col">${opts.rollupBar(r)}</td>
          <td class="num">${r.open || ''}</td><td class="num">${r.proto || ''}</td><td class="num">${r.decided || ''}</td>
          <td class="num stale">${r.stale || ''}</td><td class="num postponed">${r.postponed || ''}</td>
          <td class="num">${reopens || ''}</td><td class="num">${dur(st.toDecide)}</td>
          ${x ? `<td class="num">${x.in || x.out ? `${x.in} / ${x.out}` : ''}</td>` : ''}
        </tr>`
      })
      .join('')}</tbody></table>`
}

/** Ghost cards and staged edits, inside the scope. A ghost has no refines edge yet, so it
 *  counts as inside when its held parent edge points into the scope. */
function proposals(G, ids) {
  const parentOfGhost = new Map(G.ghostEdges.filter((e) => e.type === 'refines').map((e) => [e.from, e.to]))
  return G.nodes.filter(
    (n) => (n.proposed && (scope === WHAT || ids.has(parentOfGhost.get(n.id)))) || (n.pending && ids.has(n.id)),
  )
}

function filterCount(G, ids, proposed, f) {
  if (f === 'all') return ids.size
  if (f === 'proposed') return proposed.length
  if (f === 'removed') return removedRows(G).length
  return [...ids].filter((id) => inFilter(G, id, f)).length
}

/** The cards out of the map, newest removal first, narrowed by the search. A removed card has
 *  no place in the tree, so the scope does not narrow them (#werk-remove). */
function removedRows(G) {
  return (G.removed ?? [])
    .filter((r) => !query || r.id.toLowerCase().includes(query) || (r.title ?? '').toLowerCase().includes(query))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** No data-scope on the row: a removed card has no page to open. Its restore button does. */
function removedList(G, box) {
  const rows = removedRows(G)
  box.innerHTML = rows.length
    ? `<table class="flow-table flow-cards"><thead><tr><th>card</th><th class="num">removed</th><th></th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr class="removed-row">
            <td><span class="flow-id">#${esc(r.id)}</span> ${esc(r.title)}</td>
            <td class="num">${esc(r.at.slice(0, 10))}</td>
            <td class="num"><button type="button" class="tag" data-restore="${esc(r.id)}">restore</button></td>
          </tr>`,
        )
        .join('')}</tbody></table>`
    : `<p class="flow-note">No card is removed.</p>`
}

function renderList() {
  const G = opts.graph()
  const box = document.getElementById('flow-list')
  if (!G || !box) return
  if (filter === 'removed') return removedList(G, box)
  const kids = children(G)
  const ids = subtree(G, kids, scope)
  const last = new Map(flows.cards.map((c) => [c.id, c.steps[c.steps.length - 1]?.at]))
  let rows =
    filter === 'proposed'
      ? proposals(G, ids)
      : [...ids].filter((id) => filter === 'all' || inFilter(G, id, filter)).map((id) => G.byId.get(id))
  if (query) rows = rows.filter((n) => n.id.toLowerCase().includes(query) || (n.title ?? '').toLowerCase().includes(query))
  const dir = sortDir === 'asc' ? 1 : -1
  const byLast = (a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? '')
  const rank = (n) => {
    const i = STATUSES.indexOf(n.status)
    return i < 0 ? STATUSES.length : i
  }
  const compare = {
    id: (a, b) => a.id.localeCompare(b.id),
    status: (a, b) => rank(a) - rank(b) || byLast(b, a),
    last: byLast,
  }[sortKey]
  // A card with no move yet sorts last in either direction.
  rows.sort((a, b) => {
    if (sortKey === 'last' && !last.get(a.id) !== !last.get(b.id)) return last.get(a.id) ? -1 : 1
    return dir * compare(a, b)
  })
  const now = Date.now()
  const th = (key, label, cls = '') => {
    const on = sortKey === key
    return `<th class="sortable${cls}${on ? ' sorted' : ''}" data-sort="${key}" aria-sort="${on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0">${label}${on ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`
  }
  box.innerHTML = rows.length
    ? `<table class="flow-table flow-cards"><thead><tr>${th('id', 'card')}${th('status', 'status')}<th>marks</th>${th('last', 'last move', ' num')}</tr></thead><tbody>${rows
        .map((n) => {
          const marks = [
            G.stale.has(n.id) ? '<span class="tag stale">stale</span>' : '',
            G.postponed.has(n.id) ? '<span class="tag postponed">postponed</span>' : '',
            n.proposed ? '<span class="tag ghost">new card</span>' : '',
            n.pending ? '<span class="tag pending">edit</span>' : '',
            G.unchallenged.has(n.id) ? '<span class="tag unchallenged">no option</span>' : '',
          ].join('')
          const at = last.get(n.id)
          return `<tr data-scope="${esc(n.id)}">
            ${nameCell(n.id, n.title)}
            <td><span class="tag ${esc(n.status)}">${esc(n.status ?? '')}</span></td>
            <td class="marks">${marks}</td>
            <td class="num">${at ? dur(now - Date.parse(at)) + ' ago' : '—'}</td>
          </tr>`
        })
        .join('')}</tbody></table>`
    : `<p class="flow-note">No cards match.</p>`
}

function onClick(e) {
  const t = e.target.closest('[data-open],[data-scope],[data-filter],[data-depth],[data-sort]')
  if (!t) return
  if (t.dataset.sort) {
    // A new column starts in its natural order: the card list by id and status up, time newest first.
    if (t.dataset.sort === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    else {
      sortKey = t.dataset.sort
      sortDir = sortKey === 'last' ? 'desc' : 'asc'
    }
    return renderList()
  }
  if (t.dataset.open) return opts.openCard(t.dataset.open)
  if (t.dataset.scope) return opts.openScope(t.dataset.scope)
  if (t.dataset.depth) {
    depth = t.dataset.depth
    return render()
  }
  if (t.dataset.filter) {
    filter = t.dataset.filter === filter && t.classList.contains('flow-tile') ? 'all' : t.dataset.filter
    render()
    if (t.classList.contains('flow-tile')) document.getElementById('flow-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/** The map changed: redraw from the graph already in memory and the fresh history. */
export function onGraph() {
  refreshFlow()
}
