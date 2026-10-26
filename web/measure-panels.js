// The pipeline measure panels of the Measure tab — #vi-measure. One question per panel, a
// legend, a colour for the outlier, and a drill-down: a mark opens the items behind it, under
// the panel.
//
// The server folds the pipeline log into `measures` (/api/measure). Here are only the bands,
// the outlier colours and the drawing, so a change to the band rule needs no server change.
//
// Every panel takes the tab's time window (#vi-measure-scope) and returns { html, hot }. `hot`
// says a mark in the window is outside its band, and puts the red dot in the rail. A band is
// learned from the measure's whole history (#vi-flow-ms-ref), so a short window does not
// shrink it.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The base window and the alert rise of #lp-trend-alert, which #vi-flow-ms-ref reuses. */
const BASE = 10
const RISE = 0.2

const quantile = (xs, q) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]
}
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const usd = (v) => (v == null ? '—' : v >= 100 ? `$${Math.round(v)}` : v >= 10 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`)
const tok = (v) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)))
const dur = (ms) => {
  if (ms == null) return '—'
  const min = ms / 6e4
  return min >= 60 ? `${(min / 60).toFixed(min >= 600 ? 0 : 1)} h` : min >= 1 ? `${Math.round(min)} min` : `${Math.round(ms / 1000)} s`
}

// ---------- the unit switch (#vi-flow-ms-stage-unit, #vi-flow-ms-effort-unit) ----------

const UNITS = [
  { key: 'usd', label: '$' },
  { key: 'tokens', label: 'tokens' },
  { key: 'time', label: 'time' },
]
/** The unit each switchable panel draws. Dollars until the person picks another. */
const units = Object.fromEntries(['stage', 'effort'].map((p) => [p, localStorage.getItem(`werk-ms-unit-${p}`) ?? 'usd']))

const tokenSum = (t) => (t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0)
/** A mark's value in a unit. A mark is anything with costUsd, tokens and ms. */
const valueIn = (unit, x) => (unit === 'tokens' ? tokenSum(x.tokens) : unit === 'time' ? x.ms ?? 0 : x.costUsd ?? 0)
const fmtIn = (unit, v) => (unit === 'tokens' ? tok(v) : unit === 'time' ? dur(v) : v === 0 ? '$0' : usd(v))
/** The token kinds, for a hover title: a cache read costs about a tenth of a fresh input token. */
const breakdown = (t) => (t ? `input ${tok(t.input)}, output ${tok(t.output)}, cache read ${tok(t.cacheRead)}, cache write ${tok(t.cacheWrite)}` : '')

function unitSwitch(panel) {
  return `<span class="flow-seg ms-unit" role="group" aria-label="Unit">${UNITS.map((u) => `<button data-unit="${panel}|${u.key}" class="${units[panel] === u.key ? 'on' : ''}" aria-pressed="${units[panel] === u.key}">${u.label}</button>`).join('')}</span>`
}

// ---------- the view switch (#vi-flow-ms-stage-view) ----------

const VIEWS = [
  { key: 'lines', label: 'lines' },
  { key: 'share', label: 'share' },
  { key: 'pie', label: 'pie' },
]
/** The view each switchable panel draws. Lines until the person picks another. */
const views = Object.fromEntries([['stage', 'lines'], ['cost', 'role']].map(([p, d]) => [p, localStorage.getItem(`werk-ms-view-${p}`) ?? d]))

function viewSwitch(panel) {
  return `<span class="flow-seg ms-unit" role="group" aria-label="View">${VIEWS.map((v) => `<button data-view="${panel}|${v.key}" class="${views[panel] === v.key ? 'on' : ''}" aria-pressed="${views[panel] === v.key}">${v.label}</button>`).join('')}</span>`
}

/** The open drill-down: which panel, and which mark in it. One at a time, a second click closes it. */
let drill = null

/** The stages hidden from the stage panel (#vi-flow-ms-stage). */
const hidden = new Set()
let stageNames = [] // the stages the panel drew last, so a solo click can hide the rest

/** A new window moves the stage buckets, so an open stage point no longer exists. */
export function msWindowChanged() {
  if (drill?.startsWith('stage|')) drill = null
}

/**
 * A click inside a panel: a mark or a stage legend item. Returns true when it was one, so the
 * caller redraws. On a legend item a plain click hides or shows that stage. A command-click
 * shows only that stage; a second command-click on it shows every stage but it.
 */
export function msClick(t, e) {
  if (t.dataset.unit != null) {
    const [panel, unit] = t.dataset.unit.split('|')
    units[panel] = unit
    localStorage.setItem(`werk-ms-unit-${panel}`, unit)
    return true
  }
  if (t.dataset.view != null) {
    const [panel, view] = t.dataset.view.split('|')
    views[panel] = view
    localStorage.setItem(`werk-ms-view-${panel}`, view)
    drill = null // a mark of one view does not exist in the next
    return true
  }
  if (t.dataset.drill != null) {
    drill = drill === t.dataset.drill ? null : t.dataset.drill
    return true
  }
  const s = t.dataset.series
  if (s == null) return false
  if (e.metaKey || e.ctrlKey) {
    const solo = !hidden.has(s) && stageNames.every((x) => x === s || hidden.has(x))
    hidden.clear()
    if (solo) hidden.add(s)
    else for (const x of stageNames) if (x !== s) hidden.add(x)
  } else if (hidden.has(s)) hidden.delete(s)
  else hidden.add(s)
  return true
}

const drillOf = (panel) => (drill?.startsWith(`${panel}|`) ? drill.slice(panel.length + 1) : null)

/** A card id in free text opens the card; the rest is text. */
const cardLinks = (s) => esc(s).replace(/#([a-z0-9][a-z0-9:-]*)/g, (m, id) => `<span class="flow-link" data-open="${id}">${m}</span>`)

function drillBox(title, rows, head) {
  return `<div class="ms-drill">
      <div class="ms-drill-head"><b>${esc(title)}</b> <span>${rows.length} item${rows.length === 1 ? '' : 's'}</span><button class="ms-close" data-drill="${esc(drill)}" title="close">×</button></div>
      <table class="flow-table"><thead><tr>${head.map((h) => `<th${h.num ? ' class="num"' : ''}>${h.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody></table>
    </div>`
}

/** The panel's own question is its section title. The head says what to do about the data. */
function head(then, chip, unitOf, viewOf) {
  return `<div class="ms-head">
      ${chip ? `<span class="kg-chip">${esc(chip)}</span>` : ''}
      <span class="ms-then"><b>Then:</b> ${then}</span>
      ${viewOf ? viewSwitch(viewOf) : ''}
      ${unitOf ? unitSwitch(unitOf) : ''}
    </div>`
}

// ---------- is effort per ticket going up? (#vi-flow-ms-effort) ----------

/**
 * One dot per finished build in the window, in build order, its effort in dollars, tokens or
 * wall time by the panel's unit switch, adjusted for the ticket's size. Each unit learns its own
 * band and alert from the same builds. The band is the median to the 90th percentile of the first BASE builds ever.
 * The alert compares the median of the last BASE builds with the base median plus RISE. A dot
 * above the band is amber; a dot above twice the band's top is red.
 */
export function effortHtml(m, since) {
  const pts = m?.effort ?? []
  const unit = units.effort
  // Over the ticket's size, so a run of large tickets does not read as a rise.
  const eff = (p) => valueIn(unit, p) / p.size
  const f = (v) => fmtIn(unit, v)
  if (!pts.length) return { html: '<p class="flow-note">No finished build yet.</p>', hot: false }
  const first = pts.findIndex((p) => Date.parse(p.at) >= since)
  const off = first < 0 ? pts.length : first
  const shown = pts.slice(off)
  const base = pts.slice(0, BASE).map(eff)
  const hasBand = pts.length >= BASE
  const lo = hasBand ? median(base) : null
  const hi = hasBand ? quantile(base, 0.9) : null
  const alert = hasBand ? lo * (1 + RISE) : null
  const cur = pts.length > BASE ? median(pts.slice(-BASE).map(eff)) : null
  const level = (v) => (hi == null ? '' : v > 2 * hi ? ' ms-far' : v > hi ? ' ms-above' : '')
  const state = cur == null ? 'thin' : cur >= alert ? 'fires' : 'holds'
  const color = { thin: 'postponed', fires: 'stale', holds: 'decided' }[state]
  const chip = { thin: 'not enough data', fires: 'rising', holds: 'holds' }[state]
  const far = shown.filter((p) => level(eff(p)) === ' ms-far').length
  const hot = state === 'fires' || far > 0
  const then =
    state === 'thin'
      ? `the alert needs ${BASE + 1 - pts.length > 0 ? BASE + 1 - pts.length : 0} more builds before the current window leaves the base.`
      : state === 'fires'
        ? `the median of the last ${BASE} builds, ${f(cur)}, is ${Math.round((cur / lo - 1) * 100)}% above the base. Look at ticket size and spec quality${far ? `, and open the ${far} red builds` : ''}.`
        : `the median of the last ${BASE} builds, ${f(cur)}, is below the alert line${far ? `. Open the ${far} red builds` : ''}.`
  if (!shown.length) return { html: `<div class="kill-gauge" style="--c:var(--${color})">${head(then, chip, 'effort')}<p class="flow-note">No build finished in this window.</p></div>`, hot }

  const W = 640, H = 190, L = 44, R = 12, T = 14, B = 24
  const y1 = Math.max(...shown.map(eff), alert ?? 0) * 1.08
  const n = pts.length
  // x is the build number, so a shorter window shows the same builds at the same numbers.
  const px = (i) => L + (n - 1 === off ? 0.5 : (i - off) / (n - 1 - off)) * (W - L - R)
  const py = (v) => T + (1 - v / y1) * (H - T - B)
  const open = drillOf('effort')
  const dots = shown
    .map((p, j) => {
      const tip = `${p.ticket} · ${f(eff(p))} per story · ${f(valueIn(unit, p))}${unit === 'tokens' ? ` (${breakdown(p.tokens)})` : ''} over ${p.passes} pass${p.passes === 1 ? '' : 'es'} · size ${p.sized ? p.size : '1 (unknown)'} · ${p.at.slice(0, 16).replace('T', ' ')}`
      return `<circle class="ms-dot${level(eff(p))}${open === p.build ? ' ms-on' : ''}" data-drill="effort|${esc(p.build)}" cx="${px(off + j).toFixed(1)}" cy="${py(eff(p)).toFixed(1)}" r="3.4"><title>${esc(tip)}</title></circle>`
    })
    .join('')
  const band = hasBand ? `<rect class="ms-band" x="${L}" width="${W - L - R}" y="${py(hi)}" height="${Math.max(1, py(lo) - py(hi))}"/>` : ''
  const hline = (v, cls, label, x0 = L, anchor = 'end') =>
    `<line class="${cls}" x1="${x0}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}"/><text class="fd-lab" x="${anchor === 'end' ? W - R : x0}" y="${py(v) - 4}" text-anchor="${anchor}">${label}</text>`
  const svg = `<svg class="fd-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Effort per build">
      <line class="fd-axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="fd-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <text class="fd-tick" x="${L - 4}" y="${py(0)}" text-anchor="end">${f(0)}</text>
      <text class="fd-tick" x="${L - 4}" y="${py(y1) + 8}" text-anchor="end">${f(y1)}</text>
      <text class="fd-tick" x="${L}" y="${H - 6}">build ${off + 1}</text>
      ${hasBand && n > BASE && BASE - 0.5 > off ? `<line class="ms-split" x1="${px(BASE - 0.5)}" x2="${px(BASE - 0.5)}" y1="${T}" y2="${H - B}"/><text class="fd-tick" x="${px(BASE - 0.5)}" y="${H - 6}" text-anchor="middle">end of base</text>` : ''}
      <text class="fd-tick" x="${W - R}" y="${H - 6}" text-anchor="end">${n}</text>
      ${band}
      ${alert != null ? hline(alert, 'fd-lim', `alert ${f(alert)}`) : ''}
      ${cur != null ? hline(cur, `fd-mid${state === 'fires' ? ' fd-hot' : ''}`, `last ${BASE}: ${f(cur)}`, px(Math.max(off, n - BASE)), 'start') : ''}
      ${dots}
    </svg>`
  const foot = `<div class="kg-legend">
      <span><i class="fd-dot"></i>one build, effort per story</span>
      <span><i class="fd-dot ms-above"></i>above the band</span>
      <span><i class="fd-dot ms-far"></i>above twice the band</span>
      ${hasBand ? `<span><i class="ms-band-key"></i>band: median–p90 of builds 1–${BASE} (learned, n=${BASE})</span>` : ''}
      ${alert != null ? `<span><i class="fd-line fd-lim"></i>alert: base median +${RISE * 100}%</span>` : ''}
      ${cur != null ? `<span><i class="fd-line fd-mid"></i>median of the last ${BASE}</span>` : ''}
      <span class="kg-sample ${hasBand ? '' : 'short'}">${shown.length} of ${n} builds in the window${hasBand ? '' : ` · band needs ${BASE - n} more`}</span>
    </div>`
  const p = open && pts.find((x) => x.build === open)
  const box = p
    ? drillBox(`Build ${p.build}`, [
        `<tr><td>${esc(p.ticket)}</td><td class="num">${p.passes}</td><td class="num">${usd(p.costUsd)}</td><td class="num" title="${esc(breakdown(p.tokens))}">${tok(tokenSum(p.tokens))}</td><td class="num">${dur(p.ms)}</td><td class="num">${p.sized ? p.size : '1 (unknown)'}</td><td class="num">${f(eff(p))}</td><td class="num">${esc(p.at.slice(0, 16).replace('T', ' '))}</td></tr>`,
      ], [{ label: 'ticket' }, { label: 'passes', num: 1 }, { label: 'cost', num: 1 }, { label: 'tokens', num: 1 }, { label: 'time', num: 1 }, { label: 'stories', num: 1 }, { label: 'per story', num: 1 }, { label: 'finished', num: 1 }])
    : ''
  return { html: `<div class="kill-gauge" style="--c:var(--${color})">${head(then, chip, 'effort')}${svg}${foot}${box}</div>`, hot }
}

// ---------- where did the money go in this window? (#vi-flow-ms-cost) ----------

const COST_BY = [
  { key: 'role', label: 'role' },
  { key: 'chat', label: 'chat' },
  { key: 'ticket', label: 'ticket' },
  { key: 'spec', label: 'spec' },
  { key: 'card', label: 'card' },
]
const COST_GROUPS = [
  { kind: 'chat', title: 'Plan chats', what: 'chat-pane turns, one per message you send' },
  { kind: 'terminal', title: 'Terminal turns on the map', what: 'terminal turns that wrote to the map' },
  { kind: 'pipeline', title: 'Pipeline', what: 'build sessions: builder, held-out binder, reviewers, grader, overseer, writers' },
]
const COST_ROWS = 6

/**
 * The total of the window, then one group for each kind of work. A group's big bar is its share
 * of the largest group; a row's small bar is its share inside its group. The selector sets what
 * a row is. In a unit with many rows the largest few stay and the rest are one row, other.
 */
export function costHtml(m, since) {
  const items = (m?.spend ?? []).filter((x) => Date.parse(x.at) >= since)
  if (!items.length) return { html: '<p class="flow-note">No cost recorded in this window.</p>', hot: false }
  const by = COST_BY.some((b) => b.key === views.cost) ? views.cost : 'role'
  const total = items.reduce((n, x) => n + x.costUsd, 0)
  const pct = (v) => (total ? `${Math.round((v / total) * 100)}%` : '0%')
  const groups = COST_GROUPS.map((g) => {
    const mine = items.filter((x) => x.kind === g.kind)
    const rows = new Map()
    for (const x of mine) {
      const k = x[by] ?? ''
      const r = rows.get(k) ?? { key: k, costUsd: 0, n: 0, ids: new Map() }
      r.costUsd += x.costUsd
      r.n++
      const id = x.ticket ?? x.card ?? x.chat ?? '—'
      r.ids.set(id, (r.ids.get(id) ?? 0) + x.costUsd)
      rows.set(k, r)
    }
    const sorted = [...rows.values()].sort((a, b) => b.costUsd - a.costUsd)
    const head = sorted.slice(0, COST_ROWS)
    const rest = sorted.slice(COST_ROWS)
    if (rest.length) head.push({ key: '\u0000other', costUsd: rest.reduce((n, r) => n + r.costUsd, 0), n: rest.reduce((n, r) => n + r.n, 0), ids: new Map(rest.flatMap((r) => [...r.ids])), other: rest.length })
    return { ...g, costUsd: mine.reduce((n, x) => n + x.costUsd, 0), n: mine.length, rows: head }
  }).filter((g) => g.n)
  const biggest = Math.max(...groups.map((g) => g.costUsd), 1e-9)
  const open = drillOf('cost')
  const label = (r) => (r.other ? `${r.other} other${by === 'role' ? ' roles' : by === 'chat' ? ' chats' : by === 'ticket' ? ' tickets' : by === 'spec' ? ' specs' : ' cards'}` : r.key === '' ? `no ${by}` : by === 'card' ? `#${r.key}` : by === 'chat' ? r.key.slice(0, 8) : r.key)
  const html = groups
    .map((g) => {
      const rows = g.rows
        .map((r) => {
          const key = `${g.kind}|${r.key}`
          return `<button class="ms-cost-row${open === key ? ' ms-on' : ''}" data-drill="cost|${esc(key)}" title="${r.n} session${r.n === 1 ? '' : 's'}"><span class="ms-cost-name">${esc(label(r))}</span><span class="ms-cost-bar"><i style="width:${Math.max(1, (r.costUsd / (g.costUsd || 1)) * 100).toFixed(1)}%"></i></span><b class="ms-num">${usd(r.costUsd)}</b><span class="ms-cost-pct">${pct(r.costUsd)}</span></button>`
        })
        .join('')
      return `<div class="ms-cost-group"><div class="ms-cost-gh"><b>${esc(g.title)}</b><span class="ms-cost-bar big"><i style="width:${((g.costUsd / biggest) * 100).toFixed(1)}%"></i></span><b class="ms-num">${usd(g.costUsd)}</b><span class="ms-cost-pct">${pct(g.costUsd)}</span></div><p class="flow-note">${esc(g.what)} · ${g.n} session${g.n === 1 ? '' : 's'}</p>${rows}</div>`
    })
    .join('')
  const by2 = `<span class="flow-seg ms-unit" role="group" aria-label="Rows">${COST_BY.map((b) => `<button data-view="cost|${b.key}" class="${by === b.key ? 'on' : ''}" aria-pressed="${by === b.key}">${b.label}</button>`).join('')}</span>`
  let box = ''
  if (open) {
    const [kind, key] = open.split('|')
    const g = groups.find((x) => x.kind === kind)
    const r = g?.rows.find((x) => x.key === key)
    if (r) {
      const rows = [...r.ids].sort((a, b) => b[1] - a[1]).map(([id, v]) => `<tr><td>${by === 'card' || kind === 'chat' && by !== 'chat' ? `<span class="flow-link" data-open="${esc(id)}">#${esc(id)}</span>` : esc(id)}</td><td class="num">${usd(v)}</td></tr>`)
      box = drillBox(`${g.title}, ${label(r)}: ${usd(r.costUsd)}`, rows, [{ label: 'chat, card or ticket' }, { label: 'dollars', num: true }])
    }
  }
  return {
    html: `<div class="kill-gauge" style="--c:var(--proto)"><div class="ms-head"><span class="ms-then"><b>Total:</b> <span class="ms-total">${usd(total)}</span> over ${items.length} sessions and turns. Rows are one ${by}. For the change by day, see the stage chart.</span>${by2}</div><div class="ms-cost">${html}</div>${box}</div>`,
    hot: false,
  }
}

// ---------- which stage costs the most, and is it growing? (#vi-flow-ms-stage) ----------

const STAGE_COLORS = ['#58a6ff', '#d29922', '#a371f7', '#ff9e64', '#3fb950', '#f778ba', '#39c5cf', '#8b98a8']

const HOUR = 36e5
/** The width of one point of the stage panel in each window of the tab. */
const PERIODS = [
  { key: '7d', label: 'last 7 days', span: 7 * 24 * HOUR, step: 6 * HOUR, unit: '6 hours' },
  { key: '30d', label: 'last 30 days', span: 30 * 24 * HOUR, step: 24 * HOUR, unit: 'day' },
  { key: 'all', label: 'all', span: Infinity, step: 7 * 24 * HOUR, unit: 'week' },
]

/** The start of the bucket an instant falls in. A week starts on Monday, UTC. */
function bucketOf(t, step) {
  if (step < 7 * 24 * HOUR) return Math.floor(t / step) * step
  const day = Math.floor(t / (24 * HOUR)) * 24 * HOUR
  return day - ((new Date(day).getUTCDay() + 6) % 7) * 24 * HOUR
}

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
/** The cells of one stage over a window, added into one. */
function mergeCells(row) {
  const out = { costUsd: 0, tokens: emptyTokens(), ms: 0, items: [] }
  for (const c of row?.values() ?? []) {
    out.costUsd += c.costUsd
    out.ms += c.ms
    for (const k of Object.keys(out.tokens)) out.tokens[k] += c.tokens[k]
    for (const x of c.items) if (!out.items.includes(x)) out.items.push(x)
  }
  return out
}
const sumTokens = (row) => mergeCells(row).tokens

const bucketLabel = (t, step) => new Date(t).toISOString().slice(step < 24 * HOUR ? 5 : 5, step < 24 * HOUR ? 13 : 10).replace('T', ' ') + (step < 24 * HOUR ? ':00' : '')

/**
 * One line per stage, its dollars, tokens or wall time per bucket, by the panel's unit switch.
 * The tab's window sets the bucket width, so a short window shows the same cost at a finer grain. A stage's band is the median to the 90th
 * percentile of its own earlier buckets, once it has BASE of them; a line whose last bucket is
 * above it is drawn heavier and labelled. The legend on the right has one line per stage: a click
 * hides or shows it, a command-click shows only it, and a second one shows all but it.
 */
export function stageHtml(m, win) {
  const cells = m?.stages ?? []
  if (!cells.length) return { html: '<p class="flow-note">No stage cost recorded yet.</p>', hot: false }
  const per0 = PERIODS.find((p) => p.key === win) ?? PERIODS[2]
  const view = views.stage
  // The share view draws one bar for each day, whatever the window (#vi-flow-ms-stage-view).
  const per = view === 'share' ? { ...per0, step: 24 * HOUR, unit: 'day' } : per0
  const now = Date.now()
  const from = per.span === Infinity ? -Infinity : bucketOf(now - per.span, per.step)
  const unit = units.stage
  const f = (v) => fmtIn(unit, v)
  const byStage = new Map() // stage -> bucket -> { costUsd, tokens, ms, items }
  for (const c of cells) {
    const t = Date.parse(`${c.hour}:00:00Z`)
    if (bucketOf(t, per.step) < from) continue
    const b = bucketOf(t, per.step)
    const row = byStage.get(c.stage) ?? new Map()
    const cur = row.get(b) ?? { costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: 0, items: [] }
    cur.costUsd += c.costUsd
    cur.ms += c.ms ?? 0
    for (const k of Object.keys(cur.tokens)) cur.tokens[k] += c.tokens?.[k] ?? 0
    for (const x of c.items) if (!cur.items.includes(x)) cur.items.push(x)
    row.set(b, cur)
    byStage.set(c.stage, row)
  }
  if (!byStage.size) return { html: '<p class="flow-note">No stage cost in this window.</p>', hot: false }
  const buckets = []
  const first = Math.min(...[...byStage.values()].flatMap((r) => [...r.keys()]))
  for (let t = first; t <= bucketOf(now, per.step); t += per.step) buckets.push(t)
  const total = (s) => [...byStage.get(s).values()].reduce((n, c) => n + valueIn(unit, c), 0)
  // The colours follow the dollar order, so a stage keeps its colour when the unit changes.
  const byDollars = (s) => [...byStage.get(s).values()].reduce((n, c) => n + c.costUsd, 0)
  const stages = [...byStage.keys()].sort((a, b) => byDollars(b) - byDollars(a))
  stageNames = stages
  const all = stages.map((s, i) => {
    const vals = buckets.map((t) => { const c = byStage.get(s).get(t); return c ? valueIn(unit, c) : 0 })
    const earlier = vals.slice(0, -1)
    const hi = earlier.length >= BASE ? quantile(earlier, 0.9) : null
    return { stage: s, color: STAGE_COLORS[i % STAGE_COLORS.length], vals, sum: total(s), hot: hi != null && vals.at(-1) > hi, off: hidden.has(s) }
  })
  const series = all.filter((s) => !s.off)
  const last = buckets.length - 1
  // Each bucket's total over the shown stages: 100% of a bar in the share view.
  const colTotal = buckets.map((_, i) => series.reduce((n, s) => n + s.vals[i], 0))
  for (const s of all) {
    s.shares = s.vals.map((v, i) => (colTotal[i] ? v / colTotal[i] : 0))
    if (view === 'share') {
      const earlier = s.shares.slice(0, -1).filter((_, i) => colTotal[i])
      const hi = earlier.length >= BASE ? quantile(earlier, 0.9) : null
      s.hot = hi != null && colTotal[last] > 0 && s.shares.at(-1) > hi
    } else if (view === 'pie') s.hot = false
  }
  const hot = series.filter((s) => s.hot)
  const grand = series.reduce((n, s) => n + s.sum, 0)
  const top = series.length ? series.reduce((a, b) => (b.sum > a.sum ? b : a)) : null
  const missing = Math.max(0, BASE + 1 - buckets.length)
  const then = !top
    ? 'every stage is hidden. Click a stage on the right to show it.'
    : hot.length
      ? `${esc(hot.map((s) => s.stage).join(', '))} ${view === 'share' ? `take${hot.length === 1 ? 's' : ''} a larger share` : unit === 'time' ? 'took longer' : `cost${hot.length === 1 ? 's' : ''} more`} in the last ${per.unit} than ${hot.length === 1 ? 'its' : 'their'} own band. Open the points.`
      : `${esc(top.stage)} ${unit === 'time' ? 'takes the most time' : unit === 'tokens' ? 'uses the most tokens' : 'costs the most'} in this window, ${f(top.sum)}.${missing ? ` A stage gets a band after ${BASE} earlier points; ${missing} more to go.` : ''}`

  const W = 520, H = 220, L = 44, R = 14, T = 14, B = 24
  const y1 = Math.max(...series.flatMap((s) => s.vals), 0) * 1.08 || 1
  const px = (i) => L + (buckets.length === 1 ? 0.5 : i / (buckets.length - 1)) * (W - L - R)
  const py = (v) => T + (1 - v / y1) * (H - T - B)
  const open = drillOf('stage')
  const dots = buckets.length <= 60
  const lines = series
    .map((s) => {
      const d = s.vals.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('')
      const pts = dots
        ? s.vals
            .map((v, i) => {
              const key = `${s.stage}|${buckets[i]}`
              const kinds = unit === 'tokens' ? ` (${breakdown(byStage.get(s.stage).get(buckets[i])?.tokens)})` : ''
              return `<circle class="ms-pt${open === key ? ' ms-on' : ''}" data-drill="stage|${esc(key)}" cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="${open === key ? 4.5 : 2.6}" style="--sc:${s.color}"><title>${esc(`${s.stage} · ${bucketLabel(buckets[i], per.step)} · ${f(v)}${kinds}`)}</title></circle>`
            })
            .join('')
        : ''
      return `<path class="ms-line${s.hot ? ' ms-hot' : ''}" d="${d}" style="stroke:${s.color}"/>${pts}`
    })
    .join('')
  const bw = ((W - L - R) / Math.max(buckets.length, 1)) * 0.7
  const bx = (i) => L + ((i + 0.5) / buckets.length) * (W - L - R)
  const shareBars = () => {
    const parts = buckets.map((t, i) => {
      if (!colTotal[i]) return ''
      let y = H - B
      return series
        .map((s) => {
          const h = s.shares[i] * (H - T - B)
          y -= h
          if (h <= 0) return ''
          const key = `${s.stage}|${t}`
          const kinds = unit === 'tokens' ? ` (${breakdown(byStage.get(s.stage).get(t)?.tokens)})` : ''
          return `<rect class="ms-seg${open === key ? ' ms-on' : ''}${s.hot && i === last ? ' ms-hot' : ''}" data-drill="stage|${esc(key)}" x="${(bx(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" style="fill:${s.color}"><title>${esc(`${s.stage} · ${bucketLabel(t, per.step)} · ${Math.round(s.shares[i] * 100)}% · ${f(s.vals[i])} of ${f(colTotal[i])}${kinds}`)}</title></rect>`
        })
        .join('')
    })
    return parts.join('')
  }
  const pie = () => {
    const cx = 130, cy = 110, r = 90
    let a = -Math.PI / 2
    const slices = series.filter((s) => s.sum > 0).sort((x, y) => y.sum - x.sum)
    if (slices.length === 1) {
      const s = slices[0]
      return `<circle class="ms-seg" data-drill="stage|${esc(s.stage)}|all" cx="${cx}" cy="${cy}" r="${r}" style="fill:${s.color}"><title>${esc(`${s.stage} · 100% · ${f(s.sum)}`)}</title></circle>`
    }
    return slices
      .map((s) => {
        const frac = s.sum / grand
        const b = a + frac * 2 * Math.PI
        const p = (t, k = r) => `${(cx + k * Math.cos(t)).toFixed(1)},${(cy + k * Math.sin(t)).toFixed(1)}`
        const key = `${s.stage}|all`
        const label = frac >= 0.05 ? `<text class="ms-slice" x="${p((a + b) / 2, r * 0.68).split(',')[0]}" y="${p((a + b) / 2, r * 0.68).split(',')[1]}" text-anchor="middle" dominant-baseline="middle">${Math.round(frac * 100)}%</text>` : ''
        const d = `M${cx},${cy} L${p(a)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(b)} Z`
        a = b
        const kinds = unit === 'tokens' ? ` (${breakdown(sumTokens(byStage.get(s.stage)))})` : ''
        return `<path class="ms-seg${open === key ? ' ms-on' : ''}" data-drill="stage|${esc(key)}" d="${d}" style="fill:${s.color}"><title>${esc(`${s.stage} · ${(frac * 100).toFixed(1)}% · ${f(s.sum)}${kinds}`)}</title></path>${label}`
      })
      .join('')
  }
  const tick = (i, anchor) => `<text class="fd-tick" x="${px(i)}" y="${H - 6}" text-anchor="${anchor}">${bucketLabel(buckets[i], per.step)}</text>`
  const axes = `<line class="fd-axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="fd-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`
  const svg =
    view === 'pie'
      ? `<svg class="fd-plot ms-pie" viewBox="0 0 260 220" role="img" aria-label="Share of ${esc(per0.label)} by stage">${pie()}</svg>`
      : view === 'share'
        ? `<svg class="fd-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of each day by stage">
      ${axes}
      <text class="fd-tick" x="${L - 4}" y="${H - B}" text-anchor="end">0%</text>
      <text class="fd-tick" x="${L - 4}" y="${T + 8}" text-anchor="end">100%</text>
      ${tick(0, 'start')}${buckets.length > 1 ? tick(last, 'end') : ''}
      ${shareBars()}
    </svg>`
        : `<svg class="fd-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost per stage">
      ${axes}
      <text class="fd-tick" x="${L - 4}" y="${py(0)}" text-anchor="end">${f(0)}</text>
      <text class="fd-tick" x="${L - 4}" y="${py(y1) + 8}" text-anchor="end">${f(y1)}</text>
      ${tick(0, 'start')}${buckets.length > 1 ? tick(last, 'end') : ''}
      ${lines}
    </svg>`
  const legend = `<div class="ms-legend" role="group" aria-label="Stages">
      ${all.map((s) => `<button class="ms-key${s.off ? ' off' : ''}" data-series="${esc(s.stage)}" aria-pressed="${!s.off}" title="click: hide or show · ⌘-click: only this one, again: all but this one"><i style="background:${s.color}"></i><span>${esc(s.stage)}</span><b class="ms-num">${f(s.sum)}</b></button>`).join('')}
    </div>`
  const foot =
    view === 'pie'
      ? `<div class="kg-legend"><span>slice = a stage's share of ${esc(per0.label)}</span><span class="kg-sample">${f(grand)} in all</span></div>`
      : `<div class="kg-legend"><span>${view === 'share' ? 'bar' : 'point'} = one ${per.unit}</span><span class="kg-sample ${missing && view !== 'pie' ? 'short' : ''}">${buckets.length} ${view === 'share' ? 'bars' : 'points'}${missing ? ` · band needs ${missing} more` : ''}</span></div>`
  let box = ''
  if (open) {
    const [stage, b] = open.split('|')
    const c = b === 'all' ? mergeCells(byStage.get(stage)) : byStage.get(stage)?.get(Number(b))
    const items = c?.items ?? []
    // A plan item is the card the turn was on; a build item is a ticket.
    const cell = (x) => (stage === 'plan' && !/^[0-9a-f]{8}-/.test(x) ? `<span class="flow-link" data-open="${esc(x)}">#${esc(x)}</span>` : esc(x))
    box = drillBox(`${stage}, ${b === 'all' ? per0.label : bucketLabel(Number(b), per.step)}: ${usd(c?.costUsd ?? 0)} · ${tok(tokenSum(c?.tokens))} tokens · ${dur(c?.ms ?? 0)}`, items.map((x) => `<tr><td>${cell(x)}</td></tr>`), [{ label: stage === 'plan' ? 'card or session' : 'ticket' }])
  }
  return {
    html: `<div class="kill-gauge" style="--c:var(--${hot.length ? 'stale' : 'proto'})">${head(then, hot.length ? 'growing' : '', 'stage', 'stage')}
    <div class="ms-chart">${svg}${legend}</div>${foot}${box}</div>`,
    hot: hot.length > 0,
  }
}

// ---------- why do checks fail? why do the grader and the reviews fail? ----------

const CAUSES = {
  'builder-error': { check: 'code breaks the check', judge: 'diff misses the spec', color: '#c9d1d9' },
  'test-wrong': { check: 'test is wrong', judge: 'test is wrong', color: '#b4a7f5' },
  'spec-gap': { check: 'spec gap', judge: 'spec gap', color: '#79c0ff' },
  'false-finding': { check: 'false finding', judge: 'false finding', color: '#e3b341' },
  'check-infra': { check: 'check infrastructure', judge: 'check infrastructure', color: '#ff9e64' },
  'flaky-check': { check: 'flaky', judge: 'flaky', color: '#f2cc60' },
  conflict: { check: 'conflict', judge: 'conflict', color: '#f778ba' },
  unknown: { check: 'no cause named', judge: 'no cause named', color: '#3a4557', text: '#e6edf3' },
}

/** The judge a fail key belongs to: the grader, or one review area. The same rule as #ms-fail's report. */
const judgeOf = (key) => (key.startsWith('grader') ? 'grader' : key.startsWith('review') ? key.split(' ').slice(0, 2).join(' ') : null)

/**
 * Bars split by cause. `rows` is [{ key, label, causes, note }]. A segment opens the fails
 * behind it. The bars share one scale, so a long bar is a gate that fails often.
 */
function barsHtml(panel, rows, kind, fails, matches) {
  const max = Math.max(...rows.map((r) => r.total), 1)
  const used = new Set(rows.flatMap((r) => Object.keys(r.causes)))
  const order = Object.keys(CAUSES).filter((c) => used.has(c))
  const open = drillOf(panel)
  const bars = rows
    .map((r) => {
      const segs = order
        .filter((c) => r.causes[c])
        .map((c) => {
          const key = `${r.key}|${c}`
          return `<button class="ms-seg${open === key ? ' ms-on' : ''}" data-drill="${panel}|${esc(key)}" style="flex:${r.causes[c]} 0 0;background:${CAUSES[c].color}${CAUSES[c].text ? `;color:${CAUSES[c].text}` : ''}" title="${esc(`${r.label}: ${r.causes[c]} ${CAUSES[c][kind]}`)}">${r.causes[c]}</button>`
        })
        .join('')
      return `<div class="ms-row"><span class="ms-label" title="${esc(r.label)}">${cardLinks(r.label)}</span>
        <span class="ms-track"><span class="ms-bar" style="width:${(r.total / max) * 100}%">${segs}</span></span>
        <span class="ms-note${r.note ? ' on' : ''}">${r.note ?? ''}</span></div>`
    })
    .join('')
  const legend = `<div class="kg-legend">${order.map((c) => `<span><i style="background:${CAUSES[c].color}"></i>${CAUSES[c][kind]}</span>`).join('')}</div>`
  let box = ''
  if (open) {
    const [key, cause] = open.split('|')
    const list = fails.filter((f) => f.cause === cause && matches(f, key))
    const label = rows.find((r) => r.key === key)?.label ?? key
    box = drillBox(
      `${label}: ${CAUSES[cause]?.[kind] ?? cause}`,
      list.map(
        (f) => `<tr><td>${esc(f.ticket)}</td><td class="num">${f.pass === 0 ? 'merge' : f.pass}</td><td>${cardLinks(f.keys.join(', '))}</td><td class="ms-why">${cardLinks(f.why ?? '')}</td></tr>`,
      ),
      [{ label: 'ticket' }, { label: 'pass', num: 1 }, { label: 'what failed' }, { label: 'why' }],
    )
  }
  return `${legend}<div class="ms-bars">${bars}</div>${box}`
}

/** The fails of the passes that ran in the window. */
const failsIn = (m, since) => (m?.fails ?? []).filter((f) => Date.parse(f.at) >= since)

/** One bar per check, split by cause. A check with flaky or infrastructure fails needs its own fix. */
export function checksHtml(m, since) {
  const fails = failsIn(m, since)
  const byKey = new Map()
  for (const f of fails) {
    for (const key of f.keys) {
      if (!key.startsWith('check: ')) continue
      const g = byKey.get(key) ?? { key, total: 0, causes: {} }
      g.total++
      g.causes[f.cause] = (g.causes[f.cause] ?? 0) + 1
      byKey.set(key, g)
    }
  }
  const rows = [...byKey.values()]
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .map((g) => {
      const bad = (g.causes['flaky-check'] ?? 0) + (g.causes['check-infra'] ?? 0)
      return { key: g.key, label: g.key.slice(7), total: g.total, causes: g.causes, bad, note: bad ? `${bad} not the code's fault — fix the check` : null }
    })
  if (!rows.length) return { html: '<p class="flow-note">No check failed in this window.</p>', hot: false }
  const bad = rows.filter((r) => r.bad)
  const then = bad.length
    ? `${bad.map((r) => `${esc(r.label)} has ${r.bad} flaky or infrastructure fail${r.bad === 1 ? '' : 's'}`).join('; ')}: fix the check, not the builder.`
    : 'every check fail is the code or the test. Nothing to fix in the checks.'
  return {
    html: `<div class="kill-gauge" style="--c:var(--${bad.length ? 'open' : 'decided'})">${head(then, bad.length ? 'fix the check' : '')}${barsHtml('checks', rows, 'check', fails, (f, key) => f.keys.includes(key))}</div>`,
    hot: bad.length > 0,
  }
}

/**
 * One bar per judge, the grader and each review area, split by cause. A fail counts once per
 * judge, even when it names several cards, so the false-finding share is per fail as in #ms-fail.
 */
export function judgeHtml(m, since) {
  const share = m?.falseShare ?? 0.2
  const minFails = m?.falseMinFails ?? 5
  const fails = failsIn(m, since)
  const byJudge = new Map()
  for (const f of fails) {
    for (const j of new Set(f.keys.map(judgeOf).filter(Boolean))) {
      const r = byJudge.get(j) ?? { key: j, label: j.replace(/^review /, 'review: '), total: 0, causes: {} }
      r.total++
      r.causes[f.cause] = (r.causes[f.cause] ?? 0) + 1
      byJudge.set(j, r)
    }
  }
  const rows = [...byJudge.values()].sort((a, b) => (a.key === 'grader' ? -1 : b.key === 'grader' ? 1 : b.total - a.total))
  if (!rows.length) return { html: '<p class="flow-note">No grader or review fail in this window.</p>', hot: false }
  for (const r of rows) {
    const ff = r.causes['false-finding'] ?? 0
    r.share = ff / r.total
    r.over = r.total >= minFails && r.share > share
    r.note = r.over ? `false findings ${Math.round(r.share * 100)}% > ${share * 100}%` : r.total < minFails && ff ? `${r.total} of ${minFails} fails needed` : null
  }
  const over = rows.filter((r) => r.over)
  const then = over.length
    ? over.map((r) => `${esc(r.label)} has ${r.causes['false-finding']} false findings out of ${r.total} fails (${Math.round(r.share * 100)}%)`).join('; ') + '. Fix its prompt.'
    : `no judge has more than ${share * 100}% false findings.`
  return {
    html: `<div class="kill-gauge" style="--c:var(--${over.length ? 'open' : 'decided'})">${head(then, over.length ? 'fix the prompt' : '')}${barsHtml('judge', rows, 'judge', fails, (f, key) => f.keys.some((k) => judgeOf(k) === key))}</div>`,
    hot: over.length > 0,
  }
}

// ---------- where does the build stop for a person? (#vi-flow-ms-waits) ----------

const STOP_KINDS = {
  gate: 'gate waits for a person',
  check: 'a failed check holds the ticket',
  stuck: 'ticket held as stuck',
  'cited-changed': 'a cited card changed',
  blocked: 'ticket blocked, no check',
  'loop-stopped': 'merge loop stopped',
  'main-red': 'red on the main line',
  'main-conflict': 'conflict with the main line',
  'retry-cap': 'build reached its retry cap',
  restart: 'a restart ended unfinished work',
}

const MIN = 6e4
const span = (ms) => (ms < MIN ? '<1m' : ms < 60 * MIN ? `${Math.round(ms / MIN)}m` : ms < 48 * 60 * MIN ? `${(ms / 60 / MIN).toFixed(1)}h` : `${(ms / 24 / 60 / MIN).toFixed(1)}d`)
const AXIS = [[1, '1m'], [10, '10m'], [60, '1h'], [360, '6h'], [1440, '1d'], [10080, '1w']]

/**
 * One row per kind of stop, one dot per stop at the length of the wait, on a log axis because a
 * stop lasts minutes or days. The band is the median to the 90th percentile of the row's first
 * BASE stops ever; a dot above it is amber and a dot above 1.5 times its top is red. A stop
 * still open counts up to now and is drawn as a ring. A stop is in the window when any part of
 * it is.
 */
export function stopsHtml(m, since) {
  const now = Date.now()
  const ever = (m?.stops ?? []).map((s) => ({ ...s, ms: Math.max(0, (s.end ? Date.parse(s.end) : now) - Date.parse(s.at)) }))
  const all = ever.filter((s) => (s.end ? Date.parse(s.end) : now) >= since)
  if (!all.length) return { html: `<p class="flow-note">${ever.length ? 'The build did not stop in this window.' : 'The build has not stopped yet.'}</p>`, hot: false }
  const kinds = Object.keys(STOP_KINDS).filter((k) => all.some((s) => s.kind === k))
  const rows = kinds.map((k) => {
    const hist = ever.filter((s) => s.kind === k)
    const list = all.filter((s) => s.kind === k)
    const base = hist.slice(0, BASE).map((s) => s.ms)
    const band = hist.length >= BASE ? [median(base), quantile(base, 0.9)] : null
    const cur = hist.length > BASE ? median(hist.slice(-BASE).map((s) => s.ms)) : null
    return { kind: k, list, hist, band, cur }
  })
  const level = (r, s) => (!r.band ? '' : s.ms > r.band[1] * 1.5 ? ' ms-far' : s.ms > r.band[1] ? ' ms-above' : '')
  const far = rows.flatMap((r) => r.list.filter((s) => level(r, s) === ' ms-far').map((s) => ({ r, s })))
  const longest = rows.reduce((a, r) => (median(r.list.map((s) => s.ms)) > median(a.list.map((s) => s.ms)) ? r : a))
  const openN = all.filter((s) => !s.end).length
  const then = far.length
    ? `open the ${far.length} red stop${far.length === 1 ? '' : 's'}. Check whether the map or a check could have prevented them.`
    : `${esc(STOP_KINDS[longest.kind])} lasts longest, a median of ${span(median(longest.list.map((s) => s.ms)))}. ${openN ? `${openN} stop${openN === 1 ? ' is' : 's are'} still open.` : 'No stop is open.'}`

  const W = 720, L = 270, R = 14, T = 8, RH = 44, B = 26
  const H = T + rows.length * RH + B
  const lo = Math.log(1), hi = Math.log(Math.max(10080, ...all.map((s) => s.ms / MIN)))
  const px = (ms) => L + ((Math.log(Math.max(1, ms / MIN)) - lo) / (hi - lo)) * (W - L - R)
  const open = drillOf('stops')
  const grid = AXIS.filter(([v]) => Math.log(v) <= hi).map(([v, t]) => `<line class="ms-grid" x1="${px(v * MIN)}" x2="${px(v * MIN)}" y1="${T}" y2="${H - B}"/><text class="fd-tick" x="${px(v * MIN)}" y="${H - 8}" text-anchor="middle">${t}</text>`).join('')
  const svg = `<svg class="fd-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Length of each stop, per kind">${grid}${rows
    .map((r, i) => {
      const y = T + i * RH + RH / 2
      const bandEl = r.band ? `<rect class="ms-band" x="${px(r.band[0])}" width="${Math.max(2, px(r.band[1]) - px(r.band[0]))}" y="${y - RH / 2 + 5}" height="${RH - 10}"/>` : ''
      const curEl = r.cur != null ? `<line class="ms-cur" x1="${px(r.cur)}" x2="${px(r.cur)}" y1="${y - RH / 2 + 6}" y2="${y + RH / 2 - 6}"/>` : ''
      const dots = r.list
        .map((s, j) => {
          const jitter = ((j * 37) % 11) / 10 * (RH - 22) - (RH - 22) / 2 // a fixed spread, so a redraw does not move a dot
          const key = `${s.kind}|${s.at}|${s.item}`
          const tip = `${s.item} · ${span(s.ms)}${s.end ? '' : ' so far'} · ${s.at.slice(0, 16).replace('T', ' ')}`
          return `<circle class="ms-dot${level(r, s)}${s.end ? '' : ' ms-open'}${open === key ? ' ms-on' : ''}" data-drill="stops|${esc(key)}" cx="${px(s.ms).toFixed(1)}" cy="${(y + jitter).toFixed(1)}" r="3.6"><title>${esc(tip)}</title></circle>`
        })
        .join('')
      const need = r.band ? '' : `<tspan class="ms-need" x="${L - 12}" dy="13">no band yet: ${BASE - r.hist.length} more needed</tspan>`
      return `<text class="ms-rowlab" x="${L - 12}" y="${y + (r.band ? 4 : -2)}" text-anchor="end">${esc(STOP_KINDS[r.kind])} (n=${r.list.length})${need}</text>${bandEl}${curEl}${dots}`
    })
    .join('')}</svg>`
  const foot = `<div class="kg-legend">
      <span><i class="fd-dot"></i>one stop, within the band</span>
      <span><i class="fd-dot ms-above"></i>above the band</span>
      <span><i class="fd-dot ms-far"></i>more than 1.5× the band top</span>
      <span><i class="ms-ring"></i>still open</span>
      <span><i class="ms-band-key"></i>band: median–p90 of the first ${BASE} stops (learned)</span>
      <span><i class="fd-line fd-mid"></i>median of the last ${BASE}</span>
    </div>`
  let box = ''
  const hit = open && all.find((s) => `${s.kind}|${s.at}|${s.item}` === open)
  if (hit) {
    box = drillBox(`${STOP_KINDS[hit.kind]}: ${hit.item}`, [
      `<tr><td>${cardLinks(hit.item)}</td><td class="num">${esc(hit.at.slice(0, 16).replace('T', ' '))}</td><td class="num">${span(hit.ms)}${hit.end ? '' : ' so far'}</td><td class="ms-why">${cardLinks(hit.reason)}</td></tr>`,
    ], [{ label: 'where' }, { label: 'stopped', num: 1 }, { label: 'length', num: 1 }, { label: 'reason' }])
  }
  const color = far.length ? 'stale' : openN ? 'open' : 'decided'
  return { html: `<div class="kill-gauge" style="--c:var(--${color})">${head(then, far.length ? 'look at these' : openN ? 'open stops' : '')}${svg}${foot}${box}</div>`, hot: far.length > 0 }
}
