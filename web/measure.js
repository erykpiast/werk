// The Measure tab: how the pipeline and the tool perform. See #vi-measure.
//
// Flow counts map cards. Measure counts what belongs to no card: passes, runs, folds and
// conversations. So it has a time window and no card scope (#vi-measure-scope). It opens with
// one gauge for every metric kill criterion on the map (#vi-measure-kill), then the panel
// groups. A rail on the left lists the panel questions, with a red dot on a panel that has a
// mark outside its band.

import { checksHtml, costHtml, effortHtml, judgeHtml, msClick, msWindowChanged, stageHtml, stopsHtml } from './measure-panels.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const WINDOWS = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'all', label: 'all', days: Infinity },
]

let opts = null // { root, graph, openCard }
let data = null // the last /api/measure
let mounted = false
let win = localStorage.getItem('werk-measure-window') ?? '30d'
let gaugeOpen = null // the criterion card whose gauge detail is open under the row

export function initMeasure(o) {
  opts = o
  opts.root.addEventListener('click', onClick)
}

export async function mountMeasure() {
  mounted = true
  await refreshMeasure()
}

export function unmountMeasure() {
  mounted = false
}

/** Called on every log change, the pipeline log included. A hidden tab does not fetch. */
export async function refreshMeasure() {
  if (!mounted) return
  data = await (await fetch(`/api/measure${win === 'all' ? '?days=all' : ''}`)).json()
  render()
}

const since = () => {
  const d = WINDOWS.find((w) => w.key === win)?.days ?? 30
  return d === Infinity ? -Infinity : Date.now() - d * 864e5
}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
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

// ---------- the kill-criterion gauges (#vi-measure-kill) ----------

/** "> 80%", "< 0.8", "> 100 ms": the direction and the number of a threshold. */
function parseThreshold(s) {
  const m = /([<>])\s*=?\s*([\d.]+)/.exec(s ?? '')
  return m ? { dir: m[1], value: parseFloat(m[2]) } : null
}

const days = (k) => parseInt(k?.window ?? '30', 10) || 30

/**
 * The sources the tool can read, by the card that holds the criterion. A gauge always counts
 * over the criterion's own window, because that window decides whether the criterion fires.
 * Each reader returns the value as a number, its text, the sample size, and a detail drawn
 * under the row on a click.
 */
const READERS = {
  'vi-prop': reviewsReader,
  'rederive-reason': reviewsReader,
  'lp-overseer-psfail': probesReader,
  'pr-log-snapshot': foldReader,
}

/** #vi-prop-metric: of your reviews that cleared a stale mark, the share that changed nothing. */
function reviewsReader(k) {
  const from = Date.now() - days(k) * 864e5
  const all = (data.rederives ?? []).filter((r) => Date.parse(r.at) >= from)
  const rows = all.filter((r) => r.by === 'you')
  const confirmed = rows.filter((r) => !r.changed).length
  const agent = all.filter((r) => r.by === 'agent' && !r.changed).length
  const value = rows.length ? Math.round((confirmed / rows.length) * 100) : 0
  return {
    value,
    text: `${value}%`,
    n: rows.length,
    unit: 'reviews by you',
    detail: () =>
      barDetail(rows.length, [
        [confirmed, 'kg-confirmed', 'confirmed unchanged'],
        [rows.length - confirmed, 'kg-amended', 'amended'],
      ], k, `<span class="kg-agent">${agent} confirmed by the agent, not counted</span>`),
  }
}

/** #lp-overseer-psfail-metric: the share of process probe samples that failed. */
function probesReader(k) {
  const from = Date.now() - days(k) * 864e5
  const rows = (data.probes ?? []).filter((p) => Date.parse(p.at) >= from)
  const samples = rows.reduce((n, p) => n + p.samples, 0)
  const failed = rows.reduce((n, p) => n + p.failed, 0)
  const value = samples ? Math.round((failed / samples) * 1000) / 10 : 0
  return {
    value,
    text: `${value}%`,
    n: samples,
    unit: `probe samples in ${rows.length} sessions`,
    detail: () =>
      barDetail(samples, [
        [failed, 'kg-hit', 'failed'],
        [samples - failed, 'kg-rest', 'read the process table'],
      ], k),
  }
}

/** #vi-flow-ms-fold: the median time of a full fold. Its detail is the fold panel. */
function foldReader(k) {
  const from = Date.now() - days(k) * 864e5
  const rows = (data.folds ?? []).filter((f) => Date.parse(f.at) >= from)
  const mid = median(rows.map((f) => f.ms))
  return { value: mid ?? 0, text: mid == null ? '—' : `${fmtMs(mid)} ms`, n: rows.length, unit: 'folds', goto: 'fold' }
}

const fmtMs = (v) => (v == null ? '—' : v < 10 ? v.toFixed(1) : String(Math.round(v)))

/** A share as one bar: the segments over the whole sample, and the threshold mark on it. */
function barDetail(total, segs, k, extra = '') {
  const t = parseThreshold(k.threshold)
  const w = (n) => (total ? (n / total) * 100 : 0)
  return `<div class="kg-track">
      ${segs.map(([n, cls, label]) => (n ? `<i class="${cls}" style="width:${w(n)}%" title="${esc(`${n} ${label}`)}"></i>` : '')).join('')}
      ${t ? `<span class="kg-mark" style="left:${t.value}%"><span>${t.value}%</span></span>` : ''}
    </div>
    <div class="kg-legend">
      ${segs.map(([n, cls, label]) => `<span><i class="${cls}"></i>${n} ${label}</span>`).join('')}
      ${extra}
    </div>`
}

/** Every metric kill criterion on a map card, in map order. */
function criteria(G) {
  const out = []
  for (const n of G.nodes) {
    if (n.kind !== 'card' || n.proposed || !G.byId.has(n.id)) continue
    for (const k of n.kill ?? []) if (k.form === 'metric') out.push({ card: n, k })
  }
  return out
}

/** red fires, green holds, grey not enough data or not readable. */
function gaugeOf({ card, k }) {
  const read = READERS[card.id]
  if (!read) return { card, k, state: 'unread' }
  const r = read(k)
  const t = parseThreshold(k.threshold)
  const min = k.minSample ?? 0
  const state = r.n < min ? 'thin' : !t ? 'none' : (t.dir === '>' ? r.value > t.value : r.value < t.value) ? 'fires' : 'holds'
  return { card, k, r, state }
}

const STATE_COLOR = { fires: 'stale', holds: 'decided', thin: 'postponed', unread: 'postponed', none: 'postponed' }

function gaugeHtml(g) {
  const { card, k, r, state } = g
  const crit = `revisit <span class="flow-link" data-open="${esc(card.id)}">#${esc(card.id)}</span> ${esc(k.threshold ?? '')}`
  const foot =
    state === 'unread'
      ? `<span class="mg-src">source not read by the tool: ${esc(k.source ?? 'none named')}</span>`
      : state === 'thin'
        ? `<span class="mg-src">${r.n} of ${k.minSample} ${esc(r.unit)} in ${days(k)}d</span>`
        : `<span class="mg-src">${r.n} ${esc(r.unit)} in ${days(k)}d</span>`
  const value = state === 'unread' || state === 'thin' ? (state === 'thin' && r ? r.text : '—') : r.text
  const click = r ? ` data-gauge="${esc(card.id)}"` : ''
  return `<div class="mg mg-${state}${gaugeOpen === card.id ? ' on' : ''}" style="--c:var(--${STATE_COLOR[state]})"${click}${r ? ' role="button" tabindex="0"' : ''}>
      <span class="mg-v">${esc(value)}</span>
      <span class="mg-m">${esc(k.metric ?? '')}</span>
      <span class="mg-c">${crit}</span>
      ${foot}
    </div>`
}

// ---------- the panels ----------

/**
 * The panel groups and their questions. Each panel is drawn by a function of the measures and
 * the window, and returns { html, hot }.
 */
const GROUPS = [
  {
    title: 'Cost',
    panels: [
      { key: 'cost', card: 'vi-flow-ms-cost', q: 'Where did the money go in this window?', draw: () => costHtml(data.measures, since()) },
      { key: 'stage', card: 'vi-flow-ms-stage', q: 'Which stage costs the most, and is it growing?', draw: () => stageHtml(data.measures, win) },
      { key: 'effort', card: 'vi-flow-ms-effort', q: 'Is effort per ticket going up?', draw: () => effortHtml(data.measures, since()) },
    ],
  },
  {
    title: 'Failures',
    panels: [
      { key: 'checks', card: 'vi-flow-ms-checks', q: 'Why do checks fail?', draw: () => checksHtml(data.measures, since()) },
      { key: 'judge', card: 'vi-flow-ms-judge', q: 'Why do the grader and the reviews fail?', draw: () => judgeHtml(data.measures, since()) },
    ],
  },
  {
    title: 'Waits',
    panels: [
      { key: 'stops', card: 'vi-flow-ms-waits', q: 'Where does the pipeline wait for a person?', draw: () => stopsHtml(data.measures, since()) },
      { key: 'chat', card: 'ms-outcome-interv-chat', q: 'How long does an agent’s question wait for the person?', draw: () => chatWaits() },
    ],
  },
  {
    title: 'Tool',
    panels: [
      { key: 'fold', card: 'vi-flow-ms-fold', q: 'Is the fold still fast enough to run on every read?', draw: () => foldPanel() },
      { key: 'tests', card: 'vi-flow-ms-tests', q: 'Which unit tests fail, and how many of those failures are timeouts?', draw: () => testsPanel() },
    ],
  },
]

/**
 * #vi-flow-ms-tests: every recorded run of the unit tests in the window. A strip draws one bar
 * per run (red: a timeout broke a test, amber: another failure, grey: a clean run). The table
 * names each test that failed, how many runs it failed in, and how many of those failures were
 * a time limit. Rows with a timeout come first, since those are the failures that move with the
 * load of the machine, not with the code.
 */
function testsPanel() {
  const runs = (data.tests ?? []).filter((r) => Date.parse(r.at) >= since())
  if (!runs.length) return { html: '<p class="flow-note">No unit test run recorded in this window. A run of the test command records itself.</p>', hot: false }
  const timeoutRuns = runs.filter((r) => r.failed.some((f) => f.timeout))
  const failedRuns = runs.filter((r) => r.failed.length)
  const byTest = new Map()
  for (const r of runs)
    for (const f of r.failed) {
      const key = `${f.file}\u0000${f.name}`
      const row = byTest.get(key) ?? { name: f.name, file: f.file, runs: 0, timeouts: 0, last: '', message: '', ms: [] }
      row.runs++
      if (f.timeout) row.timeouts++
      row.ms.push(f.ms)
      if (r.at >= row.last) (row.last = r.at), (row.message = f.message)
      byTest.set(key, row)
    }
  const rows = [...byTest.values()].sort((a, b) => b.timeouts - a.timeouts || b.runs - a.runs || (a.last < b.last ? 1 : -1))
  const tile = (label, value, color) =>
    `<div class="flow-tile${color ? ' colored' : ''}"${color ? ` style="--c:var(--${color})"` : ''}><span class="v">${value}</span><span class="l">${esc(label)}</span></div>`
  const shown = runs.slice(-60)
  const strip = `<div class="rs-strip" role="img" aria-label="One bar per test run, oldest first">${shown
    .map((r) => {
      const cls = r.failed.some((f) => f.timeout) ? 'rs-timeout' : r.failed.length ? 'rs-fail' : 'rs-ok'
      const names = r.failed.map((f) => `${f.timeout ? '[timeout] ' : ''}${f.name}`).join('\n')
      return `<i class="${cls}" title="${esc(`${r.at.slice(0, 16).replace('T', ' ')} · ${r.tests} tests · ${r.failed.length} failed${names ? `\n${names}` : ''}`)}"></i>`
    })
    .join('')}</div>
    <div class="kg-legend">
      <span><i class="rs-timeout"></i>a run where a time limit broke a test</span>
      <span><i class="rs-fail"></i>another failure</span>
      <span><i class="rs-ok"></i>a clean run</span>
      <span class="kg-sample">last ${shown.length} of ${runs.length} runs in the window</span>
    </div>`
  const pct = (n) => `${Math.round((n / runs.length) * 100)}%`
  const html = `<section class="flow-tiles">
      ${tile('runs', runs.length)}
      ${tile('runs with a timeout', `${timeoutRuns.length} · ${pct(timeoutRuns.length)}`, timeoutRuns.length ? 'stale' : 'decided')}
      ${tile('runs with any failure', `${failedRuns.length} · ${pct(failedRuns.length)}`, failedRuns.length ? 'open' : 'decided')}
      ${tile('tests that failed', rows.length)}
    </section>
    ${strip}
    ${
      rows.length
        ? `<table class="flow-table">
      <thead><tr><th>test</th><th class="num">failed in</th><th class="num">timeouts</th><th>last failure</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
            <td class="flow-name"><div>${esc(r.name)}</div><div class="flow-note">${esc(r.file)}</div></td>
            <td class="num">${r.runs} of ${runs.length}</td>
            <td class="num">${r.timeouts ? `<b>${r.timeouts}</b>` : ''}</td>
            <td><div>${esc(r.last.slice(0, 16).replace('T', ' '))}</div><div class="flow-note">${esc(r.message)}</div></td>
          </tr>`,
        )
        .join('')}</tbody>
    </table>`
        : '<p class="flow-note">No test failed in this window.</p>'
    }
    <p class="flow-note">A failure counts as a timeout when the runner ended the test on its time limit, or its message names a time limit. A run is one run of the unit test command; a build's checks run it in their own worktree and are not counted here.</p>`
  return { html, hot: timeoutRuns.length > 0 }
}

/**
 * #ms-outcome-interv-chat: how long the chat pane's hanging questions waited for the person.
 * Every wait counts, with or without a card. A chat-pane wait raises no alert (#lp-trend-alert),
 * so the panel never puts a dot in the rail.
 */
function chatWaits() {
  const now = Date.now()
  const all = (data.waits ?? []).filter((w) => Date.parse(w.start) >= since())
  if (!all.length) return { html: '<p class="flow-note">No hanging questions in this window.</p>', hot: false }
  const len = (w) => (w.end ? Date.parse(w.end) : now) - Date.parse(w.start)
  const closed = all.filter((w) => w.end)
  const open = all.filter((w) => !w.end)
  const day = (t) => new Date(t).toLocaleDateString('en-CA')
  const byDay = new Map()
  for (const w of all) byDay.set(day(Date.parse(w.start)), (byDay.get(day(Date.parse(w.start))) ?? 0) + len(w))
  const last7 = [...Array(7)].map((_, i) => day(now - (6 - i) * 864e5))
  const byConvo = new Map()
  for (const w of all) byConvo.set(w.convo, [...(byConvo.get(w.convo) ?? []), w])
  const rows = [...byConvo]
    .map(([convo, ws]) => ({ convo, ws, total: ws.reduce((n, w) => n + len(w), 0) }))
    .sort((x, y) => y.total - x.total)
  const tile = (label, value, color) =>
    `<div class="flow-tile${color ? ' colored' : ''}"${color ? ` style="--c:var(--${color})"` : ''}><span class="v">${value}</span><span class="l">${esc(label)}</span></div>`
  const html = `<section class="flow-tiles">
      ${tile('median wait', dur(median(closed.map(len))))}
      ${tile('waited today', dur(byDay.get(day(now)) ?? 0))}
      ${tile('open now', open.length, open.length ? 'open' : undefined)}
      ${tile('oldest open', open.length ? dur(Math.max(...open.map(len))) : '—')}
    </section>
    <p class="flow-note">Per day, last 7: ${last7.map((d) => `${d.slice(5)} <b>${dur(byDay.get(d) ?? 0)}</b>`).join(' · ')}</p>
    <table class="flow-table">
      <thead><tr><th>conversation</th><th class="num">buttons</th><th class="num">questions</th><th class="num">median</th><th class="num">total</th><th class="num">open</th></tr></thead>
      <tbody>${rows
        .map(({ convo, ws, total }) => {
          const o = ws.filter((w) => !w.end)
          return `<tr>
            <td class="flow-name"><div>${esc(convo)}</div></td>
            <td class="num">${ws.filter((w) => w.kind === 'button').length || ''}</td>
            <td class="num">${ws.filter((w) => w.kind === 'question').length || ''}</td>
            <td class="num">${dur(median(ws.filter((w) => w.end).map(len)))}</td>
            <td class="num">${dur(total)}</td>
            <td class="num">${o.length ? dur(Math.max(...o.map(len))) : ''}</td>
          </tr>`
        })
        .join('')}</tbody>
    </table>
    <p class="flow-note">A wait starts at an unclicked next-action button or a structured question, and ends at the click, the answer, or the next message. Open waits count up to now.</p>`
  return { html, hot: false }
}

/** The card whose kill criterion sets the fold panel's threshold. */
const FOLD_CARD = 'pr-log-snapshot'

/**
 * #vi-flow-ms-fold: the time of every full fold in the window, against the log size it
 * replayed. The criterion on #pr-log-snapshot sets the threshold, so the panel draws that line
 * and no learned band (#vi-flow-ms-ref).
 */
function foldPanel() {
  const k = opts.graph()?.byId.get(FOLD_CARD)?.kill?.find((c) => c.form === 'metric')
  const threshold = parseThreshold(k?.threshold)?.value ?? 100
  const rows = (data.folds ?? []).filter((f) => Date.parse(f.at) >= since()).slice(-2000)
  if (!rows.length) return { html: '<p class="flow-note">No fold recorded in this window.</p>', hot: false }
  const mid = median(rows.map((f) => f.ms))
  const hotN = rows.filter((f) => f.ms > threshold).length
  const W = 600, H = 170, L = 40, R = 10, T = 12, B = 22
  const xs = rows.map((f) => f.events)
  let x0 = Math.min(...xs), x1 = Math.max(...xs)
  if (x0 === x1) (x0 -= 1), (x1 += 1)
  // The y axis always reaches the threshold, so the distance to it reads at a glance.
  const y1 = Math.max(threshold * 1.15, ...rows.map((f) => f.ms))
  const px = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R)
  const py = (v) => T + (1 - v / y1) * (H - T - B)
  const dots = rows
    .map((f) => `<circle class="fd-dot${f.ms > threshold ? ' fd-hot' : ''}" cx="${px(f.events).toFixed(1)}" cy="${py(f.ms).toFixed(1)}" r="2.6"><title>${esc(`${f.via || 'unknown read'} · ${f.events} events · ${fmtMs(f.ms)} ms · ${f.at.slice(0, 16).replace('T', ' ')}`)}</title></circle>`)
    .join('')
  // The threshold labels at the right end, the median at the left, so the two never meet.
  const hline = (v, cls, label, left) => `<line class="${cls}" x1="${L}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}"/><text class="fd-lab" x="${left ? L + 4 : W - R}" y="${py(v) - 4}" text-anchor="${left ? 'start' : 'end'}">${label}</text>`
  const svg = `<svg class="fd-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fold time against log size">
      <line class="fd-axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="fd-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <text class="fd-tick" x="${L - 4}" y="${py(0)}" text-anchor="end">0</text>
      <text class="fd-tick" x="${L - 4}" y="${py(y1) + 8}" text-anchor="end">${Math.round(y1)} ms</text>
      <text class="fd-tick" x="${L}" y="${H - 6}">${x0} events</text>
      <text class="fd-tick" x="${W - R}" y="${H - 6}" text-anchor="end">${x1} events</text>
      ${hline(threshold, 'fd-lim', `threshold ${threshold} ms`)}
      ${hline(mid, `fd-mid${mid > threshold ? ' fd-hot' : ''}`, `median ${fmtMs(mid)} ms`, true)}
      ${dots}
    </svg>`
  const foot = `<div class="kg-legend">
      <span><i class="fd-dot"></i>one full fold</span>
      <span><i class="fd-dot fd-hot"></i>above the threshold</span>
      <span><i class="fd-line fd-mid"></i>median</span>
      <span><i class="fd-line fd-lim"></i>threshold, from <span class="flow-link" data-open="${FOLD_CARD}">#${FOLD_CARD}</span></span>
      <span class="kg-sample">${rows.length} folds in the window</span>
    </div>`
  return { html: `<div class="kill-gauge" style="--c:var(--${mid > threshold ? 'stale' : 'decided'})">${svg}${foot}</div>`, hot: hotN > 0 }
}

// ---------- render ----------

function render() {
  const G = opts.graph()
  if (!G || !data) return
  const gauges = criteria(G).map(gaugeOf)
  const fires = gauges.filter((g) => g.state === 'fires').length
  const drawn = GROUPS.map((grp) => ({ ...grp, panels: grp.panels.map((p) => ({ ...p, ...p.draw() })) }))
  const open = gauges.find((g) => g.card.id === gaugeOpen && g.r?.detail)

  const dot = (on) => (on ? '<i class="mr-dot" title="a mark outside its band"></i>' : '')
  const rail = `<nav class="mr" aria-label="Panels">
      <div class="mr-group">Kill criteria</div>
      <button class="mr-q" data-goto="gauges">${dot(fires)}${gauges.length} gauges${fires ? `, ${fires} red` : ''}</button>
      ${drawn
        .map((grp) => `<div class="mr-group">${grp.title}</div>${grp.panels.map((p) => `<button class="mr-q" data-goto="${p.key}">${dot(p.hot)}${esc(p.q)}</button>`).join('')}`)
        .join('')}
    </nav>`
  const main = `<div class="mm">
      <section class="flow-section" id="ms-gauges">
        <h3>Kill criteria — revisit a decision when a gauge turns red</h3>
        ${gauges.length ? `<div class="mg-row">${gauges.map(gaugeHtml).join('')}</div>` : '<p class="flow-note">No metric kill criterion on the map.</p>'}
        ${open ? `<div class="kill-gauge mg-detail" style="--c:var(--${STATE_COLOR[open.state]})">${open.r.detail()}</div>` : ''}
      </section>
      ${drawn
        .map(
          (grp) => `<section class="flow-section">
        <h3>${grp.title}</h3>
        ${grp.panels
          .map(
            (p) => `<section class="ms-panel" id="ms-${p.key}">
            <h4>${esc(p.q)} <span class="flow-link ms-card" data-open="${p.card}">#${p.card}</span></h4>
            ${p.html}
          </section>`,
          )
          .join('')}
      </section>`,
        )
        .join('')}
    </div>`

  opts.root.innerHTML = `
    <p class="ms-lead">How the pipeline and the tool perform. No card scope: these numbers belong to passes, runs and conversations, not to cards.</p>
    <div class="ms-window">
      <span class="flow-seg">${WINDOWS.map((w) => `<button data-win="${w.key}" class="${w.key === win ? 'on' : ''}">${w.label}</button>`).join('')}</span>
      <span class="flow-note">Every panel uses this window. A gauge uses the window of its own criterion.</span>
    </div>
    <div class="ms-layout">${rail}${main}</div>`
}

function onClick(e) {
  const t = e.target.closest('[data-open],[data-win],[data-gauge],[data-goto],[data-drill],[data-series],[data-unit],[data-view]')
  if (!t) return
  if (t.dataset.open) return opts.openCard(t.dataset.open)
  if (msClick(t, e)) return render()
  if (t.dataset.win) {
    if (t.dataset.win === win) return
    const wasAll = win === 'all'
    win = t.dataset.win
    localStorage.setItem('werk-measure-window', win)
    msWindowChanged()
    // Fold times older than 30 days come only with the 'all' window.
    return wasAll || win === 'all' ? refreshMeasure() : render()
  }
  if (t.dataset.goto) return document.getElementById(`ms-${t.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (t.dataset.gauge) {
    const g = criteria(opts.graph()).map(gaugeOf).find((x) => x.card.id === t.dataset.gauge)
    if (g?.r?.goto) return document.getElementById(`ms-${g.r.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    gaugeOpen = gaugeOpen === t.dataset.gauge ? null : t.dataset.gauge
    render()
  }
}
