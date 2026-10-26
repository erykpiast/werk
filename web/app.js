// One view = one node. The same layout renders the root, a leaf, and a source.

// First: it scopes every /api request of this page to the project in the address.
import { BASE, projectKey } from './project.js'
import { initProjects, refreshProjects } from './projects.js'
import { cardHref, cardLinks, cardOfHref, HOME, md, mdInline, nextPhrase } from './md.js'
import { renderInlineDiff, renderOpsMarkdown } from './diff.js'
import { initBoard, mountBoard, onPlanLog, onTicketLog, openPlan, redrawDrawer, refreshBoard, restartSubtree, resumeSubtree, unmountBoard } from './board.js'
import { flowScope, initFlow, mountFlow, refreshFlow, setFlowScope, unmountFlow } from './flow.js'
import { initMeasure, mountMeasure, refreshMeasure, unmountMeasure } from './measure.js'

// #werk-projects: with no project that opens in the address, there is no map to start. The
// page in place of the map is the whole page, so the rest of this module never runs.
if (!(await initProjects())) await new Promise(() => {})

let G = null

// ---------- routes ----------
// #vi-routes: each view has its own address. `/map/<id>` and `/flow/<id>` carry a card, the
// other views carry none. Back and Forward walk these addresses.
const VIEWS = ['map', 'graph', 'diagram', 'board', 'flow', 'measure']
/** The card open on the map. It outlives a switch to another view. */
let mapCard = HOME
/** Subtrees with a running plan (#vi-board-plan). */
let livePlans = new Set()

/** A malformed escape such as `%` is kept as typed: the page then says no such card exists. */
function decodeId(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function parseRoute() {
  // #vi-routes: the address starts with the project, `/p/<name>`. The view and card follow.
  const [, v = '', id = ''] = location.pathname.slice(BASE.length).split('/')
  // A bare map address is the home (#vi-home-howwhat). A bare Flow address is the whole map.
  const view = VIEWS.includes(v) ? v : null
  return { view, id: decodeId(id) || (view === 'flow' ? 'root' : HOME) }
}
const routeView = () => parseRoute().view ?? 'map'
// #vi-routes: the id is URL-encoded, so any id makes a valid address.
const bare = (view, id) => id === HOME || (view === 'flow' && id === 'root') || !['map', 'flow'].includes(view)
const pathFor = (view, id = HOME) => BASE + (bare(view, id) ? `/${view}` : `/${view}/${encodeURIComponent(id)}`)
/** The card the chat's next message carries: the Flow scope in Flow, else the map card. */
const chatCard = () => (routeView() === 'flow' ? flowScope() : mapCard)

function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return applyRoute()
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  applyRoute()
}

// An old address `/#id`, or a `#id` link opened in a new tab, lands on the map card.
const startHash = decodeId(location.hash.slice(1))
if (startHash) history.replaceState(null, '', pathFor('map', startHash))
else if (!parseRoute().view) {
  const v = localStorage.getItem(projectKey('werk-view'))
  history.replaceState(null, '', pathFor(VIEWS.includes(v) ? v : 'map'))
}
/** Did the first address name a map card? Then it wins over the active tab's position. */
const startedOnCard = parseRoute().view === 'map' && parseRoute().id !== HOME

const el = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const node = (id) => G.byId.get(id)
/**
 * Is this id a card on the map? Only a real id becomes a link, so a click always lands
 * somewhere. The chat pane renders before the graph arrives, hence the guard on G.
 */
const knows = (id) => Boolean(G?.byId.has(id))
/** An excerpt has no title. Its first line of text is the title. */
const titleHTML = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>')
const titleOf = (n) => n?.title || n?.context || (n?.text ?? '').slice(0, 90) || n?.id || '(untitled)'
/**
 * Edges as the map draws them: live ones, plus the held ones hanging off a ghost card.
 * Nothing is derived from a held edge — see fold.ts — but a proposed card has to be
 * reachable, or it is a card nobody can accept. #werk-propose-new.
 */
const allEdges = () => (G.ghostEdges?.length ? G.edges.concat(G.ghostEdges) : G.edges)
const out = (id, type) => allEdges().filter((e) => e.from === id && e.type === type).map((e) => e.to)
const inc = (id, type) => allEdges().filter((e) => e.to === id && e.type === type).map((e) => e.from)
/** A depends_on link's reason — #vi-prop-linkwhy. Older links have none. */
const linkWhy = (from, to) =>
  allEdges().find((e) => e.from === from && e.to === to && e.type === 'depends_on')?.why ?? 'No reason recorded.'

/** A ghost sorts last among siblings: the real map first, then what is waiting on you. */
const children = (id) => inc(id, 'refines').sort((a, b) => Number(isGhost(a)) - Number(isGhost(b)))
const parent = (id) => out(id, 'refines')[0]
const isGhost = (id) => G.proposed.has(id)

function ancestors(id) {
  const chain = []
  let p = parent(id)
  const seen = new Set([id])
  while (p && !seen.has(p)) {
    chain.unshift(p)
    seen.add(p)
    p = parent(p)
  }
  return chain
}

/**
 * The rollup for one card, over its refines subtree.
 *
 * Computed on the server by deriveRollup and read from the graph. The browser used to
 * walk the tree itself, with a different definition: it left the card out and it had no
 * unchallenged count. Two answers to one question is one answer too many.
 */
const rollup = (id) => G.rollup?.[id]

/** How many cards one ✕ would take: this card, plus its refines subtree. #werk-remove. */
const subtreeSize = (id) => rollup(id)?.cards ?? 1

/**
 * The bar. Widths only, no numbers: it says how much, not how many.
 * The three statuses add up to the card count. Staleness is a separate axis and would
 * double-count here, so it stays in the line and the alarm.
 *
 * Postponed is the one exception, and only a texture, not a segment: a postponed card keeps
 * its real status width (open stays open), but the postponed slice of it is hatched grey
 * instead of solid status color, so a deliberately-parked card stops reading as an
 * active nudge. This does not add a segment, so widths still sum to `cards` — see
 * #ro-axes for why a real fourth segment is off the table.
 */
function rollupBar(r) {
  if (!r || r.cards < 2) return ''
  const bars = [
    ['decided', r.decided, r.decidedPostponed],
    ['open', r.open, r.openPostponed],
    ['proto', r.proto, r.protoPostponed],
  ]
    .filter(([, n]) => n > 0)
    .map(([k, n, nPostponed]) => {
      const active = n - nPostponed
      const activeBar =
        active > 0 ? `<i style="flex:${active};background-color:var(--${k})" title="${active} ${k}"></i>` : ''
      const postponedBar =
        nPostponed > 0
          ? `<i class="bar-postponed" style="flex:${nPostponed};background-color:var(--${k})" title="${nPostponed} ${k}, postponed"></i>`
          : ''
      return activeBar + postponedBar
    })
    .join('')
  return bars ? `<div class="rollup">${bars}</div>` : ''
}

/**
 * The same rollup as a line of numbers. The bar shows the shape of a branch; this says
 * what is left in it. A count of zero is left out, so what you read is what is open.
 *
 * decided/open/proto partition the subtree and use a filled dot. unchallenged and stale
 * cut across status — an unchallenged card is decided by definition, a stale one still
 * is too — so they ride the same line but with a hollow ring: same row, same order
 * (icon, then text), but a different mark for "this is a flag, not a state".
 */
function rollupLine(r, label, compact = false) {
  if (!r || r.cards < 2) return ''
  // Compact: the total, then a dot and a number per status or flag. Words move to titles.
  const word = (k) => (compact ? '' : ` ${k}`)
  const status = [
    ['open', r.open],
    ['proto', r.proto],
    ['decided', r.decided],
  ]
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span title="${n} ${k}"><i class="dot ${k}"></i>${n}${word(k)}</span>`)
  const flags = []
  if (r.unchallenged > 0 && r.decided > 0) {
    flags.push(
      `<span title="${r.unchallenged} of ${r.decided} decisions were stated unchallenged: no option weighed">` +
        `<i class="ring unchallenged"></i>${r.unchallenged}${word('unchallenged')}</span>`,
    )
  }
  if (r.stale > 0) flags.push(`<span title="${r.stale} stale"><i class="ring stale"></i>${r.stale}${word('stale')}</span>`)
  if (r.postponed > 0) {
    flags.push(`<span title="${r.postponed} postponed, not stale"><i class="ring postponed"></i>${r.postponed}${word('postponed')}</span>`)
  }
  // The label matters. Without it the line reads as a statement about the card you are
  // on, and "1 decided" next to a proto card looks like a contradiction.
  const total = compact
    ? `<span class="total" title="${esc(label.replace(/,$/, ''))}: ${r.cards} cards">${r.cards}</span>`
    : `<span class="total">${esc(label)} ${r.cards} cards</span>`
  return `<div class="rollup-line${compact ? ' compact' : ''}">${total}${[...status, ...flags].join('')}</div>`
}

function classOf(id) {
  const n = node(id)
  if (!n) return ''
  const parts = [n.kind === 'card' ? n.status ?? 'open' : n.kind]
  if (G.stale.has(id)) parts.push('is-stale')
  // The postponed card itself carries the mark too, not only the cards downstream of it.
  else if (G.postponed.has(id) || G.postponedOrigins.has(id)) parts.push('is-postponed')
  // A ghost (a new card) gets a blue border and a blue background. A pending *edit* on a
  // real card gets the blue border only. See #al-diff-render.
  if (n.proposed) parts.push('is-ghost')
  return parts.join(' ')
}

function cardHTML(id) {
  const n = node(id)
  if (!n) return `<button class="card" disabled><h3>missing node ${esc(id)}</h3></button>`
  const counts = rollup(id)
  const kidCount = children(id).length
  const evidence = out(id, 'supported_by').length
  const meta = [`<span>#${esc(id)}</span>`]
  if (livePlans.has(id)) meta.push(`<span class="planning" title="A plan of this subtree is running"><span class="pulse"></span>planning</span>`)
  if (kidCount) meta.push(`<span>${kidCount} below</span>`)
  if (evidence) meta.push(`<span>${evidence} evidence</span>`)
  if (n.who) {
    const label = n.who === 'prototype' ? 'build it first' : n.who === 'you' ? 'you decide' : 'I decide'
    // The ring sits next to the who label, not the corner: it marks the author's own
    // statement that no option was weighed (#werk-contract-guess).
    const ring = G.unchallenged.has(id) ? '<i class="ring unchallenged" title="Stated unchallenged: no option was weighed"></i>' : ''
    meta.push(`<span>${esc(label)}${ring}</span>`)
  }
  return `<button class="card ${classOf(id)}" data-go="${esc(id)}">
    <h3>${titleHTML(titleOf(n))}</h3>
    ${n.why || n.finding ? `<p>${mdInline(n.why ?? n.finding)}</p>` : ''}
    ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    ${rollupBar(counts)}
  </button>`
}

/** `sub` replaces the line under the title — a depends_on row shows the link's own reason
 *  there, not the other card's why. #vi-prop-linkwhy. */
function rowsHTML(ids, label, sub) {
  return ids
    .map((id) => {
      const n = node(id)
      if (!n) return ''
      const small = sub ? sub(id) : (n.finding ?? n.why ?? n.why_not)
      return `<button class="row" data-go="${esc(id)}">
        <span class="k">${esc(label(n))}</span>
        <span class="t"><span class="rid">#${esc(id)}</span> ${titleHTML(titleOf(n))}${small ? `<small>${esc(small)}</small>` : ''}</span>
      </button>`
    })
    .join('')
}

/** A staged, not-yet-accepted change replaces the plain body — see #al-diff-cli. The
 *  card gets a blue border (`.hero.pending`, in style.css) and the changes show as blue
 *  inline marks, instead of the old text next to a separate boxed "proposed" panel:
 *  one card, one state, blue means "this is a proposal." A new card also gets a blue
 *  background (`.hero.is-ghost`) — #al-diff-render. The accept icon next to locate-btns calls `werk accept`
 *  directly (`/api/change/accept`) so a click replaces typing the word. Discard has
 *  no button — that path goes through the agent, by telling it what's wrong. */
/** A proposed title or why line, as an inline diff against the current text. Same marks as
 *  the body: added gets a background, removed gets a background and a strikethrough. */
function inlineDiffHTML(oldText, newText) {
  const html = md(renderInlineDiff(oldText, newText), knows)
  // A one-paragraph result goes inline (it sits in an h1 too); several paragraphs stay as blocks.
  return /<p>[\s\S]*<p>/.test(html) ? html : html.replace(/^<p>([\s\S]*)<\/p>$/, '$1')
}

function pendingHTML(n) {
  // A proposed removal keeps the body as it is: the ✓ takes the whole card out — #werk-remove.
  if (n.pending.remove) {
    const what = n.pending.reparent
      ? 'Its child cards move up one level.'
      : 'Its refines subtree, options and excerpts go with it.'
    return `<p class="why">Proposed: remove this card. ${what} The ✓ removes it.</p>${n.body ? `<div class="body">${md(n.body, knows)}</div>` : ''}`
  }
  const rejected = (n.pending.rejected ?? [])
    .map((r) => `<p class="why">Rejected — ${esc(r.reason)}: “${esc(r.op.old ?? '')}”</p>`)
    .join('')
  // A title- or why-only proposal has no body ops: the body is unchanged, so show it as is.
  const diff = n.pending.ops?.length ? md(renderOpsMarkdown(n.pending.ops), knows) : n.body ? md(n.body, knows) : ''
  return `${rejected}<div class="body">${diff}</div>`
}

/**
 * The kill criteria — #kill-render. A section right after the hero, one two-line row per
 * criterion: state, trigger and fallback on line 1, the criterion in plain words on line 2.
 * Fired takes the stale red, unmonitored the postponed grey. A decided card with none on
 * record takes the unchallenged ring. An open card shows what #kill-ask will offer.
 */
function killHTML(id, n) {
  if (n.kind !== 'card') return ''
  const kill = n.kill ?? []
  const b = (x) => `<b>${esc(x)}</b>`
  const words = (c) => {
    if (c.form === 'metric') {
      return `${b(c.source)} · ${esc(c.metric)} ${b(c.threshold)} over ${b(c.window)}${c.minSample ? `, min sample ${b(c.minSample)}` : ''}`
    }
    if (c.form === 'manual') return `${b('Manual test')} · ${esc(c.text)}`
    if (c.form === 'no-metric') return `${b('No metric')}, because ${esc(c.text)}`
    return b('Revisit at any time')
  }
  if (!kill.length) {
    const open = n.status !== 'decided'
    if (!open) {
      return section(
        'Kill criteria',
        `<div class="depwhy-list"><div class="depwhy kill unch"><div class="k"><i class="ring unchallenged"></i><span class="kc">No kill criterion. Nothing says when to revisit this decision.</span></div>
          <div class="t">Record one with <code>werk kill ${esc(id)}</code>.</div></div></div>`,
      )
    }
    const drafts = [
      ['metric', 'A metric: a data source, what is measured, a threshold, a window.'],
      ['manual', 'A test you run yourself, and what failing it looks like.'],
      ['no-metric', 'No metric, and the reason: unclear, cheap, slow, values, or constraint.'],
      ['revisit', 'Revisit at any time.'],
    ]
    return section(
      'Kill criteria',
      `<div class="depwhy-list">${drafts
        .map(
          ([form, text]) => `<div class="depwhy kill draft"><div class="l1"><span class="tag">suggested</span><span class="tag kind">${form}</span></div>
            <div class="l2"><span class="kc">${esc(text)}</span></div></div>`,
        )
        .join('')}</div>`,
    )
  }
  const rows = kill.map((c) => {
    const flagged = c.state === 'fired' ? 'stale' : c.state === 'unmonitored' ? 'postponed' : ''
    const trigger = c.trigger === 'date' ? `review ${esc(c.reviewDate ?? '')}` : c.trigger === 'none' ? 'not tracked' : esc(c.trigger)
    const fb = c.fallback && knows(c.fallback) ? `<span class="sp"><a class="ref" href="${esc(cardHref(c.fallback))}">→ #${esc(c.fallback)}</a></span>` : ''
    return `<div class="depwhy kill ${flagged}">
      <div class="l1"><i class="ring ${flagged}"></i><span class="tag ${c.state === 'fired' ? 'fired' : flagged}">${esc(c.state)}</span><span class="tag kind">${trigger}</span>${fb}</div>
      <div class="l2"><span class="kc">${words(c)}</span></div>
      ${c.detail ? `<div class="t">${esc(c.detail)}</div>` : ''}
    </div>`
  })
  return section('Kill criteria', `<div class="depwhy-list">${rows.join('')}</div>`)
}

function section(title, html) {
  return html ? `<section><h2>${esc(title)}</h2>${html}</section>` : ''
}

/**
 * Why THIS card is flagged — #vi-prop-bornstale. The mark says a reopen reached here; this
 * says which reopen, how far away, and along which depends_on hops. Without it a card four
 * hops downstream just turns red, and nothing on the card names the cause.
 *
 * The born-after line is the important one. Seven of the nine marks on the map at the time
 * this was written were cards created after the reopen they inherit — a mark that says "new",
 * not "was true, may now be wrong". #vi-prop-bornstale decided not to prevent that, because
 * creation-time is no proof the author read the correction. So it is labelled instead.
 */
function flagWhyHTML(id) {
  const traces = G.flagWhy?.[id] ?? []
  if (!traces.length) return ''
  const rows = traces.map((t) => {
    const direct = t.via.length <= 1
    // #vi-prop-linkwhy: one line per hop with its reason, so the reader can see where the
    // chain stops mattering to this card.
    const chain = t.via
      .map(
        (v, i) =>
          `<li><a class="ref" href="${esc(cardHref(i === 0 ? id : t.via[i - 1]))}">#${esc(i === 0 ? id : t.via[i - 1])}</a> →
            <a class="ref" href="${esc(cardHref(v))}">#${esc(v)}</a>: ${
              t.whys?.[i] ? cardLinks(esc(t.whys[i]), knows) : '<i>no reason recorded</i>'
            }</li>`,
      )
      .join('')
    const hops = `${direct ? 'a direct dependency' : `${t.via.length} depends_on hops away`}:<ul class="hops">${chain}</ul>`
    return `<div class="depwhy ${esc(t.kind)}">
      <div class="k"><i class="ring ${esc(t.kind)}"></i><button class="tag id" data-go="${esc(t.origin)}">#${esc(t.origin)}</button>
        was ${esc(t.reason)} on ${esc(t.at.slice(0, 10))}</div>
      <div class="t">${t.why ? `${cardLinks(esc(t.why), knows)}<br>` : ''}${hops}</div>
      <div class="t">This card's link predates the reopen, so its content really was written against
        the old decision. Re-read it before clearing with <code>werk rederive ${esc(id)}</code>.</div>
    </div>`
  })
  const kind = G.stale.has(id) ? 'stale' : 'postponed'
  return `<section><h2>Why this card is ${kind}</h2><div class="depwhy-list">${rows.join('')}</div></section>`
}

/**
 * Why a dependency is flagged, for the depends_on targets that are stale or postponed.
 * `status: open` alone never causes this — only a reopened event does. So this spells out
 * the reopen itself: reason, date, why. If the target was not reopened directly, it is only
 * stale by transitivity, and there is nothing to show here but where to look next.
 */
function flaggedDependsOnHTML(id) {
  // The target itself may be the origin of a reopen (never in stale/postponed — those hold only
  // its dependents), or only flagged because something further upstream was reopened.
  const rows = out(id, 'depends_on')
    .filter((d) => G.reopens[d] || G.stale.has(d) || G.postponed.has(d))
    .map((d) => {
      const r = G.reopens[d]
      const flagged = r ? (r.reason === 'postponed' ? 'postponed' : 'stale') : G.stale.has(d) ? 'stale' : 'postponed'
      const detail = r
        ? `${esc(r.reason)} on ${esc(r.at.slice(0, 10))}${r.why ? ` — ${cardLinks(esc(r.why), knows)}` : ''}`
        : `flagged from a reopen further upstream — open <a class="ref" href="${esc(cardHref(d))}">#${esc(d)}</a> to trace it`
      return `<div class="depwhy ${flagged}">
        <div class="k"><i class="ring ${flagged}"></i><button class="tag id" data-go="${esc(d)}">#${esc(d)}</button> ${titleHTML(titleOf(node(d)))}</div>
        <div class="t">${detail}</div>
      </div>`
    })
  return rows.length
    ? `<section><h2>Why a dependency is flagged</h2><div class="depwhy-list">${rows.join('')}</div></section>`
    : ''
}

/** #st-build-howto-titles: the two top cards of every map, the root of the requirements and the
 *  card that holds the build rules. Neither has a parent, so neither has ✕ or ▶. */
const TOPS = [
  { id: 'root', label: 'What', note: 'requirements: what the product does' },
  { id: 'how', label: 'How', note: 'build rules: how this project is built' },
]
const isTop = (id) => TOPS.some((t) => t.id === id)

/** The rollup of both top cards' trees, summed field by field: the whole map. */
function homeRollup() {
  const sum = {}
  for (const r of TOPS.map((t) => rollup(t.id)).filter(Boolean)) {
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v
  }
  return sum.cards ? sum : undefined
}

/** One column of the home: a top card's title, why and counts, then its children. A map
 *  without the card shows the column's label and says the card is missing. */
function homeColumnHTML({ id, label, note }) {
  const n = node(id)
  const head = `<div class="home-label"><b>${label}</b> ${esc(note)}${n ? ` <span class="tag id">#${esc(id)}</span>` : ''}</div>`
  if (!n) return `<div class="home-col"><div class="hero home-top">${head}<p class="why">This map has no #${esc(id)} card yet.</p></div></div>`
  const kids = children(id)
  return `<div class="home-col">
    <button type="button" class="hero home-top ${classOf(id)}" data-go="${esc(id)}" title="Open this card">
      ${head}
      <h2>${titleHTML(titleOf(n))}</h2>
      ${n.why ? `<p class="why">${esc(n.why)}</p>` : ''}
      ${rollupBar(rollup(id))}
      ${rollupLine(rollup(id), 'this tree,')}
    </button>
    ${section(`${kids.length} below`, kids.length ? `<div class="grid">${kids.map(cardHTML).join('')}</div>` : '')}
  </div>`
}

/** #vi-home-howwhat: the home has no single card on top. Two columns of equal width show both
 *  top cards and their children, so both trees are on the first screen. */
function renderHome() {
  el('crumbs').innerHTML = `<div class="crumbs-row"><span class="crumb now">Home</span></div>`
  el('counts').innerHTML = rollupLine(homeRollup(), 'whole map,', true)
  el('alarms').innerHTML = ''
  el('hero').innerHTML = ''
  el('sections').innerHTML = `<div class="home">${TOPS.map(homeColumnHTML).join('')}</div>`
  document.title = 'Home — werk'
  renderContext()
  paintRunningCards()
}

function render() {
  const id = mapCard
  if (id === HOME) return renderHome()
  if (!node(id)) {
    el('hero').innerHTML = `<div class="hero"><h1>No node "${esc(id)}"</h1>
      <p class="why">The log has ${G.nodes.length} nodes. <a href="${cardHref(HOME)}">Go to the home</a>.</p></div>`
    el('sections').innerHTML = ''
    el('crumbs').innerHTML = ''
    return
  }
  const n = node(id)
  const chain = ancestors(id)
  const depth = Math.min(chain.length, 3)

  // One line high. The last two segments always show, a third when the pane is wide
  // (container query). Hover opens the whole chain as an overlay, so the layout never moves.
  // Every path starts at the home (#vi-home-howwhat).
  const segs = [`<button class="crumb" data-go="${HOME}">Home</button>`]
    .concat(chain.map((c) => `<button class="crumb" data-go="${esc(c)}">${titleHTML(titleOf(node(c)))}</button>`))
    .concat(`<span class="crumb now">${titleHTML(titleOf(n))}</span>`)
  const sep = '<span class="sep">›</span>'
  const tail = segs.slice(-3).map((s, i, a) => (a.length === 3 && i === 0 ? s.replace('class="crumb', 'class="crumb c3') : s))
  const more = segs.length > 2 ? `<span class="crumb-more${segs.length === 3 ? ' n3' : ''}">…</span>` : ''
  el('crumbs').innerHTML =
    `<div class="crumbs-row">${[more, ...tail].filter(Boolean).join(sep)}</div>` +
    (segs.length > 2 ? `<div class="crumbs-full">${segs.join(sep)}</div>` : '')

  // The header counts the subtree of the open card. Only the home counts the whole map.
  el('counts').innerHTML = rollupLine(rollup(id), 'this subtree,', true)

  const alarms = []
  // A stale card has no alarm: the STALE chip and the red card edge already say it.
  if (!G.stale.has(id) && G.postponed.has(id)) {
    alarms.push(`<div class="alarm gray"><b>Postponed.</b> A card this one depends on was postponed, not invalidated. It still holds.</div>`)
  }
  // The root used to list every proposal, stale card, and postponed card here. Those lists
  // live in the Flow tab now, with filters. #vi-flowtab-home.
  el('alarms').innerHTML = alarms.join('')

  // A proposed removal is drawn in the stale red, not the proposal blue: the ✓ takes the
  // card out of the map. #werk-remove.
  const removing = n.pending?.remove ? ' removing' : ''
  const tags = [
    `<button class="tag id" data-copy="${esc(id)}" title="Copy the id">#${esc(id)}</button>`,
    `<span class="tag kind">${esc(n.kind)}</span>`,
    n.status ? `<span class="tag ${n.status}">${esc(n.status)}</span>` : '',
    G.stale.has(id) ? `<span class="tag stale">stale</span>` : '',
    G.postponed.has(id) ? `<span class="tag postponed">postponed</span>` : '',
    G.postponedOrigins.has(id) ? `<span class="tag postponed" title="Postponed, not wrong. Work on it waits.">postponed</span>` : '',
    n.pending ? `<span class="tag pending${removing}">proposed</span>` : '',
    n.proposed ? `<span class="tag ghost">proposed</span>` : '',
    G.unchallenged.has(id)
      ? `<span class="tag unchallenged"><i class="ring unchallenged"></i>no option weighed</span>`
      : '',
    livePlans.has(id)
      ? `<button type="button" class="tag planning" data-open-plan="${esc(id)}" title="A plan of this subtree is running — open it on the board"><span class="pulse"></span>planning</button>`
      : '',
    n.who ? `<span class="tag">${esc(n.who === 'prototype' ? 'build it first' : n.who === 'you' ? 'you decide' : 'I decide')}</span>` : '',
  ].join('')

  const acceptLabel = n.proposed ? 'Accept this card into the map' : 'Accept this proposed change'
  el('hero').innerHTML = `<div class="hero d${depth} ${classOf(id)}${n.pending ? ` pending${removing}` : ''}">
    <div class="locate-btns">
      ${n.pending || n.proposed ? `<button type="button" class="locate-btn accept-btn${removing}" data-accept-change="${esc(id)}" title="${acceptLabel}" aria-label="${acceptLabel}">✓</button>` : ''}
      ${
        isTop(id) && !n.proposed
          ? ''
          : `<button type="button" class="locate-btn remove-btn" data-remove="${esc(id)}" title="${
              n.proposed ? 'Discard this proposed card' : 'Remove this card from the map — reversible'
            }" aria-label="${n.proposed ? 'Discard this proposed card' : 'Remove this card from the map'}">✕</button>`
      }
      ${
        n.kind === 'card' && !n.proposed && !isTop(id)
          ? `<button type="button" class="locate-btn build-btn" data-build-subtree="${esc(id)}" disabled title="Checking whether this subtree can be built…" aria-label="Build this subtree">▶</button>`
          : ''
      }
      <button type="button" class="locate-btn" data-locate="${esc(id)}" title="Find this card in the 3D graph" aria-label="Find this card in the 3D graph">⌖</button>
      <button type="button" class="locate-btn" data-locate-diagram="${esc(id)}" title="Find this card in the system diagram" aria-label="Find this card in the system diagram">▦</button>
    </div>
    <div class="tags">${tags}</div>
    ${n.kind === 'card' && !n.proposed && !isTop(id) ? `<div class="build-ctl" data-build-ctl="${esc(id)}" hidden></div>` : ''}
    <h1>${n.pending?.title !== undefined ? inlineDiffHTML(titleOf(n), n.pending.title) : titleHTML(titleOf(n))}</h1>
    ${n.pending?.why !== undefined ? `<div class="why">${inlineDiffHTML(n.why ?? '', n.pending.why)}</div>` : n.why ? `<p class="why">${cardLinks(esc(n.why), knows)}</p>` : ''}
    ${n.finding ? `<p class="why">${cardLinks(esc(n.finding), knows)}</p>` : ''}
    ${n.url ? `<p class="why"><a href="${esc(n.url)}" target="_blank" rel="noreferrer">${esc(n.url)}</a></p>` : ''}
    ${n.why_not ? `<p class="why">Not chosen: ${esc(n.why_not)}</p>` : ''}
    ${n.text ? `<div class="body">${md(n.text, knows)}</div>` : ''}
    ${n.pending ? pendingHTML(n) : n.body ? `<div class="body">${md(n.body, knows)}</div>` : ''}
    ${rollupBar(rollup(id))}
    ${rollupLine(rollup(id), 'this card and everything below it,')}
  </div>`

  const kids = children(id)
  const dependsOn = out(id, 'depends_on')
  const dependedBy = inc(id, 'depends_on')
  const evidence = out(id, 'supported_by')
  const citedBy = inc(id, 'supported_by')
  const options = inc(id, 'alternative_to')

  el('sections').innerHTML = [
    killHTML(id, n),
    section(
      `${kids.length} below${kids.filter(isGhost).length ? ` · ${kids.filter(isGhost).length} proposed` : ''}`,
      kids.length ? `<div class="grid">${kids.map(cardHTML).join('')}</div>` : '',
    ),
    section('Options', options.length ? `<div class="grid">${options.map(cardHTML).join('')}</div>` : ''),
    section('Evidence', evidence.length ? `<div class="list">${rowsHTML(evidence, (x) => x.kind)}</div>` : ''),
    flagWhyHTML(id),
    flaggedDependsOnHTML(id),
    section(
      'Depends on',
      dependsOn.length ? `<div class="list">${rowsHTML(dependsOn, () => 'depends on', (to) => linkWhy(id, to))}</div>` : '',
    ),
    section(
      'Depend on this card',
      dependedBy.length
        ? `<div class="list">${rowsHTML(dependedBy, () => 'dependent', (from) => linkWhy(from, id))}</div>`
        : '',
    ),
    section('Cited by', citedBy.length ? `<div class="list">${rowsHTML(citedBy, (x) => x.status ?? x.kind)}</div>` : ''),
    threadHTML(id),
  ].join('')

  document.title = `${titleOf(n)} — werk`
  renderContext()
  paintRunningCards()
  paintBuildButton(id)
}

/** #werk-board-build-subtree: the Build button asks the server whether the subtree's plan
 *  scope is fully decided, and greys itself with the reason when it is not.
 *  #vi-board-plan-controls: with unfinished work the card shows Resume and Restart… instead of
 *  Build. A run in progress on the subtree or an ancestor disables them, and a line names that
 *  run with a link to its plan card. */
function paintBuildButton(id) {
  const btn = el('hero').querySelector(`[data-build-subtree="${CSS.escape(id)}"]`)
  const ctl = el('hero').querySelector(`[data-build-ctl="${CSS.escape(id)}"]`)
  if (!btn) return
  fetch(`/api/subtree/build?id=${encodeURIComponent(id)}`)
    .then((r) => r.json())
    .then((s) => {
      if (!btn.isConnected) return
      const resume = s.action === 'resume'
      // The map card never shows an enabled Build while unfinished work exists.
      btn.hidden = resume
      btn.disabled = !!s.refusal
      btn.classList.toggle('running', s.running)
      btn.title = s.refusal
        ? `Cannot build this subtree: ${s.refusal}`
        : 'Build this subtree: plan it, then run the merge loop until every ticket is merged. It runs in the background, with no time limit.'
      if (ctl) {
        ctl.innerHTML = buildControlsHTML(id, s)
        ctl.hidden = !ctl.innerHTML
      }
    })
    .catch(() => {})
}

/** The Resume and Restart… controls and the blocking-run line of a map card. Pure. */
function buildControlsHTML(id, s) {
  const blocked = s.blockedBy && s.blockedBy !== id ? s.blockedBy : null
  const name = (run) => (node(run) ? titleOf(node(run)) : `#${run}`)
  const blockLine = blocked
    ? `<button type="button" class="build-blocked" data-open-plan="${esc(blocked)}" title="Open the plan card of #${esc(blocked)} on the board">Blocked by the run on ${esc(name(blocked))} →</button>`
    : ''
  if (s.action !== 'resume') return blockLine
  if (s.blockedBy === id) {
    return `<button type="button" class="build-blocked" data-open-plan="${esc(id)}" title="Open its plan card on the board">Running — open its plan card →</button>`
  }
  const dead = (u) => (u.column === 'building' && !u.live ? ' (process dead)' : '')
  // One group per column, so a ticket number does not read as a count: "7 blocked (tickets 73, 74, …)".
  const byColumn = new Map()
  for (const u of s.unfinished) byColumn.set(u.column, [...(byColumn.get(u.column) ?? []), `${u.id.split('/').pop()}${dead(u)}`])
  const work = [...byColumn].map(([column, ids]) => `${ids.length} ${column} (ticket${ids.length > 1 ? 's' : ''} ${ids.join(', ')})`).join('; ')
  const why = (r) => (r ? ` disabled title="${esc(r)}"` : '')
  return `<span class="build-work" title="${esc(s.unfinished.map((u) => `${u.id} ${u.column}${dead(u)}`).join('\n'))}">Unfinished work: ${esc(work)}</span>
    <button type="button" class="build-resume" data-resume-subtree="${esc(id)}"${why(s.refusal)}${s.refusal ? '' : ' title="Start the merge loop again over the same tickets"'}>Resume</button>
    <button type="button" class="build-restart" data-restart-subtree="${esc(id)}"${why(s.restartRefusal)}${s.restartRefusal ? '' : ' title="End the unfinished work, then plan and run again. Asks first."'}>Restart…</button>
    ${blockLine}`
}

/** A tab is running while its turn is, and while a background agent it launched still is
 *  — #werk-mc-bgagents. A pending ask is waiting, not running. */
const isRunning = (tab) =>
  tab?.status?.state === 'running' || tab?.status?.state === 'thinking' || tab?.background?.length > 0

/**
 * #werk-mc-live, point 1: a pulsing dot on the card a running conversation is homed on,
 * wherever that card shows on the map — the open card itself, a child card, a row, a crumb. `main`
 * has no home card, so its current card stands in.
 */
function paintRunningCards() {
  const homes = new Set()
  for (const tab of tabs.values()) if (isRunning(tab)) homes.add(tab.home ?? tab.at)
  el('hero').querySelector('.hero')?.classList.toggle('convo-running', homes.has(mapCard))
  for (const b of el('sections').querySelectorAll('.card[data-go], .row[data-go]')) {
    b.classList.toggle('convo-running', homes.has(b.dataset.go))
  }
  // An ancestor in the breadcrumbs too. The 3D graph and the system diagram do not show it.
  for (const b of el('crumbs').querySelectorAll('.crumb[data-go]')) {
    b.classList.toggle('convo-running', homes.has(b.dataset.go))
  }
}

/** Notes left on this card. The chat pane is where you add them. */
function threadHTML(id) {
  const notes = G.notes[id] ?? []
  if (notes.length === 0) return ''
  return `<section><h2>Notes on this card</h2>
    <div class="thread">
      ${notes
        .map(
          (m) => `<div class="note ${esc(m.from)}"><span class="k">${esc(m.from)}</span>
            <span class="t">${cardLinks(esc(m.text), knows)}</span>
            <span class="when">${esc(m.at.slice(11, 16))}</span></div>`,
        )
        .join('')}
    </div></section>`
}

// ---------- the chat pane ----------
// Several conversations at once, in tabs. See #werk-multichat. Each is its own Agent on the
// server, forked at a card (#werk-mc-fork) and named after it (#werk-mc-split). This module
// keeps one DOM subtree per conversation — all but the active one sit `hidden` — so a
// background tab keeps rendering its own stream without being on screen.

const chatLogs = el('chat-logs')
const chatInput = el('chat-input')
const chatState = el('chat-state')
const interruptBtn = el('interrupt-btn')
const modelSelect = el('model-select')
const contextPie = el('context-pie')
const contextPop = el('context-pop')
const contextPopText = el('context-pop-text')
const contextClear = el('context-clear')
const tabStrip = el('tab-strip')
const tabScroll = el('tab-scroll')
const tabChips = el('tab-chips')
const tabMore = el('tab-more')
const parkedMenu = el('tab-parked-menu')
const tabAdd = el('tab-add')
const addMenu = el('tab-add-menu')
const deadBar = el('dead-bar')
const bgLine = el('bg-line')

const MAX_VISIBLE_TABS = 5
const TABS_KEY = projectKey('werk-tabs-v1')

/** #werk-mc-reload-storm's fallback: what the `reload` handler stashed in sessionStorage —
 *  every tab's draft, and every half-filled question form. Read once, then dropped. */
function takeStashed(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || '{}')
  } catch {
    return {}
  } finally {
    sessionStorage.removeItem(key)
  }
}
const stashedDrafts = takeStashed('werk-drafts')

/** One entry per conversation this browser knows about. Not persisted itself — see
 *  saveTabsState/loadTabsState for what survives a reload. */
const tabs = new Map()
/** Visible chip order — stable (insertion order), so Cmd+1..5 stays learnable. #werk-mc-keys. */
let tabOrder = []
/** Parked, hidden from the strip, listed in the "…" menu. #werk-mc-park. */
let parkedOrder = []
let activeName = 'main'

function loadTabsState() {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || 'null')
    // Not "includes main": #werk-mc-close can park main like any other tab, and a strip
    // without it is still a valid strip to restore.
    if (saved && Array.isArray(saved.order) && saved.order.length > 0) return saved
  } catch {}
  return { order: ['main'], parked: [], active: 'main' }
}

function saveTabsState() {
  // #werk-mc-follow: each tab's own position survives a reload, not only the active one's
  // (which the address already carries).
  const at = {}
  for (const [name, tab] of tabs) if (tab.at) at[name] = tab.at
  // #werk-mc-parklist / #werk-mc-park: the ⋯ list's order and the cap's choice of tab to
  // park both read lastTouch, so it survives a reload too.
  const touched = {}
  for (const [name, tab] of tabs) touched[name] = tab.lastTouch
  localStorage.setItem(TABS_KEY, JSON.stringify({ order: tabOrder, parked: parkedOrder, active: activeName, at, touched }))
}

/** A conversation's DOM and local state, created the first time anything mentions it —
 *  a fork response, an SSE event tagged with its name, or a saved tab list on reload. */
function ensureTab(name, home) {
  let tab = tabs.get(name)
  if (tab) {
    if (home != null && tab.home == null) tab.home = home
    return tab
  }
  const logEl = document.createElement('div')
  logEl.className = 'chat-log'
  logEl.hidden = name !== activeName
  chatLogs.append(logEl)
  tab = {
    name,
    home: home ?? null,
    at: null,
    logEl,
    bubbles: new Map(),
    toolGroup: null,
    /** #werk-chat-turn-id: turn name -> the element that holds its message and reply, and
     *  the turns sent and not yet ended, oldest first. */
    turnEls: new Map(),
    openTurns: [],
    draft: stashedDrafts[name] ?? '',
    /** The session's own Claude Code title, from /api/convos. #werk-mc-desc. */
    title: '',
    status: { state: 'idle' },
    model: null,
    context: null,
    background: [],
    wasRunning: false,
    dead: false,
    startedAt: 0,
    lastTouch: Date.now(),
  }
  tabs.set(name, tab)
  return tab
}

/** The card a tab shows in its chip — the card it was forked at, or its own name for `main`. */
const tabLabel = (name) => {
  const home = tabs.get(name)?.home
  return home === HOME ? 'Home' : home ?? name
}

/**
 * A run of tool calls collapses into one line. It stays open while the next message is
 * another tool call or that call's result; anything else — new agent text, a new turn —
 * closes it, so the next tool call starts a fresh section.
 */
function openGroup(tab, host = tab.logEl) {
  const details = document.createElement('details')
  details.className = 'tool-group'
  details.innerHTML = '<summary></summary><div class="tool-calls"></div>'
  host.append(details)
  tab.toolGroup = { el: details, summary: details.querySelector('summary'), calls: details.querySelector('.tool-calls') }
  return tab.toolGroup
}

/** The one line shown while the section is collapsed: the latest call, and how many ran.
 *  `group` is null when a tool bubble's id was reused by an earlier, non-tool message —
 *  bubble()'s own reopen-from-DOM fix (#werk-mc-nullgroup) only covers a tool node that
 *  really is inside a .tool-group; this covers the case where it never was one. */
function updateSummary(group) {
  if (!group) return
  const calls = [...group.calls.children]
  const n = calls.length
  const last = calls[n - 1]?.querySelector('.txt')?.textContent.trim() ?? ''
  group.summary.textContent = n > 1 ? `${last} · ${n} tool calls` : last
  group.el.classList.toggle('has-error', calls.some((c) => c.querySelector('.tool-out.failed')))
}

/**
 * #werk-chat-turn-id: where a message goes. A message with a turn goes into its turn's
 * element, so a reply that streams on after a second message was sent stays above it. A
 * turn this page has not seen, such as after a reload, starts a new element at the bottom.
 * A message with no turn goes at the bottom.
 */
function hostOf(tab, turn) {
  if (!turn) return tab.logEl
  let host = tab.turnEls.get(turn)
  if (!host) {
    host = document.createElement('div')
    host.className = 'turn'
    host.dataset.turn = turn
    tab.logEl.append(host)
    tab.turnEls.set(turn, host)
  }
  return host
}

/** The turn has started, so its message no longer waits. */
function unwait(tab, turn) {
  tab.turnEls.get(turn)?.querySelector(':scope > .turn-wait')?.remove()
}

/** The turn has ended, by its end line or by the agent's exit. The next one starts. */
function endTurn(tab, turn) {
  tab.openTurns = tab.openTurns.filter((t) => t !== turn)
  unwait(tab, turn)
  if (tab.openTurns[0]) unwait(tab, tab.openTurns[0])
}

const turnRunning = (s) => s.state === 'thinking' || s.state === 'running' || s.state === 'asking'

/** An agent that is not running has no open turn, whatever the transcript lost. */
function endAllTurns(tab) {
  for (const turn of tab.openTurns) unwait(tab, turn)
  tab.openTurns = []
}

function bubble(tab, id, from, turn) {
  let node_ = tab.bubbles.get(id)
  if (node_) {
    // A tool call is rendered once while it streams and again when the log replays it
    // finished. Its group can have closed in between — a later, non-tool message sets
    // tab.toolGroup to null. Reopen it from the node's own DOM, or updateSummary crashes
    // on a null group the moment this call's result comes in.
    if (from === 'tool' && !tab.toolGroup) {
      const details = node_.closest('.tool-group')
      if (details) tab.toolGroup = { el: details, summary: details.querySelector('summary'), calls: details.querySelector('.tool-calls') }
    }
    return node_
  }
  node_ = document.createElement('div')
  node_.dataset.id = id
  const host = hostOf(tab, turn)
  if (turn) unwait(tab, turn)
  if (from === 'tool') {
    node_.className = 'tool-call'
    node_.innerHTML = '<div class="txt raw"></div>'
    const group = tab.toolGroup?.el.parentElement === host ? tab.toolGroup : openGroup(tab, host)
    group.calls.append(node_)
  } else {
    tab.toolGroup = null
    node_.className = `msg ${from}`
    // `raw` keeps the newlines of unrendered text. It goes when Markdown replaces it.
    node_.innerHTML =
      from === 'thinking' ? '<span class="on">thinking</span><div class="txt raw"></div>' : '<div class="txt raw"></div>'
    host.append(node_)
  }
  tab.bubbles.set(id, node_)
  return node_
}

const atBottomOf = (el_) => el_.scrollHeight - el_.scrollTop - el_.clientHeight < 80

function keepDown(el_, was) {
  if (was) el_.scrollTop = el_.scrollHeight
}

/** A raw text append, used while a block streams. Markdown waits for the final form. */
function applyDelta(tab, { id, from, text, turn }) {
  const was = atBottomOf(tab.logEl)
  const node_ = bubble(tab, id, from, turn)
  const txt = node_.querySelector('.txt')
  txt.textContent += text
  if (from === 'tool') updateSummary(tab.toolGroup)
  keepDown(tab.logEl, was)
}

/** The finished block. Markdown renders here, replacing whatever streamed. */
function addChat(tab, m) {
  // #werk-chat-turn-id: a message sent while another turn is open waits under a mark.
  if (m.from === 'you' && m.turn && !tab.openTurns.includes(m.turn)) {
    tab.openTurns.push(m.turn)
  }
  if (m.done && m.turn) endTurn(tab, m.turn)
  if (m.from === 'system' && !m.text) return
  const was = atBottomOf(tab.logEl)

  if (m.from === 'tool') {
    const node_ = bubble(tab, m.id, 'tool', m.turn)
    node_.innerHTML = bodyHTML(m)
    updateSummary(tab.toolGroup)
    keepDown(tab.logEl, was)
    return
  }

  // A tool's result has no id of its own — it lands on the call that just opened the group.
  if (m.from === 'result' && tab.toolGroup?.calls.lastElementChild) {
    const last = tab.toolGroup.calls.lastElementChild
    last.insertAdjacentHTML('beforeend', `<div class="tool-out${m.error ? ' failed' : ''}">${bodyHTML(m)}</div>`)
    updateSummary(tab.toolGroup)
    keepDown(tab.logEl, was)
    return
  }

  // A message sent mid-reply does not close the reply's open tool group: the reply's next
  // tool call still belongs in it, above the message.
  if (!(m.from === 'you' && m.turn)) tab.toolGroup = null
  // A suggested next action is only an offer until the next message is sent.
  if (m.from === 'you') for (const b of tab.logEl.querySelectorAll('.next-btn')) b.remove()
  // #werk-mc-asks: an unclicked offer blinks the tab like a pending ask does.
  if (m.from === 'you' || m.from === 'agent') {
    const offer = m.from === 'agent' && !!nextPhrase(m.text)
    if (!!tab.offer !== offer) {
      tab.offer = offer
      renderTabStrip()
    }
  }
  const node_ = m.id ? bubble(tab, m.id, m.from, m.turn) : null
  const html = bodyHTML(m)
  const host = hostOf(tab, m.turn)
  if (m.turn && m.from !== 'you') unwait(tab, m.turn)
  if (node_) {
    node_.className = `msg ${m.from}${m.error ? ' failed' : ''}`
    node_.innerHTML = html
    node_.querySelector('.txt')?.classList.remove('raw')
    // #werk-mc-fork-notice: a fork's "continued from" link finds this message by its time.
    node_.dataset.at = m.at
  } else {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="msg ${esc(m.from)}${m.error ? ' failed' : ''}" data-at="${esc(m.at)}">${html}</div>`,
    )
    if (m.from === 'you' && m.turn && tab.openTurns[0] !== m.turn && tab.openTurns.includes(m.turn)) {
      host.insertAdjacentHTML('beforeend', '<div class="turn-wait">waits for the reply above</div>')
    }
  }
  keepDown(tab.logEl, was)
}

function shotsHTML(paths) {
  if (!paths?.length) return ''
  return `<div class="shot-row">${paths
    .map((p, i) => {
      const name = encodeURIComponent(p.split('/').pop())
      return `<a class="sent-shot" href="/api/image?name=${name}" target="_blank">
        <img src="/api/image?name=${name}" alt="">
        <span class="shot-n">[Image #${i + 1}]</span></a>`
    })
    .join('')}</div>`
}

/**
 * #werk-mc-nextbtn: the phrase in a last line like `Next: say "merge it", and I ...` or
 * `Next: reply "go" and I ...`, or null. The format comes from the user's global
 * instructions, so only those shapes count.
 */
function bodyHTML(m) {
  const card = m.card ? `<span class="on">${m.card === HOME ? 'Home' : `#${esc(m.card)}`}</span>` : ''
  if (m.from === 'you') return `${card}${shotsHTML(m.images)}<div class="txt raw">${cardLinks(esc(m.text), knows)}</div>`
  if (m.from === 'agent') {
    const phrase = nextPhrase(m.text)
    const next = phrase ? `<button type="button" class="next-btn" data-say="${esc(phrase)}">${esc(phrase)}</button>` : ''
    return `${card}<div class="txt">${md(m.text, knows)}</div>${next}`
  }
  if (m.forkOf) {
    const { convo, at } = m.forkOf
    const jump = at ? ` <button type="button" class="fork-jump" data-convo="${esc(convo)}" data-at="${esc(at)}">Go to the last message before the fork</button>` : ''
    return `<div class="txt">Continued from <b>${esc(convo)}</b>.${jump}</div>`
  }
  if (m.from === 'thinking') return `<span class="on">thinking</span><div class="txt">${esc(m.text)}</div>`
  if (m.from === 'tool') return `<div class="txt">${esc(m.text)}</div>`
  if (m.from === 'result') {
    const lines = m.text.split('\n')
    const head = lines.slice(0, 6).join('\n')
    const rest = lines.length > 6 ? `<details><summary>${lines.length - 6} more lines</summary><pre>${esc(lines.slice(6).join('\n'))}</pre></details>` : ''
    return `<div class="txt"><pre>${esc(head)}</pre>${rest}</div>`
  }
  return `${card}<div class="txt">${esc(m.text)}</div>`
}

// ---------- approval ----------
// A tool outside the allow list stops the turn and asks here. The agent is blocked on the
// answer, so this bar sits at the bottom of the pane where the composer is, not in the log.

const askBar = el('asks')

// #werk-mc-askqa: selections made in an AskUserQuestion form, kept outside the DOM so a
// re-render triggered by some other tab's ask does not wipe an answer half filled in.
// Keyed by ask id, then by question index, to a Set of chosen option labels. A reload
// restores it from the stash — #werk-mc-reload-storm.
const pendingAnswers = new Map(
  Object.entries(takeStashed('werk-answers')).map(([id, byQ]) => [
    id,
    new Map(byQ.map(([qi, picked]) => [Number(qi), new Set(picked)])),
  ]),
)

/** questions[] straight off the AskUserQuestion call, or [] if this is not that tool. */
function questionsOf(a) {
  if (a.tool !== 'AskUserQuestion') return []
  return Array.isArray(a.input?.questions) ? a.input.questions : []
}

const letterFor = (i) => String.fromCharCode(65 + i)

/** The one chosen value that is not a predefined option — the typed "Other" answer, if any. */
function otherValueOf(chosen, q) {
  const predefined = new Set((q.options ?? []).map((o) => o.label))
  return [...chosen].find((v) => !predefined.has(v)) ?? ''
}

function renderQuestion(askId, qi, q) {
  const chosen = pendingAnswers.get(askId)?.get(qi) ?? new Set()
  const rows = (q.options ?? [])
    .map((o, oi) => {
      const on = chosen.has(o.label)
      return `<li class="ask-opt-row${on ? ' selected' : ''}">
        <button type="button" class="ask-opt-letter${on ? ' selected' : ''}" data-qi="${qi}" data-opt="${esc(o.label)}">${letterFor(oi)}</button>
        <div class="ask-opt-text">
          <div class="ask-opt-label">${esc(o.label)}</div>
          ${o.description ? `<div class="ask-opt-desc">${esc(o.description)}</div>` : ''}
        </div>
      </li>`
    })
    .join('')
  const otherValue = otherValueOf(chosen, q)
  const other = `<li class="ask-opt-row ask-opt-other${otherValue ? ' selected' : ''}">
    <input type="text" class="ask-other-input" data-qi="${qi}" placeholder="Other — type your own answer" value="${esc(otherValue)}">
  </li>`
  return `<div class="ask-question">
    <div class="ask-question-text">${esc(q.question)}</div>
    <ul class="ask-opt-list">${rows}${other}</ul>
  </div>`
}

let lastOpen = []
let lastOpenAll = []

// #werk-mc-asks: an ask belongs to its own tab. Only the active tab's ask shows here — a
// background tab's ask blinks its own dot instead (see renderTabStrip / tabMore).
function applyOpenAsks(open) {
  lastOpenAll = open ?? []
  renderAsks()
}

function renderAsks() {
  const open = lastOpenAll.filter((a) => (a.convo || 'main') === activeName)
  lastOpen = open
  if (!open.length) {
    askBar.innerHTML = ''
    askBar.hidden = true
    return
  }
  const openIds = new Set(lastOpenAll.map((a) => a.id))
  for (const id of pendingAnswers.keys()) if (!openIds.has(id)) pendingAnswers.delete(id)

  askBar.hidden = false
  askBar.innerHTML = open
    .map((a, i) => {
      const questions = questionsOf(a)
      return `<div class="ask${i === 0 ? ' head' : ''}${questions.length ? ' qa' : ''}" data-ask="${esc(a.id)}">
        <div class="ask-head">${
          questions.length ? `is asking a question. The turn is waiting.` : `<b>${esc(a.tool)}</b> wants to run. The turn is waiting.`
        }</div>
        ${
          questions.length
            ? questions.map((q, qi) => renderQuestion(a.id, qi, q)).join('')
            : `<pre class="ask-cmd">${esc(a.label)}</pre>`
        }
        ${
          // Claude Code's own word for why its permission engine could not settle this
          // call. Shown raw, because werk does not know every value it can take, and
          // inventing prose for one would read as fact.
          a.reason ? `<div class="ask-why">Claude Code could not decide: <code>${esc(a.reason)}</code></div>` : ''
        }
        <div class="ask-buttons${questions.length ? ' qa' : ''}">
          ${
            questions.length
              ? `<button data-answer="deny" class="deny">Decline</button><button data-answer="submit-answer" class="submit">Submit answer</button>`
              : `<button data-answer="allow">Allow once</button>${
                  // The CLI proposed nothing for this call, so there is nothing to widen to.
                  // A button here would have to invent a rule, which is what #werk-perm-native
                  // removed.
                  a.always
                    ? `<button data-answer="always" title="Stops asking about ${esc(a.always.label)}">Always allow <code>${esc(a.always.label)}</code></button>`
                    : ''
                }<button data-answer="deny" class="deny">Deny</button>`
          }
        </div>
      </div>`
    })
    .join('')
}

/** "For \"<question>\": <picked labels>", one line per question, for the model to read. */
function answerMessage(a) {
  const questions = questionsOf(a)
  const chosenByQ = pendingAnswers.get(a.id) ?? new Map()
  return questions
    .map((q, qi) => {
      const picked = [...(chosenByQ.get(qi) ?? [])]
      return `For "${q.question}": ${picked.length ? picked.join(', ') : '(no answer picked)'}`
    })
    .join('\n')
}

askBar.addEventListener('click', async (e) => {
  const option = e.target.closest('[data-opt]')
  if (option) {
    const id = option.closest('[data-ask]')?.dataset.ask
    const qi = Number(option.dataset.qi)
    const a = lastOpen.find((x) => x.id === id)
    const q = questionsOf(a)[qi]
    if (!a || !q) return
    if (!pendingAnswers.has(id)) pendingAnswers.set(id, new Map())
    const byQ = pendingAnswers.get(id)
    const chosen = byQ.get(qi) ?? new Set()
    const label = option.dataset.opt
    if (q.multiSelect) {
      chosen.has(label) ? chosen.delete(label) : chosen.add(label)
    } else {
      // Single-select: this pick replaces whatever was chosen for this question.
      chosen.clear()
      chosen.add(label)
    }
    byQ.set(qi, chosen)
    renderAsks()
    return
  }

  const button = e.target.closest('[data-answer]')
  if (!button) return
  const id = button.closest('[data-ask]')?.dataset.ask
  if (!id) return
  const answer = button.dataset.answer
  const a = lastOpen.find((x) => x.id === id)
  // A picked answer is not a denial, but it travels back on the same channel: `deny` is the
  // only response type that carries free text to the model. See #werk-mc-askqa.
  const body =
    answer === 'submit-answer'
      ? { id, decision: 'deny', message: answerMessage(a) }
      : { id, decision: answer }
  // Answer once. A second click on a resolved id is harmless, but the wait reads as broken.
  for (const b of askBar.querySelectorAll('button')) b.disabled = true
  await fetch('/api/ask/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
})

// Typing "Other" text updates pendingAnswers directly, with no renderAsks call — a
// full re-render replaces the DOM and drops the input's focus and cursor mid-keystroke.
askBar.addEventListener('input', (e) => {
  const input = e.target.closest('.ask-other-input')
  if (!input) return
  const id = input.closest('[data-ask]')?.dataset.ask
  const qi = Number(input.dataset.qi)
  const a = lastOpen.find((x) => x.id === id)
  const q = questionsOf(a)[qi]
  if (!a || !q) return
  if (!pendingAnswers.has(id)) pendingAnswers.set(id, new Map())
  const byQ = pendingAnswers.get(id)
  const predefined = new Set((q.options ?? []).map((o) => o.label))
  // Single-select: typing replaces any predefined pick, same as clicking a letter does.
  // Multi-select: typing replaces only the previous free-text value, keeping other picks.
  const kept = q.multiSelect ? [...(byQ.get(qi) ?? [])].filter((v) => predefined.has(v)) : []
  const chosen = new Set(kept)
  const value = input.value.trim()
  if (value) chosen.add(value)
  byQ.set(qi, chosen)
  input.closest('.ask-opt-row')?.classList.toggle('selected', Boolean(value))
})

// A denied call is the one keystroke that must always work. Enter allows, Escape denies.
document.addEventListener('keydown', (e) => {
  if (askBar.hidden || !askBar.firstElementChild) return
  if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return
  e.preventDefault()
  const accept = e.key === 'Escape' ? '[data-answer="deny"]' : '[data-answer="submit-answer"], [data-answer="allow"]'
  askBar.querySelector(accept)?.click()
})

async function loadAsks() {
  const { open } = await (await fetch('/api/ask/open')).json()
  applyOpenAsks(open)
}

// ---------- the running indicator ----------
// Only the active tab paints chatState/modelSelect. Every tab still tracks its own status —
// see the `status` stream handler — so switching to it shows the right thing immediately.
let ticker = null

/** #werk-mc-bgagents: a permanent line pinned to the bottom of the pane while the active
 *  tab has a background agent running. Its own element, so a new turn starting — which
 *  repaints #chat-state — does not replace it. Gone once the last one finishes. */
function renderBgLine() {
  const bg = tabs.get(activeName)?.background ?? []
  bgLine.hidden = bg.length === 0
  bgLine.innerHTML = bg.length
    ? `<i class="pulse"></i>running in the background: ${esc(bg.map((t) => t.description || t.type).join(', '))}`
    : ''
}

function paintStatusUI(s) {
  const running = s.state === 'thinking' || s.state === 'running' || s.state === 'asking'
  const bg = tabs.get(activeName)?.background ?? []
  chatState.classList.toggle('busy', running || bg.length > 0)
  renderBgLine()
  // Switching models restarts the child, which would kill a turn in flight.
  modelSelect.disabled = running
  // Waiting for you already has its own way out — answer or deny the ask — so the button
  // only needs to cover the turn actually running unattended.
  interruptBtn.hidden = s.state !== 'thinking' && s.state !== 'running'
  clearInterval(ticker)
  ticker = null
  if (s.state === 'dead') {
    chatState.innerHTML = `<i class="pulse dead"></i>turn failed — see the log below`
    return
  }
  if (!running) {
    chatState.innerHTML = ''
    return
  }
  const startedAt = tabs.get(activeName)?.startedAt || Date.now()
  const paint = () => {
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10
    if (s.state === 'asking') {
      chatState.innerHTML = `<i class="pulse wait"></i>waiting for you · ${esc(s.detail ?? '')}`
      return
    }
    const what = s.state === 'running' ? (s.detail ?? 'working') : 'thinking'
    // #werk-progress: a pulse, what the agent is doing, seconds, and tokens.
    const tokens = s.tokens ? ` · ${s.tokens.toLocaleString()} tokens` : ''
    chatState.innerHTML = `<i class="pulse"></i>${esc(what)} · ${seconds.toFixed(1)}s${tokens}`
  }
  ticker = setInterval(paint, 200)
  paint()
}

// ---------- #werk-mc-live: a background death surfaces like an ask, naming its tab ----------
const deadNotices = new Set()

function renderDeadBar() {
  if (deadNotices.size === 0) {
    deadBar.hidden = true
    deadBar.innerHTML = ''
    return
  }
  deadBar.hidden = false
  deadBar.innerHTML = [...deadNotices]
    .map(
      (name) => `<div class="dead-note">
        <button type="button" data-switch="${esc(name)}">#${esc(tabLabel(name))}</button>'s turn failed.
        <button type="button" data-dismiss="${esc(name)}">Dismiss</button>
      </div>`,
    )
    .join('')
}

function noteDead(name) {
  deadNotices.add(name)
  renderDeadBar()
}

deadBar.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-switch]')
  if (sw) {
    deadNotices.delete(sw.dataset.switch)
    switchTo(sw.dataset.switch)
    renderDeadBar()
    return
  }
  const dis = e.target.closest('[data-dismiss]')
  if (dis) {
    deadNotices.delete(dis.dataset.dismiss)
    renderDeadBar()
  }
})

// ---------- #werk-mc-tabs / #werk-mc-park / #werk-mc-open / #werk-mc-follow ----------

// #tab-chips, #tab-actions and #tab-parked-menu are static elements in index.html, not
// rebuilt here — only their content changes. Rebuilding the lot on every render (this used
// to replace the whole #tab-strip) destroyed the parked menu the moment it was open, since
// a chat/status event repaints the strip far more often than anyone has it open.
function renderTabStrip() {
  tabChips.innerHTML = tabOrder
    .map((name, i) => {
      const tab = tabs.get(name) ?? ensureTab(name)
      const label = tabLabel(name)
      const n = node(label)
      const title = n ? titleOf(n) : label
      const cls = ['tab-chip']
      if (name === activeName) cls.push('active')
      if (isRunning(tab)) cls.push('running')
      if (tab.status?.state === 'asking' || tab.offer) cls.push('waiting')
      if (tab.dead) cls.push('dead')
      // The label's own overflow/ellipsis, not the chip's: the chip must stay
      // overflow:visible so its corner pieces (::before/::after) aren't clipped.
      // The last visible chip has no close control: the strip is never empty. #werk-mc-close.
      const close = tabOrder.length > 1 ? `<span class="tab-close" data-close="${esc(name)}" role="button" aria-label="Close">×</span>` : ''
      return `<button type="button" class="${cls.join(' ')}" data-tab="${esc(name)}" title="${esc(title)}">
        <span class="tab-status"><i class="tab-dot"></i>${close}</span><span class="tab-label">${name === 'main' ? 'main' : `#${esc(label)}`}</span>${i < 5 ? `<span class="tab-key">⌘${i + 1}</span>` : ''}
      </button>`
    })
    .join('')
  // ⋯ opens the complete list — every conversation, visible or parked, not only the
  // overflow. It counts and lists all of them, so nothing is only reachable by scrolling.
  const total = tabOrder.length + parkedOrder.length
  tabMore.hidden = total <= 1
  // #werk-mc-asks: the button itself blinks for whatever it can't show as a chip — every
  // parked tab, plus a visible one that isn't the current tab. Red wins over yellow.
  const others = [...tabOrder, ...parkedOrder].filter((n) => n !== activeName)
  const otherDead = others.some((n) => tabs.get(n)?.dead)
  const otherWaiting = others.some((n) => tabs.get(n)?.status?.state === 'asking' || tabs.get(n)?.offer)
  tabMore.classList.toggle('dead', otherDead)
  tabMore.classList.toggle('waiting', !otherDead && otherWaiting)
  if (!tabMore.hidden) tabMore.innerHTML = `<i class="tab-dot"></i>⋯ ${total}`
  // Every status and background change repaints the strip, so the map's dots ride along.
  paintRunningCards()
}

function renderAllTabsMenu() {
  // Oldest touched at top, most recent at the bottom — nearest the ⋯ button that opened it.
  const ordered = [...tabOrder, ...parkedOrder].sort(
    (a, b) => (tabs.get(a)?.lastTouch ?? 0) - (tabs.get(b)?.lastTouch ?? 0),
  )
  parkedMenu.innerHTML = ordered
    .map((name) => {
      const label = tabLabel(name)
      const tab = tabs.get(name)
      const cls = ['tab-parked-row']
      if (name === activeName) cls.push('active')
      if (tab?.dead) cls.push('dead')
      else if (tab?.status?.state === 'asking' || tab?.offer) cls.push('waiting')
      const mark = name === activeName ? '●' : parkedOrder.includes(name) ? '⋯' : '○'
      return `<div class="${cls.join(' ')}" data-pick="${esc(name)}">
        <span><i class="tab-dot"></i>${esc(mark)} ${name === 'main' ? 'main' : `#${esc(label)}`}</span>
        <small>${esc(tab?.title ?? '')}</small>
      </div>`
    })
    .join('')
  return parkedMenu
}

/** #werk-mc-desc: a session's title appears after its first turns, so the menu re-reads
 *  them each time it opens, and repaints if it is still open when they arrive. */
async function refreshTitles() {
  try {
    const { convos } = await (await fetch('/api/convos')).json()
    for (const c of convos) {
      const tab = tabs.get(c.name)
      if (tab) tab.title = c.title ?? ''
    }
    if (!parkedMenu.hidden) renderAllTabsMenu()
  } catch {}
}

/** `.tab-parked-menu` is `position:fixed` with a static `right`, so the only coordinate
 *  left to place is `bottom` — just above whichever button opened it. */
function positionParkedMenu() {
  const rect = tabMore.getBoundingClientRect()
  parkedMenu.style.bottom = `${innerHeight - rect.top + 6}px`
}

parkedMenu.addEventListener('click', (e) => {
  const row = e.target.closest('[data-pick]')
  if (!row) return
  parkedMenu.hidden = true
  const name = row.dataset.pick
  switchTo(name)
})

// Chrome and Firefox already turn a Shift+wheel into horizontal scroll on any scrollable
// element, so this only fires where that didn't happen — Safari reports deltaX:0 either
// way, and this is the one thing that tells the two cases apart.
tabScroll.addEventListener('wheel', (e) => {
  if (e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
    e.preventDefault()
    tabScroll.scrollLeft += e.deltaY
  }
})

// #werk-mc-split-plus: a long press on "+" opens a menu with "Fork" and "Start empty". A
// plain press forks, as before. A right-click opens the same menu. The click that ends a long
// press is swallowed, so it does not also fork.
const LONG_PRESS_MS = 450
let pressTimer = null
let pressOpened = false

function openAddMenu() {
  parkedMenu.hidden = true
  addMenu.hidden = false
  addMenu.style.bottom = `${innerHeight - tabAdd.getBoundingClientRect().top + 6}px`
}

tabAdd.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  pressOpened = false
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressOpened = true
    openAddMenu()
  }, LONG_PRESS_MS)
})
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
  tabAdd.addEventListener(type, () => clearTimeout(pressTimer))
}
tabAdd.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  openAddMenu()
})

addMenu.addEventListener('click', (e) => {
  const row = e.target.closest('[data-add]')
  if (!row) return
  addMenu.hidden = true
  const tab = tabs.get(activeName)
  const atCard = tab?.at ?? mapCard
  if (row.dataset.add === 'empty') startEmptyAt(atCard)
  else forkAt(activeName, atCard, { plus: true })
})

tabStrip.addEventListener('click', (e) => {
  if (e.target.closest('#tab-add')) {
    if (pressOpened) {
      pressOpened = false
      return
    }
    const tab = tabs.get(activeName)
    forkAt(activeName, tab?.at ?? mapCard, { plus: true })
    return
  }
  if (e.target.closest('#tab-more')) {
    addMenu.hidden = true
    const menu = renderAllTabsMenu()
    menu.hidden = !menu.hidden
    if (!menu.hidden) {
      positionParkedMenu()
      refreshTitles()
    }
    return
  }
  const close = e.target.closest('[data-close]')
  if (close) {
    e.stopPropagation()
    closeTab(close.dataset.close)
    return
  }
  const chip = e.target.closest('[data-tab]')
  if (chip) switchTo(chip.dataset.tab)
})

/** #werk-mc-close: parks a tab immediately, ahead of the five-tab cap. If it was the active
 *  tab, switches to whichever remaining visible tab was touched most recently. `main` closes
 *  like any other tab. The last visible chip does not close — there would be nothing left to
 *  focus, and falling back to `main` used to put it back on the strip while it was still
 *  listed as parked. */
function closeTab(name) {
  if (!tabOrder.includes(name) || tabOrder.length <= 1) return
  const wasActive = name === activeName
  parkTab(name)
  if (wasActive) {
    const next = [...tabOrder].sort((a, b) => (tabs.get(b)?.lastTouch ?? 0) - (tabs.get(a)?.lastTouch ?? 0))[0]
    switchTo(next)
  }
}

/** Marks a tab as recently used, so it is not the next one #werk-mc-park evicts. */
function touch(name) {
  const tab = tabs.get(name)
  if (!tab) return
  tab.lastTouch = Date.now()
  saveTabsState()
}

/** Adds a tab to the visible strip. Over the cap of five, the least-recently-touched other
 *  tab is parked — never the one just added, and never a busy one. #werk-mc-park: a tab
 *  with a turn running, a pending ask, or a background agent is not idle. If every other
 *  tab is busy, the strip runs over the cap until one goes idle. */
function addTabToStrip(name) {
  touch(name)
  if (tabOrder.includes(name)) return
  tabOrder.push(name)
  if (tabOrder.length > MAX_VISIBLE_TABS) {
    const candidates = tabOrder.filter((n) => {
      if (n === name) return false
      const tab = tabs.get(n)
      const s = tab?.status?.state
      return s !== 'running' && s !== 'thinking' && s !== 'asking' && !tab?.background?.length
    })
    const victim = candidates.sort((a, b) => (tabs.get(a)?.lastTouch ?? 0) - (tabs.get(b)?.lastTouch ?? 0))[0]
    if (victim) parkTab(victim)
  }
  saveTabsState()
  renderTabStrip()
}

function parkTab(name) {
  tabOrder = tabOrder.filter((n) => n !== name)
  if (!parkedOrder.includes(name)) parkedOrder.push(name)
  fetch('/api/convo/park', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  saveTabsState()
  renderTabStrip()
}

/** Puts a parked tab back on the strip. switchTo calls this for every way of reaching a
 *  parked tab — the ⋯ menu, a shift+click on its card, the dead-bar's switch link — so none
 *  of them can focus a tab that is still listed as parked. #werk-mc-open, #werk-mc-park. */
function unparkTab(name) {
  parkedOrder = parkedOrder.filter((n) => n !== name)
  // Back on the strip, so its child is no longer #werk-mc-reap's to sweep.
  fetch('/api/convo/unpark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  addTabToStrip(name)
}

/** #werk-mc-open: shift+click forks and focuses. A plain click still navigates — see the
 *  document click handler below, which only reaches here when shift is held. */
async function forkAt(fromName, atCard, { plus = false } = {}) {
  // Shift+click again on a card that already has a tab switches to it. It does not fork
  // twice — see #werk-mc-open. Only the "+" button skips `fromName` itself: right after a
  // fork, a tab's own `at` equals its own `home`, so without this "+" matched the tab you
  // are already on and the button looked dead. A Shift+click on the active tab's own home
  // card matches it, and switching to yourself is the right no-op.
  const existing = [...tabs.entries()].find(([name, t]) => (!plus || name !== fromName) && t.home === atCard)
  if (existing) {
    switchTo(existing[0])
    return
  }
  try {
    const res = await fetch('/api/convo/fork', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: fromName, atCard }),
    })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
    ensureTab(out.name, atCard)
    addTabToStrip(out.name)
    await switchTo(out.name)
  } catch (err) {
    alert(`werk could not fork this conversation: ${err.message}`)
  }
}

/** #werk-mc-split-plus: always a new tab, also when a tab already has `atCard` as its
 *  home — a switch would show an old conversation with its history. */
async function startEmptyAt(atCard) {
  try {
    const res = await fetch('/api/convo/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ atCard }),
    })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
    ensureTab(out.name, atCard)
    addTabToStrip(out.name)
    await switchTo(out.name)
  } catch (err) {
    alert(`werk could not start an empty conversation: ${err.message}`)
  }
}

/** Whichever tab is active — a fresh fork, a keyboard jump, a click in the "…" menu — its
 *  chip must be visible on the strip, not scrolled off past #tab-scroll's edge. */
function scrollActiveTabIntoView() {
  tabChips.querySelector(`[data-tab="${CSS.escape(activeName)}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}

/** #werk-mc-follow: the conversation owns the card. Focusing a tab moves the map to
 *  wherever that conversation last was — home, if it never sent a turn. */
async function switchTo(name) {
  if (!tabs.has(name)) ensureTab(name)
  if (parkedOrder.includes(name)) unparkTab(name)
  if (!tabs.get(name).loaded) await hydrateTab(name)
  deadNotices.delete(name)
  renderDeadBar()
  if (activeName === name) {
    renderTabStrip()
    scrollActiveTabIntoView()
    return
  }
  const prev = tabs.get(activeName)
  if (prev) prev.logEl.hidden = true
  activeName = name
  touch(name)
  const tab = tabs.get(name)
  tab.logEl.hidden = false
  // #werk-mc-tab-bottom: a hidden log has no height, so only now can it scroll to the end.
  tab.logEl.scrollTop = tab.logEl.scrollHeight
  chatInput.value = tab.draft
  paintStatusUI(tab.status)
  renderAsks()
  if (tab.model) setModelSelect(tab.model)
  if (tab.context) renderContextFill(tab.context)
  saveTabsState()
  renderTabStrip()
  scrollActiveTabIntoView()
  const at = tab.at ?? tab.home ?? HOME
  // In another view the map card moves without a history entry. The map shows it on return.
  if (routeView() === 'map' && mapCard !== at) navigate(pathFor('map', at))
  else {
    mapCard = at
    render()
  }
}

function dropStaleTab(name) {
  tabOrder = tabOrder.filter((n) => n !== name)
  parkedOrder = parkedOrder.filter((n) => n !== name)
  const tab = tabs.get(name)
  tab?.logEl.remove()
  tabs.delete(name)
  if (activeName === name) activeName = tabOrder[0] ?? 'main'
}

/** Fetches one conversation's transcript fresh — used the first time a tab is shown, and
 *  again after its turn ends so a newly created card reference becomes a link. */
async function hydrateTab(name) {
  const tab = ensureTab(name)
  // #werk-mc-tab-bottom: a rebuild of a log the person already reads keeps their place. Only
  // a log that was at its end, or has never been shown, goes to the end.
  const res = await fetch(`/api/chat/history?convo=${encodeURIComponent(name)}`)
  // The server has no such conversation: the saved tab is stale, so it leaves the strip.
  if (res.status === 404) return dropStaleTab(name)
  const { messages, status, model, context, background } = await res.json()
  const stayAt = tab.loaded && name === activeName && !atBottomOf(tab.logEl) ? tab.logEl.scrollTop : null
  tab.logEl.innerHTML = ''
  tab.bubbles.clear()
  tab.toolGroup = null
  tab.turnEls.clear()
  tab.openTurns = []
  for (const m of messages) addChat(tab, m)
  tab.status = status ?? { state: 'idle' }
  if (!turnRunning(tab.status)) endAllTurns(tab)
  tab.model = model
  tab.context = context
  tab.background = background ?? []
  tab.dead = tab.status.state === 'dead'
  tab.wasRunning = tab.status.state === 'thinking' || tab.status.state === 'running' || tab.status.state === 'asking'
  tab.loaded = true
  if (name === activeName) {
    tab.logEl.scrollTop = stayAt ?? tab.logEl.scrollHeight
    paintStatusUI(tab.status)
    if (model) setModelSelect(model)
    if (context) renderContextFill(context)
  }
}

// ---------- pasted screenshots ----------
// The image is written next to the transcript and the agent opens it with Read.
// A `[Image #1]` token marks where in the message it belongs, as Claude Code does.

const shots = el('shots')
let pending = []

const token = (i) => `[Image #${i + 1}]`

function renderShots() {
  shots.innerHTML = pending
    .map((s, i) => {
      const thumb = s.name
        ? `<img src="/api/image?name=${encodeURIComponent(s.name)}" alt="">`
        : `<span class="spin"></span>`
      return `<span class="shot${s.name ? '' : ' loading'}">${thumb}
        <span class="shot-n">${token(i)}</span>
        <button type="button" data-drop="${i}" title="Remove">×</button></span>`
    })
    .join('')
}

function insertAtCaret(text) {
  const start = chatInput.selectionStart ?? chatInput.value.length
  const end = chatInput.selectionEnd ?? start
  chatInput.value = chatInput.value.slice(0, start) + text + chatInput.value.slice(end)
  const caret = start + text.length
  chatInput.setSelectionRange(caret, caret)
  chatInput.focus()
}

/** Drop the removed token, then close the gap so the numbers stay 1..n. */
function renumber(removed) {
  chatInput.value = chatInput.value
    .replace(new RegExp(`\\[Image #${removed + 1}\\]\\s?`, 'g'), '')
    .replace(/\[Image #(\d+)\]/g, (m, n) => (Number(n) > removed + 1 ? `[Image #${Number(n) - 1}]` : m))
}

shots.addEventListener('click', (e) => {
  const drop = e.target.closest('[data-drop]')
  if (!drop) return
  const i = Number(drop.dataset.drop)
  pending.splice(i, 1)
  renumber(i)
  renderShots()
})

async function upload(file) {
  const holder = { name: '', path: '' }
  pending.push(holder)
  insertAtCaret(`${token(pending.length - 1)} `)
  renderShots()
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
    Object.assign(holder, { name: out.name, path: out.path })
  } catch (err) {
    const i = pending.indexOf(holder)
    if (i >= 0) {
      pending.splice(i, 1)
      renumber(i)
    }
    alert(`werk could not attach the image: ${err.message}`)
  }
  renderShots()
}

function imagesFrom(items) {
  return [...(items ?? [])].filter((i) => i.type?.startsWith('image/')).map((i) => (i.getAsFile ? i.getAsFile() : i))
}

chatInput.addEventListener('paste', (e) => {
  const files = imagesFrom(e.clipboardData?.items).filter(Boolean)
  if (files.length === 0) return
  e.preventDefault()
  files.forEach(upload)
})

for (const type of ['dragover', 'drop']) {
  el('chat').addEventListener(type, (e) => {
    e.preventDefault()
    el('chat').classList.toggle('dropping', type === 'dragover')
    if (type === 'drop') imagesFrom(e.dataTransfer?.files).forEach(upload)
  })
}
el('chat').addEventListener('dragleave', () => el('chat').classList.remove('dropping'))

// ---------- the `/` and `#` menu ----------
// `/` matches a skill or command, project and user, plus the CLI's own built-ins. Fetched
// once: the list changes only when a skill is added, never mid-keystroke. `#` matches a
// card on the map, read live from G since cards change every turn.

const cmdMenu = el('cmd-menu')
let COMMANDS = []
let cmdMatches = []
let cmdSel = 0
let cmdToken = null

async function loadCommands() {
  COMMANDS = await (await fetch('/api/commands')).json()
}

/** The start and end of the line the caret sits on — a token never crosses a line break. */
function currentLine(caret) {
  const value = chatInput.value
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const nlAfter = value.indexOf('\n', lineStart)
  return { lineStart, lineEnd: nlAfter === -1 ? value.length : nlAfter }
}

/**
 * The `/word` or `#word` run ending at the caret, wherever it sits on the line — not only
 * at the line's start. A backtick right before the trigger character marks inline code,
 * as in `` `/foo` `` or `` `#bar` ``, so the menu stays closed there.
 */
function triggerToken() {
  const value = chatInput.value
  const caret = chatInput.selectionStart
  const { lineStart } = currentLine(caret)
  let start = caret
  while (start > lineStart && !/\s/.test(value[start - 1])) start--
  const word = value.slice(start, caret)
  const triggerChar = word[0]
  if (triggerChar !== '/' && triggerChar !== '#') return null
  if (value[start - 1] === '`') return null
  return { kind: triggerChar === '/' ? 'command' : 'card', query: word.slice(1), start, end: caret }
}

/** Command matches, shaped for the shared menu renderer. */
function matchCommands(query) {
  const q = query.toLowerCase()
  return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q))
    .slice(0, 20)
    .map((c) => ({ label: `/${c.name}`, desc: c.description, badge: c.badge }))
}

/**
 * Card matches, shaped for the shared menu renderer. An empty query lists the most
 * recently added cards — G.nodes is oldest first, so that list is reversed.
 */
function matchCards(query) {
  const q = query.toLowerCase()
  const nodes = q ? (G?.nodes ?? []) : [...(G?.nodes ?? [])].reverse()
  const hits = nodes.filter((n) => `${n.id} ${titleOf(n)}`.toLowerCase().includes(q))
  return hits.slice(0, 20).map((n) => ({ label: `#${n.id}`, desc: titleOf(n), badge: n.kind }))
}

function closeCmdMenu() {
  cmdMenu.hidden = true
  cmdMatches = []
  cmdSel = 0
  cmdToken = null
}

/**
 * A clone of the textarea, off-screen, used only to measure where the caret would fall in
 * pixels — a textarea cannot answer that itself. Its font, padding and width must match
 * exactly, or the line the caret wraps to would come out wrong.
 */
const caretMirror = document.createElement('div')
caretMirror.style.cssText =
  'position:fixed;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;pointer-events:none;top:0;left:0'
document.body.append(caretMirror)
const MIRROR_PROPS = [
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
]

/** Where the caret sits, in pixels relative to the composer — the box cmd-menu positions in. */
function caretPixels() {
  const inputRect = chatInput.getBoundingClientRect()
  const composerRect = el('chat-composer').getBoundingClientRect()
  const cs = getComputedStyle(chatInput)
  for (const prop of MIRROR_PROPS) caretMirror.style[prop] = cs[prop]
  // Set from the rendered box, not the computed 'width', which reports the content width
  // even under box-sizing: border-box — matching that here would wrap a line too early.
  caretMirror.style.boxSizing = 'border-box'
  caretMirror.style.width = `${inputRect.width}px`
  caretMirror.style.left = `${inputRect.left}px`
  caretMirror.style.top = `${inputRect.top}px`
  caretMirror.textContent = chatInput.value.slice(0, chatInput.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  caretMirror.append(marker)
  const markerRect = marker.getBoundingClientRect()
  return {
    top: markerRect.top - composerRect.top - chatInput.scrollTop,
    left: markerRect.left - composerRect.left,
  }
}

function positionCmdMenu() {
  const { top, left } = caretPixels()
  const composerWidth = el('chat-composer').getBoundingClientRect().width
  const width = cmdMenu.getBoundingClientRect().width
  cmdMenu.style.setProperty('--x', `${Math.max(0, Math.min(left, composerWidth - width - 8))}px`)
  cmdMenu.style.setProperty('--y', `${top}px`)
}

function renderCmdMenu() {
  cmdMenu.hidden = false
  cmdMenu.innerHTML = cmdMatches.length
    ? cmdMatches
        .map(
          (c, i) => `<div class="cmd-item${i === cmdSel ? ' sel' : ''}" data-pick="${i}">
            <span class="name">${esc(c.label)}</span>
            <span class="desc">${esc(c.desc)}</span>
            <span class="badge">${esc(c.badge)}</span>
          </div>`,
        )
        .join('')
    : `<div class="cmd-empty">No match</div>`
  positionCmdMenu()
}

function updateCmdMenu() {
  const tok = triggerToken()
  if (tok === null) {
    closeCmdMenu()
    return
  }
  cmdToken = tok
  cmdMatches = tok.kind === 'command' ? matchCommands(tok.query) : matchCards(tok.query)
  cmdSel = 0
  renderCmdMenu()
}

/** Replace the `/word` or `#word` token with the picked match, leaving the rest of the line alone. */
function pickMatch(i) {
  const m = cmdMatches[i]
  if (!m || !cmdToken) return
  const value = chatInput.value
  const { start, end } = cmdToken
  const insert = `${m.label} `
  chatInput.value = value.slice(0, start) + insert + value.slice(end)
  const caret = start + insert.length
  chatInput.setSelectionRange(caret, caret)
  closeCmdMenu()
  chatInput.focus()
}

// Keeps the textarea focused: without this, the button's own focus/blur cycle would close
// the menu (via the input's blur) before the click below ever fires.
cmdMenu.addEventListener('mousedown', (e) => e.preventDefault())
cmdMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-pick]')
  if (item) pickMatch(Number(item.dataset.pick))
})

chatInput.addEventListener('input', updateCmdMenu)
// #werk-mc-follow: a draft belongs to its tab, so it must survive a switch away and back.
chatInput.addEventListener('input', () => {
  const tab = tabs.get(activeName)
  if (tab) tab.draft = chatInput.value
})
// The mousedown above only covers a click on the menu itself; a click anywhere else in
// the page still blurs the textarea, and the menu must not outlive that.
chatInput.addEventListener('blur', closeCmdMenu)

el('chat-composer').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = chatInput.value.trim()
  const images = pending.filter((p) => p.path).map((p) => p.path)
  if (!text && images.length === 0) return
  chatInput.value = ''
  const tab = tabs.get(activeName)
  if (tab) tab.draft = ''
  pending = []
  renderShots()
  closeCmdMenu()
  paintStatusUI({ state: 'thinking' })
  await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // #werk-chat-turn-id: the turn is named here, when the message is sent.
    body: JSON.stringify({ text, images, card: chatCard(), convo: activeName, turn: crypto.randomUUID() }),
  })
})

// #werk-mc-fork-notice: the fork's first line jumps to the parent tab, at the message that
// was last when the fork was made. A message past the 200-line history window is not in the
// DOM, so the jump then only switches tabs.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.fork-jump')
  if (!btn) return
  await switchTo(btn.dataset.convo)
  const target = tabs.get(btn.dataset.convo)?.logEl.querySelector(`[data-at="${CSS.escape(btn.dataset.at)}"]`)
  if (!target) return
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.remove('fork-point')
  void target.offsetWidth
  target.classList.add('fork-point')
})

// #werk-mc-nextbtn: a click sends the phrase as a normal message. It goes straight to
// /api/chat, so a draft in the composer and its pending images stay where they are.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.next-btn')
  if (!btn) return
  const text = btn.dataset.say
  btn.disabled = true
  const tab = tabs.get(activeName)
  if (tab?.offer) {
    tab.offer = false
    renderTabStrip()
  }
  paintStatusUI({ state: 'thinking' })
  await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, images: [], card: chatCard(), convo: activeName, turn: crypto.randomUUID() }),
  })
})

chatInput.addEventListener('keydown', (e) => {
  if (!cmdMenu.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!cmdMatches.length) return
      cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + cmdMatches.length) % cmdMatches.length
      renderCmdMenu()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      pickMatch(cmdSel)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeCmdMenu()
      return
    }
  }
  // Cmd+Enter belongs to the approval bar. Without this guard one keystroke both sends the
  // message and allows the pending call, because the two handlers sit on different targets.
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    e.target.form.requestSubmit()
  }
})

/** The chip above the composer names the card the next message will carry. */
function renderContext() {
  const id = chatCard()
  const n = node(id)
  el('context').innerHTML = n
    ? `<span class="chip">#${esc(id)}</span><span class="chip-title">${esc(titleOf(n))}</span>`
    : id === HOME
      ? '<span class="chip-title">Home</span>'
      : ''
}

// ---------- the resizable divider ----------
const grip = el('grip')
grip.addEventListener('pointerdown', (e) => {
  grip.setPointerCapture(e.pointerId)
  const move = (ev) => {
    const width = Math.min(760, Math.max(300, innerWidth - ev.clientX))
    document.documentElement.style.setProperty('--chat-w', `${width}px`)
  }
  const up = () => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    localStorage.setItem('chat-w', getComputedStyle(document.documentElement).getPropertyValue('--chat-w'))
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
})
const savedWidth = localStorage.getItem('chat-w')
if (savedWidth) document.documentElement.style.setProperty('--chat-w', savedWidth)

// ---------- jump ----------
const jump = el('jump')
const results = el('results')
let sel = 0

/**
 * #vi-jump-hash: a leading # matches ids only — the exact id, then ids that start with the
 * query, then ids that contain it. Without the #, every word of the card can match.
 */
function searchHits(raw) {
  const byId = raw.startsWith('#')
  const q = (byId ? raw.slice(1) : raw).toLowerCase()
  if (!q) return []
  if (!byId)
    return G.nodes.filter((n) => `${n.id} ${titleOf(n)} ${n.why ?? ''} ${n.finding ?? ''}`.toLowerCase().includes(q))
  const rank = (id) => (id === q ? 0 : id.startsWith(q) ? 1 : id.includes(q) ? 2 : 3)
  return G.nodes
    .filter((n) => rank(n.id.toLowerCase()) < 3)
    .sort((a, b) => rank(a.id.toLowerCase()) - rank(b.id.toLowerCase()) || a.id.localeCompare(b.id))
}

/**
 * #vi-jump-row: a card's dot takes its status color, red when stale. A postponed card's dot
 * is split on the diagonal, status color and grey. Other kinds have no status: the dot takes
 * the kind color.
 */
function dotClass(n) {
  if (n.kind !== 'card') return n.kind
  if (G.stale.has(n.id)) return 'stale'
  const status = n.status ?? 'open'
  return G.postponed.has(n.id) || G.postponedOrigins.has(n.id) ? `${status} postponed` : status
}

function search() {
  const hits = searchHits(jump.value.trim()).slice(0, 12)
  sel = 0
  results.hidden = hits.length === 0
  results.innerHTML = hits
    .map(
      (n, i) =>
        `<button data-go="${esc(n.id)}" class="${i === 0 ? 'sel' : ''}" title="${esc(n.kind)}">` +
        `<i class="dot ${dotClass(n)}"></i><span class="t">${esc(titleOf(n))}</span><small>${esc(n.id)}</small></button>`,
    )
    .join('')
}

jump.addEventListener('input', search)
jump.addEventListener('keydown', (e) => {
  const items = [...results.querySelectorAll('button')]
  if (e.key === 'Escape') {
    jump.value = ''
    results.hidden = true
    jump.blur()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)))
    items.forEach((b, i) => b.classList.toggle('sel', i === sel))
  } else if (e.key === 'Enter' && items[sel]) {
    go(items[sel].dataset.go)
  }
})

/** Opens a card on the map, from any view. */
function go(id) {
  navigate(pathFor('map', id))
  jump.value = ''
  results.hidden = true
  jump.blur()
}

/**
 * #vi-remove-btn-reparent: the three-answer confirmation for a card with children. Resolves
 * to true (children move up), false (the whole subtree goes), or null (cancel). Each answer
 * names its count, so the choice reads without opening the tree.
 */
function askRemoval(id, n, kids, up) {
  const direct = children(id).length
  const dlg = document.createElement('dialog')
  dlg.className = 'remove-dlg'
  dlg.innerHTML = `
    <p class="rd-q">Remove <b>${esc(titleOf(n))}</b>?</p>
    <p class="rd-note">The log keeps every card. Restore from the root card.</p>
    <div class="rd-btns">
      <button type="button" value="all" class="rd-all">Remove it and the ${kids} card(s) below it</button>
      <button type="button" value="up" class="rd-up">Remove only this card — its ${direct} child card(s) move up to <b>${esc(up === HOME ? 'the top of the map' : titleOf(node(up)))}</b></button>
      <button type="button" value="cancel" class="rd-cancel">Cancel</button>
    </div>`
  document.body.append(dlg)
  return new Promise((resolve) => {
    let answer = null
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (e.target === dlg) dlg.close()
      if (!b) return
      answer = b.value === 'up' ? true : b.value === 'all' ? false : null
      dlg.close()
    })
    dlg.addEventListener('close', () => {
      dlg.remove()
      resolve(answer)
    })
    dlg.showModal()
    dlg.querySelector('.rd-up').focus()
  })
}

function runRemoval(btn, id, up, reparent) {
  btn.disabled = true
  fetch('/api/node/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, reparent }),
  })
    .then((r) => r.json())
    .then((outcome) => {
      if (!outcome.ok) throw new Error(outcome.error)
      go(up)
      load()
    })
    .catch((err) => {
      btn.disabled = false
      alert(`werk could not remove ${id}: ${err.message}`)
    })
}

// #werk-mc-open: shift+click forks at the card under the cursor and focuses it. A plain
// click still navigates — same target, only the modifier differs.
document.addEventListener('click', (e) => {
  if (e.shiftKey) {
    const ref = e.target.closest('a.ref')
    const goTarget = e.target.closest('[data-go]')
    const id = ref ? cardOfHref(ref.getAttribute('href')) : goTarget?.dataset.go
    if (id) {
      e.preventDefault()
      forkAt(activeName, id)
      return
    }
  }
  // #vi-routes: a card link opens the card on the map, from any view, without a page load.
  // A modified click keeps the browser's own behaviour: a new tab at the card's address.
  const link = e.target.closest('a[href]')
  const linked = link && cardOfHref(link.getAttribute('href'))
  if (linked && !e.defaultPrevented && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    go(linked)
    return
  }
  const copy = e.target.closest('[data-copy]')
  if (copy) {
    navigator.clipboard?.writeText(`#${copy.dataset.copy}`)
    copy.textContent = 'copied'
    setTimeout(() => (copy.textContent = `#${copy.dataset.copy}`), 900)
    return
  }
  const locate = e.target.closest('[data-locate]')
  if (locate) {
    locateInGraph(locate.dataset.locate)
    return
  }
  // #vi-board-plan: the planning marker opens the subtree's plan card on the board.
  const toPlan = e.target.closest('[data-open-plan]')
  if (toPlan) {
    openPlan(toPlan.dataset.openPlan)
    setView('board')
    return
  }
  const locateDiagram = e.target.closest('[data-locate-diagram]')
  if (locateDiagram) {
    locateInDiagram(locateDiagram.dataset.locateDiagram)
    return
  }
  // #werk-remove. Nothing leaves the log, so the only question worth asking is how many
  // cards go at once — a subtree removal is the one that can surprise you.
  const remove = e.target.closest('[data-remove]')
  if (remove) {
    const id = remove.dataset.remove
    const n = node(id)
    const kids = subtreeSize(id) - 1
    const up = parent(id) ?? HOME
    // #vi-remove-btn-reparent: a card with children gets a third answer, the reparent the
    // server already runs. A plain card and a ghost keep the one confirm.
    if (!n?.proposed && kids > 0) {
      askRemoval(id, n, kids, up).then((reparent) => {
        if (reparent !== null) runRemoval(remove, id, up, reparent)
      })
      return
    }
    const question = n?.proposed
      ? `Discard the proposed card "${titleOf(n)}"? It never entered the map.`
      : `Remove "${titleOf(n)}"?\nThe log keeps it. Restore from the root card.`
    if (!confirm(question)) return
    runRemoval(remove, id, up, false)
    return
  }
  const restore = e.target.closest('[data-restore]')
  if (restore) {
    const id = restore.dataset.restore
    restore.disabled = true
    fetch('/api/node/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((outcome) => {
        if (!outcome.ok) throw new Error(outcome.error)
        go(id)
        load()
      })
      .catch((err) => {
        restore.disabled = false
        alert(`werk could not restore ${id}: ${err.message}`)
      })
    return
  }
  // #vi-board-plan-controls: the same Resume and Restart the plan card on the board offers,
  // with the same confirmation for a restart.
  const resumeBtn = e.target.closest('[data-resume-subtree]')
  const restartBtn = e.target.closest('[data-restart-subtree]')
  if (resumeBtn || restartBtn) {
    const id = (resumeBtn ?? restartBtn).dataset[resumeBtn ? 'resumeSubtree' : 'restartSubtree']
    const run = resumeBtn ? resumeSubtree : restartSubtree
    ;(resumeBtn ?? restartBtn).disabled = true
    run(id)
      .then((err) => err && alert(`werk could not ${resumeBtn ? 'resume' : 'restart'} ${id}: ${err}`))
      .catch((err) => alert(`werk could not ${resumeBtn ? 'resume' : 'restart'} ${id}: ${err.message}`))
      .finally(() => paintBuildButton(id))
    return
  }
  const buildSubtree = e.target.closest('[data-build-subtree]')
  if (buildSubtree) {
    const id = buildSubtree.dataset.buildSubtree
    buildSubtree.disabled = true
    fetch('/api/subtree/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((outcome) => {
        if (!outcome.ok) throw new Error(outcome.error)
        paintBuildButton(id)
      })
      .catch((err) => {
        alert(`werk could not build ${id}: ${err.message}`)
        paintBuildButton(id)
      })
    return
  }
  const acceptChange = e.target.closest('[data-accept-change]')
  if (acceptChange) {
    const id = acceptChange.dataset.acceptChange
    acceptChange.disabled = true
    // The click redraws from its own answer. The `changed` stream event is a second
    // trigger, not the only one: a watcher that stopped firing must not hide the accept.
    fetch('/api/change/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((outcome) => {
        if (!outcome.ok) throw new Error(outcome.error)
        load()
      })
      .catch((err) => {
        acceptChange.disabled = false
        alert(`werk could not accept ${id}: ${err.message}`)
      })
    return
  }
  const target = e.target.closest('[data-go]')
  if (target) go(target.dataset.go)
  else if (!e.target.closest('#jump')) results.hidden = true
})

// ---------- the 3D graph view ----------
// The tree view (refines) hides a depends_on edge that crosses subtrees: the two ends sit
// in different branches, so no single-parent layout can show both at once. A 3D
// force-directed graph plots every node once and draws every edge, tree and cross-tree
// alike, so a dependency that skips across the map is as visible as one that does not.

const viewToggle = el('view-toggle')
const mapView = el('map-view')
const graphView = el('graph-view')
const diagramView = el('diagram-view')
const g3dPanel = el('g3d-panel')

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

let g3dColors = null
function colorsFor3D() {
  if (!g3dColors) {
    g3dColors = {
      decided: cssVar('--decided'),
      open: cssVar('--open'),
      proto: cssVar('--proto'),
      stale: cssVar('--stale'),
      postponed: cssVar('--postponed'),
      source: cssVar('--src'),
      option: cssVar('--opt'),
      excerpt: cssVar('--line2'),
    }
  }
  return g3dColors
}

// Postponed does not get its own color here — same rule as the 2D rollup bar. A postponed card
// keeps the color of its real status; postponed is drawn as a hatch on top of it, in
// buildNodeObject, not a replacement color. Otherwise a postponed-but-decided card and a
// postponed-but-open card would look identical, and status would be lost as soon as
// something froze it.
function baseNodeColor3D(n) {
  const c = colorsFor3D()
  if (n.stale) return c.stale
  if (n.kind === 'card') return c[n.status ?? 'open']
  return c[n.kind] ?? c.excerpt
}

// A node is at hop 0 (itself) or hop 1 (a direct link, any type, either direction) reads
// at full color. Past that, it fades toward the background — the farther, the fainter —
// so distance in the graph is a distance you can see, not just a click count.
const G3D_BG = [5, 7, 10] // matches --background #05070a used by the 3D canvas
const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// A node with no BFS path to the selection (h undefined) is treated as maximally far,
// not as unselected — a node in a disconnected part of the map should read as distant,
// not snap back to full color.
const fadeForHop = (h) => {
  const hop = h ?? Infinity
  return hop <= 1 ? 0 : Math.min(0.82, 0.26 * (hop - 1))
}
function fadeToward(hex, t) {
  if (t <= 0) return hex
  const [r, g, b] = hexToRgb(hex)
  const mix = (a, bg) => Math.round(a + (bg - a) * t)
  return `rgb(${mix(r, G3D_BG[0])},${mix(g, G3D_BG[1])},${mix(b, G3D_BG[2])})`
}

// The selected node used to turn solid white, which read as "picked" but threw its
// status/kind color away — the one thing you're trying to place in the graph. It keeps
// its real color now; buildNodeObject adds a white glow around it instead, so selection
// is a mark next to the node, not a color that replaces the node's own.
function nodeColor3D(n) {
  const base = baseNodeColor3D(n)
  if (!g3dHops) return base
  return fadeToward(base, fadeForHop(g3dHops.get(n.id)))
}

const EDGE_COLOR_3D = {
  refines: 'rgba(139,152,168,0.5)',
  depends_on: 'rgba(210,153,34,0.85)',
  supported_by: 'rgba(163,113,247,0.55)',
  alternative_to: 'rgba(255,158,100,0.7)',
}
function endId(x) {
  return typeof x === 'object' ? x.id : x
}
function linkColor3D(l) {
  const base = EDGE_COLOR_3D[l.type] ?? 'rgba(139,152,168,0.4)'
  if (!g3dHops) return base
  const h = Math.min(g3dHops.get(endId(l.source)) ?? Infinity, g3dHops.get(endId(l.target)) ?? Infinity)
  const fade = fadeForHop(h)
  if (fade <= 0) return base
  return base.replace(/[\d.]+\)$/, (a) => `${(parseFloat(a) * (1 - fade)).toFixed(2)})`)
}
function nodeVal3D(n) {
  const base = n.kind === 'card' ? 3 : 1.6
  return n.id === g3dSelected ? base * 1.8 : base
}

/**
 * The same diagonal hatch as .rollup i.bar-postponed, baked into a small canvas and wrapped
 * onto the sphere: the base fill is the node's real status color, the stripes are the
 * postponed color painted over it. Regenerated per call — cheap at this node count, and it
 * has to be, since the fill and stripe colors both change with the hop-distance fade.
 */
function stripeTexture(baseColor, stripeColor) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = stripeColor
  ctx.lineWidth = size / 8
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate((135 * Math.PI) / 180)
  for (let x = -size * 1.5; x <= size * 1.5; x += size / 4) {
    ctx.beginPath()
    ctx.moveTo(x, -size * 1.5)
    ctx.lineTo(x, size * 1.5)
    ctx.stroke()
  }
  ctx.restore()
  const tex = new THREE3.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE3.RepeatWrapping
  tex.repeat.set(2, 2)
  return tex
}

/**
 * A soft radial falloff, white at the center to transparent at the edge. One canvas,
 * reused for every selected node — there is only ever one at a time, and the color never
 * changes, so nothing about this needs to be rebuilt per call the way the hatch does.
 */
let g3dGlowTex = null
function glowTexture() {
  if (g3dGlowTex) return g3dGlowTex
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  g3dGlowTex = new THREE3.CanvasTexture(canvas)
  return g3dGlowTex
}

/** nodeThreeObject: the mesh IS the visual now, so stale/postponed/fade all have to be
 *  decided here, once per node, rather than left to the library's own coloring. */
function buildNodeObject(n) {
  const radius = Math.cbrt(nodeVal3D(n)) * 4
  const geometry = new THREE3.SphereGeometry(radius, 12, 12)
  const showHatch = !n.stale && n.postponed
  let material
  if (showHatch) {
    const fade = g3dHops ? fadeForHop(g3dHops.get(n.id)) : 0
    const base = fadeToward(baseNodeColor3D(n), fade)
    const stripe = fadeToward(colorsFor3D().postponed, fade)
    material = new THREE3.MeshBasicMaterial({ map: stripeTexture(base, stripe) })
  } else {
    material = new THREE3.MeshBasicMaterial({ color: nodeColor3D(n) })
  }
  const mesh = new THREE3.Mesh(geometry, material)
  if (n.id !== g3dSelected) return mesh

  const group = new THREE3.Group()
  group.add(mesh)
  const glow = new THREE3.Sprite(
    new THREE3.SpriteMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE3.AdditiveBlending,
    }),
  )
  glow.scale.set(radius * 5, radius * 5, 1)
  group.add(glow)
  return group
}

/** BFS over every edge, either direction, any type — "how far" means how far in the map. */
function hopsFrom(id, links) {
  const adj = new Map()
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push(b)
  }
  for (const l of links) {
    const s = endId(l.source)
    const t = endId(l.target)
    link(s, t)
    link(t, s)
  }
  const dist = new Map([[id, 0]])
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()
    for (const nb of adj.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(cur) + 1)
        queue.push(nb)
      }
    }
  }
  return dist
}

function graphData3D() {
  const nodes = G.nodes.map((n) => ({
    id: n.id,
    title: titleOf(n),
    kind: n.kind,
    status: n.status,
    stale: G.stale.has(n.id),
    postponed: G.postponed.has(n.id),
  }))
  const ids = new Set(nodes.map((n) => n.id))
  const links = G.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, type: e.type }))
  return { nodes, links }
}

function g3dLegendHTML() {
  const c = colorsFor3D()
  const dot = (color, label) => `<div class="g3d-row"><i class="swatch" style="background:${color}"></i>${esc(label)}</div>`
  const line = (color, label, dashed) => `<div class="g3d-row"><i class="line${dashed ? ' dashed' : ''}" style="border-color:${color}"></i>${esc(label)}</div>`
  return [
    dot(c.decided, 'decided'),
    dot(c.open, 'open'),
    dot(c.proto, 'proto'),
    dot(c.source, 'source'),
    dot(c.option, 'option'),
    dot(c.stale, 'stale'),
    `<div class="g3d-row"><i class="swatch hatch" style="background:${c.open};--stripe:${c.postponed}"></i>postponed</div>`,
    line('rgba(139,152,168,0.8)', 'refines', false),
    line('rgba(210,153,34,0.9)', 'depends on →', false),
    line('rgba(163,113,247,0.8)', 'supported by', true),
    line('rgba(255,158,100,0.9)', 'alternative to', true),
  ].join('')
}

let ForceGraph3D = null
/** The three.js module 3d-force-graph itself resolved via the "three" import map entry —
 *  buildNodeObject needs the exact same instance to hand back meshes the renderer owns. */
let THREE3 = null
let g3d = null
let g3dResizeObs = null
/** The id of the node the graph is centered on, or null when nothing is picked. */
let g3dSelected = null
/** Map<id, hops> from g3dSelected, or null when nothing is picked. */
let g3dHops = null

/** Recolors and resizes every node and link for the current g3dSelected/g3dHops. */
function applyHighlight(id) {
  g3dSelected = id
  g3dHops = id ? hopsFrom(id, g3d.graphData().links) : null
  // Kapsule accessors re-run their paint pass on any set, even to their own current value —
  // this is the library's own documented way to force a repaint after mutating state that
  // the accessor closures read (see the "highlight" example in the 3d-force-graph docs).
  // nodeThreeObject rebuilds every mesh from scratch on this call, which is what picks up
  // the new selected/fade colors — there is no cheaper per-mesh update hook for this.
  g3d.nodeThreeObject(g3d.nodeThreeObject()).linkColor(g3d.linkColor())
}

function focusCamera(n) {
  const distRatio = 1 + 60 / Math.hypot(n.x, n.y, n.z || 1)
  g3d.cameraPosition({ x: n.x * distRatio, y: n.y * distRatio, z: n.z * distRatio }, n, 700)
}

/** Called from the "Locate in graph" button on a card. Switches view, then waits out the
 *  library's lazy import and the force layout's first tick before the node has real x/y/z. */
function locateInGraph(id) {
  setView('graph')
  const attempt = (triesLeft) => {
    const n = g3d?.graphData().nodes.find((x) => x.id === id)
    if (n && Number.isFinite(n.x)) {
      focusCamera(n)
      applyHighlight(n.id)
      showG3DPanel(n)
    } else if (triesLeft > 0) {
      setTimeout(() => attempt(triesLeft - 1), 150)
    }
  }
  attempt(30)
}

function showG3DPanel(n) {
  const full = node(n.id)
  if (!full) {
    g3dPanel.hidden = true
    return
  }
  g3dPanel.hidden = false
  g3dPanel.style.borderLeftColor = baseNodeColor3D(n)
  g3dPanel.innerHTML = `
    <h3>${titleHTML(titleOf(full))}</h3>
    <p>#${esc(full.id)} · ${esc(full.kind)}${full.status ? ` · ${esc(full.status)}` : ''}</p>
    ${full.why ? `<p>${esc(full.why)}</p>` : ''}
    <button type="button">Open in map</button>`
  g3dPanel.querySelector('button').onclick = () => {
    go(full.id)
  }
}

async function mountGraph3D() {
  if (!G) return
  const container = el('graph3d')
  el('g3d-legend').innerHTML = g3dLegendHTML()
  if (!ForceGraph3D) {
    try {
      const [mod, three] = await Promise.all([import('3d-force-graph'), import('three')])
      ForceGraph3D = mod.default
      THREE3 = three
    } catch (err) {
      // A failed dynamic import used to fail silently into a small, easy-to-miss line of
      // dim text — a real outage here reads as "the graph area is just black". Logging the
      // real error is what turns that into a two-minute fix instead of a debugging session.
      console.error('werk: failed to load the 3D graph libraries', err)
      container.innerHTML = `<p class="empty" style="padding:16px;color:var(--stale)">Could not load the 3D graph library from esm.sh.<br>${esc(String(err?.message ?? err))}<br>Check the browser console, then reopen this view.</p>`
      return
    }
  }
  if (!g3d) {
    g3d = ForceGraph3D()(container)
      .backgroundColor('#05070a')
      .nodeLabel((n) => `${esc(titleOf(n))} · ${esc(n.kind)}`)
      .nodeVal(nodeVal3D)
      .nodeThreeObject(buildNodeObject)
      .linkColor(linkColor3D)
      .linkWidth((l) => (l.type === 'depends_on' ? 1.4 : 0.7))
      .linkCurvature((l) => (l.type === 'refines' ? 0 : 0.22))
      .linkDirectionalArrowLength((l) => (l.type === 'depends_on' ? 5 : 0))
      .linkDirectionalArrowRelPos(1)
      .onNodeClick((n) => {
        focusCamera(n)
        applyHighlight(n.id)
        showG3DPanel(n)
      })
      .onBackgroundClick(() => {
        g3dPanel.hidden = true
        applyHighlight(null)
      })
    g3dResizeObs = new ResizeObserver(() => g3d.width(container.clientWidth).height(container.clientHeight))
    g3dResizeObs.observe(container)
  }
  g3d.graphData(graphData3D())
  g3d.resumeAnimation()
}

function unmountGraph3D() {
  g3d?.pauseAnimation()
}

// #vi-sysdiag-render decided grid over the hand-drawn SVG, the intent+resolver router,
// D2+TALA, and libavoid — see #vi-sysdiag-grid-mincell. #vi-sysdiag-grid-mincell then took
// the switcher away too: grid-full-minimal is the one diagram now, not one of several
// prototypes to flip between.
const diagramSvgInlineEl = el('diagram-svg-inline')
const diagramSourceEl = el('diagram-source')
const diagramDebugBtn = el('diagram-debug-btn')
const diagramScrollEl = el('diagram-scroll')
const diagramZoomEl = el('diagram-zoom')
const diagramZoomLevelEl = el('diagram-zoom-level')
const diagramPickedEl = el('diagram-picked')
const DIAGRAM_STYLE = 'grid-full-minimal'

// The SVG is fetched as text and inlined, not set as an <img src=...> — the bug-icon button
// toggles a <g id="debug-columns"> that already exists inside the file (render.ts always
// emits it, hidden), and an <img> is opaque to script, so its internal elements would
// otherwise be unreachable. The same inlining is what makes #vi-sysdiag-link's per-element
// data-cards attributes reachable at all.
let svgLoaded = false
async function mountDiagram() {
  if (svgLoaded) {
    applyDiagramZoom()
    return
  }
  svgLoaded = true

  const [svg, source] = await Promise.all([
    fetch(`/api/diagram-svg?style=${DIAGRAM_STYLE}`).then((r) => r.text()),
    fetch(`/api/diagram-source?style=${DIAGRAM_STYLE}`).then((r) => r.text()),
  ])
  diagramSvgInlineEl.innerHTML = svg
  diagramSourceCache = source
  const svgEl = diagramSvgInlineEl.querySelector('svg')
  if (svgEl) {
    // The authored size, kept before any zoom overwrites the width/height attributes. The
    // viewBox is what actually scales the drawing, so these two numbers are the only state
    // the zoom needs.
    diagramNatural = { w: Number(svgEl.getAttribute('width')), h: Number(svgEl.getAttribute('height')) }
  }
  applyDiagramDebug()
  applyDiagramZoom()
  if (pendingDiagramLocate) {
    const id = pendingDiagramLocate
    pendingDiagramLocate = null
    locateInDiagram(id)
  }
}

// ---------- #vi-sysdiag-zoomui: fit by default, 100% as the ceiling ----------
// The whole 2586x1303 drawing never fits a pane at 1:1, and the first thing anyone wants from
// an architecture picture is the shape of the whole thing. So the default is "fit", and 100%
// is the top of the range, not the start of it — zooming in past the authored size would only
// blur text the resolver already sized exactly (#vi-sysdiag-metrics).
const DIAGRAM_ZOOM_MIN = 0.15
let diagramNatural = { w: 0, h: 0 }
/** Either the string 'fit' or an explicit scale between DIAGRAM_ZOOM_MIN and 1. */
let diagramZoom = 'fit'

function diagramFitScale() {
  if (!diagramNatural.w || !diagramNatural.h) return 1
  const pad = 40 // .diagram-scroll's own padding, both sides
  const availW = diagramScrollEl.clientWidth - pad
  const availH = diagramScrollEl.clientHeight - pad
  if (availW <= 0 || availH <= 0) return 1
  return Math.max(DIAGRAM_ZOOM_MIN, Math.min(1, availW / diagramNatural.w, availH / diagramNatural.h))
}

function diagramScale() {
  return diagramZoom === 'fit' ? diagramFitScale() : diagramZoom
}

function applyDiagramZoom() {
  const svgEl = diagramSvgInlineEl.querySelector('svg')
  if (!svgEl || !diagramNatural.w) return
  const scale = diagramScale()
  // Resizing the <svg> element, not a CSS transform: the viewBox then re-rasterises every
  // stroke and glyph at the new size, so text stays sharp instead of being scaled bitmap.
  svgEl.setAttribute('width', String(Math.round(diagramNatural.w * scale)))
  svgEl.setAttribute('height', String(Math.round(diagramNatural.h * scale)))
  const fit = diagramFitScale()
  diagramZoomLevelEl.textContent = diagramZoom === 'fit' ? `fit ${Math.round(fit * 100)}%` : `${Math.round(scale * 100)}%`
  diagramZoomEl.querySelector('[data-zoom="in"]').disabled = scale >= 1 - 1e-6
  diagramZoomEl.querySelector('[data-zoom="out"]').disabled = scale <= DIAGRAM_ZOOM_MIN + 1e-6
}

function setDiagramZoom(next) {
  diagramZoom = next === 'fit' ? 'fit' : Math.max(DIAGRAM_ZOOM_MIN, Math.min(1, next))
  applyDiagramZoom()
}

diagramZoomEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-zoom]')
  if (!b) return
  if (b.dataset.zoom === 'toggle') return setDiagramZoom(diagramZoom === 'fit' ? 1 : 'fit')
  const step = b.dataset.zoom === 'in' ? 1.25 : 1 / 1.25
  setDiagramZoom(diagramScale() * step)
})

// Ctrl/Cmd + wheel is the zoom gesture every map and drawing tool already uses. A plain
// wheel keeps scrolling the pane, which is what it does at 100%.
diagramScrollEl.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setDiagramZoom(diagramScale() * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
  },
  { passive: false }
)

new ResizeObserver(() => {
  if (diagramZoom === 'fit') applyDiagramZoom()
}).observe(diagramScrollEl)

// ---------- #vi-sysdiag-link: the two-way link between a map card and this picture ----------
// #vi-sysdiag-backedge wrote the card ids onto the diagram for one reason — "why is this box
// here". This is that question answered in both directions: the map's ▦ button marks every
// element a card shaped, and clicking an element lists the cards that shaped it.
let pendingDiagramLocate = null

/** Every node and edge group whose data-cards list names this map card. */
function diagramElementsFor(cardId) {
  return [...diagramSvgInlineEl.querySelectorAll('[data-cards]')].filter((g) =>
    (g.getAttribute('data-cards') || '')
      .split(',')
      .some((c) => c === cardId)
  )
}

function clearDiagramMarks() {
  for (const g of diagramSvgInlineEl.querySelectorAll('.wd-hit,.wd-sel')) g.classList.remove('wd-hit', 'wd-sel')
}

function hideDiagramPicked() {
  diagramPickedEl.hidden = true
  diagramPickedEl.innerHTML = ''
}

/** Called from the ▦ button on a card. The SVG may not be inlined yet on the first switch,
 *  so the id is parked and mountDiagram() replays it once the fetch lands. */
function locateInDiagram(cardId) {
  setView('diagram')
  if (!diagramNatural.w) {
    pendingDiagramLocate = cardId
    return
  }
  clearDiagramMarks()
  const hits = diagramElementsFor(cardId)
  for (const g of hits) g.classList.add('wd-hit')
  const full = node(cardId)
  const title = full ? titleOf(full) : cardId
  if (!hits.length) {
    diagramPickedEl.hidden = false
    diagramPickedEl.innerHTML = `<button type="button" class="close" data-picked-close aria-label="Close">×</button>
      <span class="kind">map card</span><h4>${esc(title)}</h4>
      <p class="empty">No element on the diagram cites #${esc(cardId)} yet.</p>`
    return
  }
  hits[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  diagramPickedEl.hidden = false
  diagramPickedEl.innerHTML = `<button type="button" class="close" data-picked-close aria-label="Close">×</button>
    <span class="kind">map card · ${hits.length} element${hits.length === 1 ? '' : 's'}</span>
    <h4>${esc(title)}</h4>
    <div class="cards">${hits
      .map((g) => {
        const isEdge = g.classList.contains('wd-edge')
        const id = g.getAttribute(isEdge ? 'data-edge' : 'data-node')
        return `<button type="button" data-diagram-el="${esc(id)}"><b>${isEdge ? '→' : '▪'}</b> ${esc(id)}</button>`
      })
      .join('')}</div>`
}

/** The overlay for a clicked element: the map cards that decided it, as links back. */
function showDiagramPicked(g) {
  const isEdge = g.classList.contains('wd-edge')
  const id = g.getAttribute(isEdge ? 'data-edge' : 'data-node')
  const label = isEdge
    ? id.replace('->', ' → ')
    : [...g.querySelectorAll('tspan[font-weight="700"]')].map((t) => t.textContent).join(' ') || id
  const ids = (g.getAttribute('data-cards') || '').split(',').filter(Boolean)
  const rows = ids.map((cid) => {
    const full = node(cid)
    return `<button type="button" data-go-card="${esc(cid)}"><b>#${esc(cid)}</b><br>${esc(full ? titleOf(full) : 'not in the map')}</button>`
  })
  diagramPickedEl.hidden = false
  diagramPickedEl.innerHTML = `<button type="button" class="close" data-picked-close aria-label="Close">×</button>
    <span class="kind">${isEdge ? 'connection' : 'component'}</span>
    <h4>${esc(label)}</h4>
    ${rows.length ? `<div class="cards">${rows.join('')}</div>` : `<p class="empty">No card id on this ${isEdge ? 'connection' : 'component'} yet.</p>`}`
}

diagramSvgInlineEl.addEventListener('click', (e) => {
  const g = e.target.closest('.wd-node,.wd-edge')
  if (!g) {
    clearDiagramMarks()
    hideDiagramPicked()
    return
  }
  clearDiagramMarks()
  g.classList.add('wd-sel')
  showDiagramPicked(g)
})

diagramPickedEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-picked-close]')) {
    clearDiagramMarks()
    hideDiagramPicked()
    return
  }
  const back = e.target.closest('[data-go-card]')
  if (back) {
    go(back.dataset.goCard)
    return
  }
  // A row in the locate list: jump the pane to that element and select it.
  const jumpTo = e.target.closest('[data-diagram-el]')
  if (jumpTo) {
    const id = jumpTo.dataset.diagramEl
    const g =
      diagramSvgInlineEl.querySelector(`[data-node="${CSS.escape(id)}"]`) ??
      diagramSvgInlineEl.querySelector(`[data-edge="${CSS.escape(id)}"]`)
    if (g) g.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }
})

// One button, two things: the column-width overlay baked into the SVG, and the .wgrid
// source below it — both are "how was this drawn", so one toggle covers both instead of a
// separate checkbox that only a person already reading the source would think to flip.
let diagramDebugOn = false
let diagramSourceCache = ''
function applyDiagramDebug() {
  const g = diagramSvgInlineEl.querySelector('#debug-columns')
  if (g) g.style.display = diagramDebugOn ? 'block' : 'none'
  diagramSourceEl.hidden = !diagramDebugOn || !diagramSourceCache
  diagramSourceEl.textContent = diagramSourceCache
  diagramDebugBtn.classList.toggle('active', diagramDebugOn)
}
diagramDebugBtn.addEventListener('click', () => {
  diagramDebugOn = !diagramDebugOn
  applyDiagramDebug()
})

// Mirrors the COLORS map in src/gridsys/render.ts.
const DIAGRAM_LEGEND = [
  ['#5fb0c9', 'browser reading from the server'],
  ['#5c8fd6', "reading today's state"],
  ['#9d7bd8', 'running the agent'],
  ['#d99a4e', 'permission checks'],
  ['#5fbf8f', 'writing a decision'],
  ['#8a93a6', 'talking to an outside tool'],
  ['#d9718a', 'the dev reload loop'],
]
const diagramLegendEl = el('diagram-legend')
function renderDiagramLegend() {
  diagramLegendEl.hidden = false
  diagramLegendEl.innerHTML = DIAGRAM_LEGEND.map(([color, label]) =>
    `<span class="lg-group"><span class="lg-dot" style="background:${color}"></span>${label}</span>`
  ).join('')
}
renderDiagramLegend()

// #vi-board: the ticket board. A cited card opens on the map, the same as a link anywhere.
const boardView = el('board-view')
initBoard({
  root: el('board'),
  drawer: el('ticket-drawer'),
  md,
  knows,
  titleOf: (id) => titleOf(node(id)),
  openCard: go,
  // #vi-board-ticket-decisions-2: what the builds of one ticket gave the map, read from its
  // card obligations (#st-build-card). Undefined while no build of the ticket has started.
  decisionsOf: (ticket) => {
    const os = (G?.obligations ?? []).filter((o) => o.ticket === ticket)
    if (!os.length) return undefined
    const cards = [...new Set(os.flatMap((o) => o.cards))].map((id) => ({ id, proposed: !!node(id)?.proposed }))
    const followed = [...new Set(os.flatMap((o) => o.followed ?? []))]
    return { cards, followed }
  },
})

// #vi-flowtab: telemetry on the map. A card's id or title in it opens the card on the map (#vi-flowtab-click).
const flowView = el('flow-view')
initFlow({
  root: el('flow'),
  graph: () => G,
  rollupBar,
  openCard: go,
  openScope: (id) => navigate(pathFor('flow', id)),
})

// #vi-measure: the pipeline and tool measures. No card scope, so its address has no id.
const measureView = el('measure-view')
initMeasure({ root: el('measure'), graph: () => G, openCard: go })

/** Switches to a view at its own address. The map and Flow keep the card they last had. */
function setView(v) {
  navigate(pathFor(v, v === 'map' ? mapCard : v === 'flow' ? flowScope() : 'root'))
}

let shownView = null

/** The address changed: show its view, and move the map card or the Flow scope to it. */
function applyRoute() {
  const { id } = parseRoute()
  const v = routeView()
  // The first call runs before the tabs are restored. The tab's own position waits for them.
  if (v === 'map' && (shownView || startedOnCard)) mapCard = id
  if (v === 'map' && shownView) {
    const tab = tabs.get(activeName)
    if (tab) {
      tab.at = id
      saveTabsState()
    }
  }
  if (v === 'flow') setFlowScope(id)
  if (v !== shownView) showView(v)
  if (G) render()
}

function showView(v) {
  shownView = v
  localStorage.setItem(projectKey('werk-view'), v)
  viewToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v))
  document.body.classList.toggle('view-graph', v === 'graph')
  document.body.classList.toggle('view-diagram', v === 'diagram')
  document.body.classList.toggle('view-board', v === 'board')
  document.body.classList.toggle('view-flow', v === 'flow')
  document.body.classList.toggle('view-measure', v === 'measure')
  mapView.hidden = v !== 'map'
  graphView.hidden = v !== 'graph'
  diagramView.hidden = v !== 'diagram'
  boardView.hidden = v !== 'board'
  flowView.hidden = v !== 'flow'
  measureView.hidden = v !== 'measure'
  if (v === 'graph') mountGraph3D()
  else unmountGraph3D()
  if (v === 'diagram') mountDiagram()
  if (v === 'board') mountBoard()
  else unmountBoard()
  if (v === 'flow') mountFlow()
  else unmountFlow()
  if (v === 'measure') mountMeasure()
  else unmountMeasure()
}

viewToggle.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]')
  if (b) setView(b.dataset.view)
})

applyRoute()

const typing = () => document.activeElement?.matches('input, textarea')

// #werk-mc-keys: Cmd+1..5 select a tab by position — stable, since #werk-mc-park never
// reshuffles the survivors, only closes the gap a park leaves. Works while typing: a
// modifier combo does not collide with the text itself.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return
  if (e.key >= '1' && e.key <= '5') {
    const target = tabOrder[Number(e.key) - 1]
    if (target) {
      e.preventDefault()
      switchTo(target)
    }
    return
  }
  if (e.key === '[' || e.key === ']') {
    if (tabOrder.length < 2) return
    e.preventDefault()
    const i = tabOrder.indexOf(activeName)
    const step = e.key === ']' ? 1 : -1
    const next = tabOrder[(i + step + tabOrder.length) % tabOrder.length]
    if (next) switchTo(next)
  }
})

document.addEventListener('keydown', (e) => {
  if (typing()) return
  if (e.key === '/') {
    e.preventDefault()
    jump.focus()
  }
  if (e.key === 'Backspace') {
    const p = routeView() === 'map' && parent(mapCard)
    if (p) go(p)
  }
})

// ---------- data ----------
async function load() {
  const data = await (await fetch('/api/graph')).json()
  G = {
    ...data,
    byId: new Map(data.nodes.map((n) => [n.id, n])),
    stale: new Set(data.stale),
    postponed: new Set(data.postponed),
    postponedOrigins: new Set(data.postponedOrigins ?? []),
    reopens: data.reopens ?? {},
    unchallenged: new Set(data.unchallenged),
    proposed: new Set(data.proposed ?? []),
    ghostEdges: data.ghostEdges ?? [],
    removed: data.removed ?? [],
  }
  render()
  if (g3d) g3d.graphData(graphData3D())
  refreshFlow()
  refreshMeasure()
  redrawDrawer()
}

// ---------- the context pie ----------
// Sonnet and Opus report their own window size in modelUsage, so the pie reflects whatever
// the running model actually has, not a guess baked into this file.

function renderContextFill({ used, max }) {
  const fill = max > 0 ? Math.min(1, used / max) : 0
  const color = fill >= 0.66 ? 'var(--stale)' : fill >= 0.33 ? 'var(--open)' : 'var(--proto)'
  contextPie.style.setProperty('--fill', fill)
  contextPie.style.setProperty('--pie-color', color)
  const pct = Math.round(fill * 100)
  contextPie.title = `${pct}% of the context window used`
  contextPopText.textContent = `${pct}% of the context window used — ${used.toLocaleString()} of ${max.toLocaleString()} tokens.`
}

contextPie.addEventListener('click', (e) => {
  e.stopPropagation()
  contextPop.hidden = !contextPop.hidden
})
document.addEventListener('click', (e) => {
  if (!contextPop.hidden && !e.target.closest('#context-fill')) contextPop.hidden = true
  if (!parkedMenu.hidden && !e.target.closest('#tab-parked-menu') && !e.target.closest('#tab-more')) parkedMenu.hidden = true
  if (!addMenu.hidden && !e.target.closest('#tab-add-menu') && !e.target.closest('#tab-add')) addMenu.hidden = true
})

contextClear.addEventListener('click', async () => {
  contextClear.disabled = true
  try {
    const res = await fetch(`/api/context/clear?convo=${encodeURIComponent(activeName)}`, { method: 'POST' })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
    contextPop.hidden = true
    await hydrateTab(activeName)
  } catch (err) {
    alert(`werk could not clear the context: ${err.message}`)
  } finally {
    contextClear.disabled = false
  }
})

// A bad prompt can send the agent off for minutes with no way to cut it short. This kills
// the child now — its own route, since a park no longer kills (#werk-mc-reap). The session
// is on disk, so the very next message to this tab resumes it, no restart needed.
interruptBtn.addEventListener('click', async () => {
  interruptBtn.disabled = true
  try {
    const res = await fetch('/api/convo/interrupt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: activeName }),
    })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
  } catch (err) {
    alert(`werk could not stop the turn: ${err.message}`)
  } finally {
    interruptBtn.disabled = false
  }
})

// ---------- the model selector ----------
// --model is a launch flag. Switching it restarts the child, which is why the selector
// disables itself while a turn is running, and the server refuses the switch if it isn't.

/** {model, advisor} <-> the one option value the <select> shows. */
const setModelSelect = ({ model, advisor }) => {
  modelSelect.value = model === 'claude-sonnet-5-5[1m]' && advisor === 'claude-opus-5-5' ? 'sonnet+advisor' : model
}
const settingFor = (option) =>
  option === 'sonnet+advisor' ? { model: 'claude-sonnet-5-5[1m]', advisor: 'claude-opus-5-5' } : { model: option, advisor: null }

modelSelect.addEventListener('change', async () => {
  const setting = settingFor(modelSelect.value)
  modelSelect.disabled = true
  try {
    const res = await fetch('/api/model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...setting, convo: activeName }),
    })
    const out = await res.json()
    if (!out.ok) throw new Error(out.error)
  } catch (err) {
    alert(`werk could not switch models: ${err.message}`)
    hydrateTab(activeName)
  } finally {
    modelSelect.disabled = chatState.classList.contains('busy')
  }
})

// #werk-mc-follow: navigating the map inside a tab updates only that tab's position.
// Switching away and back restores it — see switchTo, which sets the address the other way.
addEventListener('popstate', () => applyRoute())

const stream = new EventSource('/api/live')
// #werk-write-watch-start: a write before this connect sent no push to this page — the server
// was down, or the page was not connected yet. So every connect, the first included and every
// reconnect after a restart, fetches the whole map. No timer polls the log.
stream.onopen = () => {
  el('live').classList.add('on')
  load()
}
stream.onerror = () => el('live').classList.remove('on')
stream.addEventListener('changed', load)
stream.addEventListener('measure', refreshMeasure)
// #werk-projects-switcher: a project was added or removed, or a turn started or ended in one.
stream.addEventListener('projects', refreshProjects)
// #vi-sysdiag-quiet: the server keeps the diagram in step with the decided cards. The view
// shows that a run is going or that the last one failed, and reloads a new drawing. After an
// update it says whether the redraw was a local edit or a restructure (#vi-sysdiag-declare).
const diagramSyncEl = el('diagram-sync')
function showDiagramSync(s) {
  if (!s) return
  const kind = s.state === 'idle' && s.last?.result === 'updated' ? s.last.kind : undefined
  diagramSyncEl.hidden = s.state === 'idle' && !kind
  diagramSyncEl.classList.toggle('failed', s.state === 'failed')
  diagramSyncEl.classList.toggle('restructure', kind === 'restructure')
  diagramSyncEl.textContent =
    s.state === 'running' ? 'updating…' : s.state === 'failed' ? 'diagram update failed — showing the last good one' : kind === 'restructure' ? `last redraw: restructure — ${s.last.reason}` : 'last redraw: local edit'
  diagramSyncEl.title = s.state === 'failed' ? (s.last?.detail ?? '') : kind ? (s.last.reason ?? '') : ''
  if (s.state === 'idle' && s.last?.result === 'updated' && svgLoaded) {
    svgLoaded = false
    if (!el('diagram-view').hidden) mountDiagram()
  }
}
stream.addEventListener('diagram', (e) => showDiagramSync(JSON.parse(e.data)))
fetch('/api/diagram-sync').then((r) => r.json()).then(showDiagramSync, () => {})
// #vi-board: board.jsonl or a ticket file changed, and new lines from a live build session.
stream.addEventListener('board', refreshBoard)
stream.addEventListener('ticket-log', (e) => onTicketLog(JSON.parse(e.data)))
stream.addEventListener('plan-log', (e) => onPlanLog(JSON.parse(e.data)))
// #vi-board-plan: a subtree with a running plan carries a marker on the map.
async function refreshLivePlans() {
  let next
  try {
    next = new Set(((await (await fetch('/api/board')).json()).plans ?? []).filter((p) => p.live).map((p) => p.run))
  } catch {
    return
  }
  if ([...next].join() === [...livePlans].join()) return
  livePlans = next
  if (G && routeView() === 'map') render()
}
stream.addEventListener('board', refreshLivePlans)
refreshLivePlans()
// A file under web/ changed. The page is running the old code, so reload it. The open card
// is in the hash, each tab's position and the strip are in localStorage, and the
// transcripts are on the server. Only the drafts and half-filled question forms live in
// the page — every tab's, not only the active one's — so they are stashed first. A reload
// that eats a half-typed message is worse than no reload. #werk-mc-reload-storm.
stream.addEventListener('reload', () => {
  const tab = tabs.get(activeName)
  if (tab) tab.draft = chatInput.value
  const drafts = {}
  for (const [name, t] of tabs) if (t.draft) drafts[name] = t.draft
  sessionStorage.setItem('werk-drafts', JSON.stringify(drafts))
  const answers = {}
  for (const [id, byQ] of pendingAnswers) answers[id] = [...byQ].map(([qi, picked]) => [qi, [...picked]])
  sessionStorage.setItem('werk-answers', JSON.stringify(answers))
  location.reload()
})

// Every stream event carries `convo`. main's own events arrive tagged the same as any
// fork's — see manager.onSpawn in server.ts — so there is no special case for `main` here.
stream.addEventListener('chat', (e) => {
  const m = JSON.parse(e.data)
  addChat(ensureTab(m.convo || 'main'), m)
})
stream.addEventListener('delta', (e) => {
  const d = JSON.parse(e.data)
  applyDelta(ensureTab(d.convo || 'main'), d)
})
stream.addEventListener('status', (e) => {
  const s = JSON.parse(e.data)
  const tab = ensureTab(s.convo || 'main')
  const running = turnRunning(s)
  if (running && !tab.wasRunning) tab.startedAt = Date.now()
  // A turn that adds a card mentions it in the same message, and that bubble rendered
  // before the card existed. Repaint the map, and this tab's own transcript, once the turn
  // is over, so the reference becomes a link. Doing it mid-turn would fight the deltas.
  if (tab.wasRunning && !running) {
    load()
    hydrateTab(tab.name)
  }
  tab.wasRunning = running
  tab.status = s
  tab.dead = s.state === 'dead'
  if (tab.name === activeName) paintStatusUI(s)
  if (s.state === 'dead' && tab.name !== activeName) noteDead(tab.name)
  renderTabStrip()
})
stream.addEventListener('asks', (e) => applyOpenAsks(JSON.parse(e.data)))
stream.addEventListener('model', (e) => {
  const d = JSON.parse(e.data)
  const tab = ensureTab(d.convo || 'main')
  tab.model = d
  if (tab.name === activeName) setModelSelect(d)
})
stream.addEventListener('context', (e) => {
  const d = JSON.parse(e.data)
  const tab = ensureTab(d.convo || 'main')
  tab.context = d
  if (tab.name === activeName) renderContextFill(d)
})
// #werk-mc-bgagents: its own event because it can change with the turn otherwise idle —
// nothing else here would repaint the pinned line or the tab dot for that case.
stream.addEventListener('background', (e) => {
  const d = JSON.parse(e.data)
  const tab = ensureTab(d.convo || 'main')
  tab.background = d.tasks ?? []
  if (tab.name === activeName) paintStatusUI(tab.status)
  renderTabStrip()
})

/** Every conversation this browser had open, live or parked, reappears — #werk-mc-park:
 *  nothing is ever closed. New from the server's own list are folded in too, so a fork
 *  made from another browser tab is not invisible here. */
async function hydrateInitialTabs() {
  const saved = loadTabsState()
  tabOrder = saved.order.filter((n, i) => saved.order.indexOf(n) === i)
  parkedOrder = (saved.parked ?? []).filter((n) => !tabOrder.includes(n))
  activeName = tabOrder.includes(saved.active) ? saved.active : tabOrder[0]
  for (const name of [...tabOrder, ...parkedOrder]) ensureTab(name).at = saved.at?.[name] ?? null

  try {
    const { convos } = await (await fetch('/api/convos')).json()
    for (const c of convos) {
      const tab = ensureTab(c.name, c.home)
      // The card of its last turn, for a tab this browser has no saved position for.
      tab.at ??= c.at ?? null
      tab.dead = c.dead
      // #werk-mc-live: a background death found on load surfaces like one seen live, not
      // only as a red dot.
      if (c.dead && c.name !== activeName) noteDead(c.name)
      tab.background = c.background ?? []
      tab.title = c.title ?? ''
      if (!tabOrder.includes(c.name) && !parkedOrder.includes(c.name)) parkedOrder.push(c.name)
    }
  } catch {}
  // A tab this browser never touched sorts as oldest, not as "just now".
  for (const [name, tab] of tabs) tab.lastTouch = saved.touched?.[name] ?? 0

  // The map card is the active tab's position — #werk-mc-follow keeps them in step. A load
  // with no card in its address moves the map to wherever the active tab was instead.
  const active = tabs.get(activeName)
  if (startedOnCard) active.at = mapCard
  else if (active.at) {
    if (routeView() === 'map') navigate(pathFor('map', active.at), { replace: true })
    else {
      mapCard = active.at
      if (G) render()
    }
  }

  for (const [name, tab] of tabs) tab.logEl.hidden = name !== activeName
  // A draft stashed by a reload. Unless something was typed while this loaded.
  if (!chatInput.value) chatInput.value = active.draft
  await Promise.all([...tabOrder].map((name) => hydrateTab(name)))
  for (const [name, tab] of tabs) tab.logEl.hidden = name !== activeName
  renderTabStrip()
  saveTabsState()
}

// The graph first. cardLinks() asks the graph whether an id is a card, so a transcript
// rendered before the graph arrives has no links in it.
load().then(hydrateInitialTabs)
loadAsks()
loadCommands()
