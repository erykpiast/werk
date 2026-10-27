// The ticket board: a view beside the map, the graph, and the diagram. See #vi-board,
// #werk-board-columns, #werk-board-control.
//
// The board only reads and asks. Every column change goes through a POST the server checks
// against board.ts's rules, and the page redraws from the `board` push that follows — so a
// refused drag never leaves a card where the server does not have it.

import { cardHref, cardOfHref } from './md.js'

const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']
const MAX_LOG_LINES = 500

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let opts = null // { root, drawer, md, knows, openCard, titleOf }
let data = null // the last /api/board
let byId = new Map()
let selected = null
let selectedPlan = null // the subtree whose plan card is open in the drawer (#vi-board-plan)
let plansByRun = new Map()
let planLogSeq = 0 // the newest plan log fetch; an older answer is dropped
let mounted = false
let drag = null // { id, from }
let logLines = []
let logFor = null // the ticket id whose log is in logLines
let logSrc = null // and the session log file they came from
let logOffset = 0 // the byte of that file the preview holds up to (#vi-board's live preview)
let logPending = null // `ticket-log` pushes that came while the backfill was in flight
let msgTimer = null

export function initBoard(o) {
  opts = o
  opts.root.addEventListener('click', onClick)
  opts.drawer.addEventListener('click', onClick)
  opts.root.addEventListener('dragstart', onDragStart)
  opts.root.addEventListener('dragend', onDragEnd)
  opts.root.addEventListener('dragover', onDragOver)
  opts.root.addEventListener('dragleave', onDragLeave)
  opts.root.addEventListener('drop', onDrop)
  document.addEventListener('keydown', (e) => {
    if (mounted && e.key === 'Escape' && (selected || selectedPlan) && !document.activeElement?.matches('input, textarea')) select(null)
  })
}

export function mountBoard() {
  mounted = true
  return refreshBoard()
}

export function unmountBoard() {
  mounted = false
}

/** The `board` push: board.jsonl or a ticket file changed. */
export async function refreshBoard() {
  if (!mounted) return
  try {
    data = await (await fetch('/api/board')).json()
  } catch {
    return
  }
  byId = new Map(data.tickets.map((t) => [t.id, t]))
  plansByRun = new Map((data.plans ?? []).map((p) => [p.run, p]))
  if (selected && !byId.has(selected)) selected = null
  if (selectedPlan && !plansByRun.has(selectedPlan)) selectedPlan = null
  renderBoard()
  renderDrawer()
}

/** The decision log changed: the open ticket's Decisions section reads it. */
export function redrawDrawer() {
  if (mounted) renderDrawer()
}

/** Open the plan card of a subtree, from the map's marker (#vi-board-plan). The board may not
 *  be mounted yet: the selection waits for its first draw. */
export function openPlan(run) {
  selected = null
  selectedPlan = run
  if (mounted && data) {
    renderBoard()
    renderDrawer()
  }
}

/** The `plan-log` push: a live plan's log grew. The open plan drawer reads it again. */
export function onPlanLog({ run }) {
  if (mounted && selectedPlan === run) loadPlanLog(run)
}

/**
 * The `ticket-log` push: new lines from a building ticket's live session, each with the byte
 * offset it ends at. A line at or below what the preview holds is a double and is dropped. A
 * batch that starts past it is a gap, and a truncated file starts over: both fetch the log
 * again. A push that comes while that fetch is in flight waits for it.
 */
export function onTicketLog(msg) {
  const { id } = msg
  if (!mounted || id !== selected || logFor !== id) return
  if (logPending) {
    logPending.push(msg)
    return
  }
  const take = takeLogPush(logOffset, msg)
  if (take.reload) {
    loadLog(id, logSrc)
    return
  }
  if (!take.lines.length) return
  logOffset = take.offset
  const lines = take.lines
  logLines.push(...lines)
  if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(-MAX_LOG_LINES)
  const box = opts.drawer.querySelector('.td-log')
  if (!box) return
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  box.querySelector('.tl.dim')?.remove()
  box.insertAdjacentHTML('beforeend', lines.map(logLineHTML).join(''))
  while (box.childElementCount > MAX_LOG_LINES) box.firstElementChild.remove()
  if (atBottom) box.scrollTop = box.scrollHeight
}

/**
 * What a `ticket-log` push adds to a preview that holds its log up to byte `offset`. Pure.
 * `{ reload: true }` for a gap (the batch starts past `offset`) or a truncated file; else the
 * lines past `offset`, in order, and the new offset.
 * @param {number} offset
 * @param {{ from?: number, reset?: boolean, lines?: Array<{ text: string, end: number, at?: string }> }} push
 * @returns {{ reload: boolean, lines: Array<{ text: string, at?: string }>, offset: number }}
 */
export function takeLogPush(offset, { from = 0, reset = false, lines = [] }) {
  if (reset || from > offset) return { reload: true, lines: [], offset }
  const fresh = lines.filter((l) => l.end > offset)
  return { reload: false, lines: fresh.map(({ text, at }) => (at ? { text, at } : { text })), offset: fresh.length ? fresh[fresh.length - 1].end : offset }
}

/** "4s", "12m 04s", "3h 07m": how long since an ISO time. Pure. */
export function elapsed(since, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  const pad = (n) => String(n).padStart(2, '0')
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h`
}

/** Every counter in the drawer counts up once a second, with no redraw. Not in a test. */
if (typeof document !== 'undefined') {
  setInterval(() => {
    if (!mounted || !opts) return
    for (const x of opts.drawer.querySelectorAll('[data-since]')) x.textContent = elapsed(x.dataset.since)
  }, 1000)
  // #vi-board-redraw-signal: a builder that died writes nothing to the board log, so no push
  // comes for it. A slow read makes its dot stop.
  setInterval(() => {
    if (mounted) refreshBoard()
  }, 5000)
}

// ---------- the columns ----------

/** The held-out badges of a done ticket (#werk-board-columns): red for a step that ran and
 *  failed, grey for a step the binder could not run (#st-heldout-notrun). Both can show. */
export function heldoutBadges(t) {
  if (t.column !== 'done') return ''
  const notRun = t.heldOutNotRun ?? []
  return [
    t.heldOutRed
      ? `<button type="button" class="tb tb-heldout" ${t.followUp ? `data-ticket="${esc(t.followUp)}"` : ''} title="The held-out set went red after this merge${t.followUp ? ` — follow-up ${esc(t.followUp)}` : ''}">held-out</button>`
      : '',
    notRun.length
      ? `<span class="tb tb-notrun" title="${notRun.length} held-out step${notRun.length === 1 ? '' : 's'} not run after this merge: the binder could not run ${notRun.length === 1 ? 'it' : 'them'}. Not red, and not green: G2 waits.">not run</span>`
      : '',
  ].join('')
}

function cardHTML(t) {
  // #vi-board: the badge is for a ticket that retried more than once. The first pass is not a
  // retry, so it shows from the third pass on, and counts retries, not passes.
  const retries = Math.max(0, t.passes - 1)
  const badges = [
    retries > 1 ? `<span class="tb tb-retry" title="${retries} retr${retries === 1 ? 'y' : 'ies'}">↻${retries}</span>` : '',
    t.openBlockers.length
      ? `<span class="tb tb-block" title="blocked by ${esc(t.openBlockers.join(', '))}">⊘${t.openBlockers.length}</span>`
      : '',
    heldoutBadges(t),
    // #vi-board-plan: every ticket links to the card of the plan that created it.
    plansByRun.has(t.run) ? `<button type="button" class="tb tb-plan" data-plan="${esc(t.run)}" title="Planned from #${esc(t.run)} — open the plan">◆</button>` : '',
  ].join('')
  const trigger =
    t.column === 'ready'
      ? `<button type="button" class="tc-trigger" data-trigger="${esc(t.id)}" ${t.canTrigger ? '' : 'disabled'} title="${t.canTrigger ? 'Build this ticket' : `Cannot build yet: blocked by ${esc(t.openBlockers.join(', '))}`}" aria-label="Build this ticket">▶</button>`
      : ''
  const draggable = t.column === 'ready'
  return `<div class="tcard${t.id === selected ? ' sel' : ''}${t.live ? ' tlive' : ''}" data-ticket="${esc(t.id)}" ${draggable ? 'draggable="true"' : ''}>
    ${t.live ? '<span class="pulse" title="A build session is running"></span>' : ''}
    <span class="tc-title" title="${esc(t.title)}">${esc(t.title)}</span>${badges}${trigger}
  </div>`
}

function renderBoard() {
  const cols = COLUMNS.map((c) => {
    const ids = data.columns[c] ?? []
    return `<section class="bcol" data-col="${c}">
      <h3>${c}<span class="bcount">${ids.length}</span></h3>
      <div class="bcards" data-col="${c}">${ids.map((id) => cardHTML(byId.get(id))).join('')}</div>
    </section>`
  })
  opts.root.innerHTML = `<div class="board-msg" id="board-msg" hidden></div>${runsHTML()}<div class="bcols">${cols.join('')}</div>${plansHTML()}`
  const focused = !!(selected || selectedPlan)
  opts.root.classList.toggle('focused', focused)
  if (focused) fitColumns()
}

/** With a card open in the drawer, each column shows at most two cards and scrolls the rest,
 *  so the drawer sits close under the board. */
function fitColumns() {
  for (const list of opts.root.querySelectorAll('.bcards')) {
    const cards = list.querySelectorAll('.tcard')
    if (cards.length <= 2) continue
    list.style.maxHeight = `${Math.ceil(cards[1].getBoundingClientRect().bottom - list.getBoundingClientRect().top) + 2}px`
  }
}

export const PLAN_STATE_LABEL = { creating: 'creating', building: 'building', done: 'done', stopped: 'stopped' }
const STEP_LABEL = { spec: 'spec writer', tickets: 'ticket writer', checks: 'checks' }
const RESULT_LABEL = { blocked: 'open cards in the scope', 'agent-error': 'agent error', 'spec-invalid': 'invalid spec', error: 'plan failed' }

/** The line under a plan card's title. Pure. */
export function planLine(p, tickets) {
  if (p.state === 'creating') return p.step ? `${STEP_LABEL[p.step] ?? p.step} running` : 'starting'
  if (p.state === 'stopped') return `${RESULT_LABEL[p.result] ?? p.result}${p.failedStep ? ` in ${STEP_LABEL[p.failedStep] ?? p.failedStep}` : ''}`
  const live = tickets.filter((t) => t && !t.archived)
  const done = live.filter((t) => t.column === 'done').length
  return `${done} of ${live.length} ticket${live.length === 1 ? '' : 's'} done`
}

/**
 * #vi-board-plan-controls: Resume and Restart… for a subtree with unfinished work and no run
 * in progress on it. A run in progress on an ancestor disables both and names that run. `small`
 * is the plan card's icon form; the drawer has the labelled form. Pure.
 */
export function planControlsHTML(p, small = false) {
  if (p.inProgress || !p.unfinished) return ''
  const blocked = p.blockedBy ? `Blocked by the run on #${p.blockedBy}` : ''
  const off = blocked ? ` disabled title="${esc(blocked)}"` : ''
  const resumeTitle = blocked || `Resume: start the merge loop again over the ${p.unfinished} unfinished ticket${p.unfinished === 1 ? '' : 's'}`
  const restartTitle = blocked || 'Restart: end the unfinished work, then plan and run again. Asks first.'
  if (small) {
    return `<button type="button" class="pc-resume" data-resume-subtree="${esc(p.run)}"${off} title="${esc(resumeTitle)}" aria-label="Resume">▶</button><button type="button" class="pc-restart" data-restart-subtree="${esc(p.run)}"${off} title="${esc(restartTitle)}" aria-label="Restart…">↻</button>`
  }
  return `<p><button type="button" class="td-btn" data-resume-subtree="${esc(p.run)}"${off} title="${esc(resumeTitle)}">Resume</button> <button type="button" class="td-btn td-btn-small" data-restart-subtree="${esc(p.run)}"${off} title="${esc(restartTitle)}">Restart…</button></p>${
    blocked ? `<p class="dim">${esc(blocked)} — <button type="button" class="td-tref" data-plan="${esc(p.blockedBy)}">open its plan</button></p>` : ''
  }`
}

/** Resume a subtree's unfinished work (#werk-board-restart). The map card and the plan card
 *  both call it. Resolves to the error text, or null. */
export async function resumeSubtree(id) {
  const r = await fetch('/api/subtree/resume', { method: 'POST', body: JSON.stringify({ id }) })
  const out = await r.json()
  return r.ok ? null : (out.error ?? 'resume failed')
}

/** Restart a subtree: the one confirmation the map card and the plan card share. It lists what
 *  the restart ends, from the server. Resolves to the error text, or null (also on cancel). */
export async function restartSubtree(id) {
  const view = await (await fetch(`/api/subtree/build?id=${encodeURIComponent(id)}`)).json()
  if (!confirm(`${(view.restart ?? []).join('\n')}\n\nRestart #${id}?`)) return null
  const r = await fetch('/api/subtree/restart', { method: 'POST', body: JSON.stringify({ id, confirm: true }) })
  const out = await r.json()
  return r.ok ? null : (out.error ?? 'restart failed')
}

/** #vi-board-plan: one card per planned subtree, in a row below the columns. */
function plansHTML() {
  const plans = data.plans ?? []
  if (!plans.length) return ''
  const cards = plans.map((p) => {
    const title = opts.knows(p.run) ? opts.titleOf(p.run) : p.run
    return `<div class="pcard pstate-${esc(p.state)}${p.run === selectedPlan ? ' sel' : ''}" data-plan="${esc(p.run)}">
      <div class="pc-head">${p.live ? '<span class="pulse" title="The plan agents are running"></span>' : ''}<span class="pc-title" title="${esc(title)}">${esc(title)}</span><span class="pc-state">${PLAN_STATE_LABEL[p.state] ?? esc(p.state)}</span>${
        p.building ? `<button type="button" class="pc-stop" data-stop-build="${esc(p.run)}" title="Stop the build of this subtree">■</button>` : planControlsHTML(p, true)
      }</div>
      <div class="pc-meta">${opts.knows(p.run) ? `<a class="ref" href="${esc(cardHref(p.run))}">#${esc(p.run)}</a>` : `#${esc(p.run)}`} · ${esc(planLine(p, p.tickets.map((id) => byId.get(id))))}</div>
    </div>`
  })
  return `<section class="plan-row"><h3>plans</h3><div class="pcards">${cards.join('')}</div></section>`
}

/** One line per plan run that has reached a gate: G2 waits for a person, or has passed.
 *  The board shows the gate; passing it is `werk gate <run> approve --actor you`. A run whose
 *  current scope has a card no ticket cites gets a line too (#st-ticket-watch). */
function runsHTML() {
  const rows = Object.entries(data.runs ?? {})
    .map(([run, r]) => {
      const cited = r.cited && !r.cited.ok
        ? `<div class="run-row"><span class="run-name">${esc(run)}</span><span class="gate-state waiting">cards-cited fails</span> <span class="dim">${esc(r.cited.detail)} · plan the subtree again</span></div>`
        : ''
      const g2 = r.gates?.G2
      if (!g2?.waiting && !g2?.passed) return cited
      const passed = g2.passed && g2.passed === g2.waiting
      const state = passed
        ? `<span class="gate-state passed">G2 passed</span> <span class="dim">for ${esc(g2.passed.slice(0, 8))}</span>`
        : `<span class="gate-state waiting">G2 waits for you</span> <span class="dim">${esc(g2.reason ?? '')}${g2.waiting ? ` · tree ${esc(g2.waiting.slice(0, 8))}` : ''}</span>
           <code title="Pass the gate from a terminal">werk gate ${esc(run)} approve --actor you</code>`
      return `<div class="run-row"><span class="run-name">${esc(run)}</span>${r.tier ? `<span class="dim">${esc(r.tier)}</span>` : ''}${state}</div>${cited}`
    })
    .filter(Boolean)
  return rows.length ? `<div class="run-strip">${rows.join('')}</div>` : ''
}

function say(text) {
  const box = opts.root.querySelector('#board-msg')
  if (!box) return
  box.textContent = text
  box.hidden = false
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (box.hidden = true), 6000)
}

async function act(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', body: JSON.stringify(body) })
    const out = await r.json()
    if (!r.ok) say(out.error ?? `${path} failed`)
  } catch (err) {
    say(err.message)
  }
  await refreshBoard()
}

// ---------- the drawer ----------

function selectPlan(run) {
  selected = null
  selectedPlan = run
  renderBoard()
  renderDrawer()
  if (run) opts.drawer.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function select(id) {
  selected = id
  selectedPlan = null
  if (id !== logFor) {
    logFor = null
    logLines = []
    logOffset = 0
    logPending = null
  }
  renderBoard()
  renderDrawer()
  if (id) opts.drawer.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

/** md.js has no task lists. An acceptance criterion's box becomes a glyph, not "[ ]". */
const checkboxes = (body) => body.replace(/^(\s*[-*]\s+)\[ \]\s+/gm, '$1☐ ').replace(/^(\s*[-*]\s+)\[[xX]\]\s+/gm, '$1☑ ')

const clock = (at) => {
  const d = at ? new Date(at) : null
  return d && !isNaN(d) ? d.toLocaleTimeString([], { hour12: false }) : ''
}

/** A line is `{ text, at }`; `at` is missing on a line the session wrote with no time. */
function logLineHTML(l) {
  const { text, at } = typeof l === 'string' ? { text: l } : l
  return `<div class="tl"><span class="tl-at" title="${esc(at ?? '')}">${clock(at)}</span><span>${esc(text)}</span></div>`
}

const sinceHTML = (at) => `<span class="td-since" data-since="${esc(at)}" title="${esc(at)}">${elapsed(at)}</span>`

function logBarHTML(t) {
  return `<div class="td-logbar">${
    t.live
      ? `<span class="pulse"></span><span class="live">agent running</span>${t.liveSince ? ` · session ${sinceHTML(t.liveSince)}` : ''}`
      : `<span>agent not running</span>${t.lastEnd ? ` · last session ${esc(t.lastEnd)}` : ''}`
  }${t.since ? `<span class="dim">in building ${sinceHTML(t.since)}</span>` : ''}</div>`
}

/** The preview is a window onto a running session, so it is fetched when a building ticket
 *  opens and dropped when the ticket leaves building. */
async function loadLog(id, src) {
  logFor = id
  logSrc = src
  logLines = []
  logOffset = 0
  const queued = (logPending = [])
  try {
    const out = await (await fetch(`/api/ticket/log?id=${encodeURIComponent(id)}`)).json()
    if (logPending !== queued) return // a newer load, or the drawer moved on
    if (selected !== id) {
      logPending = null
      return
    }
    logLines = out.lines ?? []
    logOffset = out.offset ?? 0
  } catch {}
  if (logPending !== queued) return
  logPending = null
  const box = opts.drawer.querySelector('.td-log')
  if (box) {
    box.innerHTML = logLines.map(logLineHTML).join('') || '<div class="tl dim">waiting for the session to write…</div>'
    box.scrollTop = box.scrollHeight
  }
  for (const msg of queued) onTicketLog(msg)
}

const ticketRef = (id) => {
  const t = byId.get(id)
  const done = t?.column === 'done'
  return `<li><button type="button" class="td-tref${done ? ' done' : ''}" data-ticket="${esc(id)}">${esc(id)}</button>${t ? ` <span class="dim">${esc(t.title)} · ${t.column}</span>` : ' <span class="dim">not on the board</span>'}</li>`
}

function sideSection(title, html) {
  return html ? `<div class="td-sec"><h4>${title}</h4>${html}</div>` : ''
}

/** The plan's two agent logs, spec writer first, each part under its step's name. */
async function loadPlanLog(run) {
  const seq = ++planLogSeq
  let lines = []
  let spec = null // null: the server sent no spec, so the drawer claims nothing about it
  try {
    const out = await (await fetch(`/api/plan/log?run=${encodeURIComponent(run)}`)).json()
    lines = out.lines ?? []
    spec = out.spec ?? null
  } catch {}
  if (seq !== planLogSeq || selectedPlan !== run) return
  // The whole spec sits under the log; it changes only when a step ends, so it is redrawn
  // only when its text did.
  const specBox = opts.drawer.querySelector('.td-spec')
  if (specBox && spec !== null && specBox.dataset.text !== spec) {
    specBox.dataset.text = spec
    specBox.innerHTML = spec ? opts.md(checkboxes(spec), opts.knows) : '<p class="dim">The spec writer has not written a spec yet.</p>'
  }
  const box = opts.drawer.querySelector('.td-log')
  if (!box) return
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  let step = null
  const html = []
  for (const l of lines) {
    if (l.step !== step) html.push(`<div class="tl step">${esc(STEP_LABEL[l.step] ?? l.step)}</div>`)
    step = l.step
    html.push(logLineHTML(l))
  }
  box.innerHTML = html.join('') || `<div class="tl dim">${plansByRun.get(run)?.live ? 'waiting for the agent to write…' : 'no agent log for this plan'}</div>`
  if (atBottom || box.dataset.fresh) box.scrollTop = box.scrollHeight
  delete box.dataset.fresh
}

// The drawer's layout choices outlive a redraw and a page load.
const store = globalThis.localStorage
let sideOff = store?.getItem('werk-drawer-side') === 'off'
let logBig = store?.getItem('werk-drawer-log') === 'big'

/** A big log hides the sidebar and doubles its height. Classes on the drawer itself, so a
 *  redraw of its content keeps them. */
function applyDrawerMode(hasLog = !!opts.drawer.querySelector('.td-log')) {
  const big = logBig && hasLog
  opts.drawer.classList.toggle('side-off', sideOff || big)
  opts.drawer.classList.toggle('log-big', big)
}

function setDrawerMode(next) {
  if (next.sideOff !== undefined) sideOff = next.sideOff
  if (next.logBig !== undefined) logBig = next.logBig
  store?.setItem('werk-drawer-side', sideOff ? 'off' : 'on')
  store?.setItem('werk-drawer-log', logBig ? 'big' : 'normal')
  applyDrawerMode()
}

/** The first line holds the id, the running dot and the controls; the title is under it. */
function headHTML({ id, live, title, badge, extra = '' }) {
  return `<div class="td-head">
      <div class="td-headrow">
        <span class="td-id">${esc(id)}</span>${live ? '<span class="pulse" title="An agent is running"></span>' : ''}
        <span class="td-headfill"></span>${badge}${extra}
        <button type="button" class="td-close" data-close title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <h2>${esc(title)}</h2>
    </div>`
}

function logBoxHTML(attrs, inner) {
  return `<div class="td-logwrap"><div class="td-log" ${attrs} aria-live="polite">${inner}</div><button type="button" class="td-logbig" data-log-big title="Make the log bigger, or back" aria-label="Make the log bigger, or back"></button></div>`
}

function sideHTML(side) {
  return `<aside class="td-side"><button type="button" class="td-sidetoggle" data-side-toggle title="Show or hide the sidebar" aria-label="Show or hide the sidebar"></button><div class="td-sidebody">${side}</div></aside>`
}

function renderPlanDrawer(p) {
  const drawer = opts.drawer
  drawer.hidden = false
  const title = opts.knows(p.run) ? opts.titleOf(p.run) : p.run
  const tickets = p.tickets.map((id) => byId.get(id)).filter(Boolean)
  const subtree = opts.knows(p.run) ? `<a class="ref" href="${esc(cardHref(p.run))}" title="${esc(title)}">#${esc(p.run)}</a>` : `<span class="dim">#${esc(p.run)} — not on the map</span>`
  const ended = p.endedAt
    ? `${p.result === 'ok' ? 'ended ok' : `stopped: ${esc(RESULT_LABEL[p.result] ?? p.result)}${p.failedStep ? ` in ${esc(STEP_LABEL[p.failedStep] ?? p.failedStep)}` : ''}`} · ${clock(p.endedAt)}`
    : ''
  const side = [
    sideSection('Subtree', `<p>${subtree}</p>`),
    sideSection('State', `<p>${esc(planLine(p, tickets))}</p>`),
    // #werk-board-build-subtree: a build the map's Build button started stops here.
    sideSection('Build', p.building ? `<p><button type="button" class="td-btn" data-stop-build="${esc(p.run)}">■ stop the build</button></p>` : planControlsHTML(p)),
    sideSection('Last plan', p.startedAt ? `<p>started ${clock(p.startedAt)}${p.live ? ` · ${sinceHTML(p.startedAt)}` : ''}${ended ? `<br>${ended}` : ''}</p>` : '<p class="dim">no plan was recorded; the tickets came from an earlier plan</p>'),
    sideSection('Reason', p.detail ? `<pre class="td-pre">${esc(p.detail)}</pre>` : ''),
    sideSection('Planned', p.planned.length ? `<p>${p.planned.length} ticket${p.planned.length === 1 ? '' : 's'} new or rewritten${p.archived.length ? `, ${p.archived.length} archived` : ''}</p>` : ''),
    sideSection('Tickets', p.tickets.length ? `<ul>${p.tickets.map(ticketRef).join('')}</ul>` : ''),
  ].join('')
  const bar = `<div class="td-logbar">${
    p.live ? `<span class="pulse"></span><span class="live">${esc(STEP_LABEL[p.step] ?? 'plan')} running</span>` : '<span>agents not running</span>'
  }</div>`
  // A redraw from a board push keeps the log it shows and where it is scrolled.
  const old = drawer.dataset.plan === p.run ? drawer.querySelector('.td-log') : null
  const oldSpec = old ? drawer.querySelector('.td-spec') : null
  const keep = old ? { html: old.innerHTML, top: old.scrollTop, spec: oldSpec?.innerHTML, specText: oldSpec?.dataset.text } : null
  drawer.dataset.plan = p.run
  applyDrawerMode(true)
  drawer.innerHTML = `${headHTML({
    id: `plan #${p.run}`,
    live: p.live,
    title,
    badge: `<span class="td-col pstate-${esc(p.state)}">${PLAN_STATE_LABEL[p.state] ?? esc(p.state)}</span>`,
  })}
    <div class="td-grid">
      <div class="td-main">${bar}${logBoxHTML('data-fresh="1"', '<div class="tl dim">loading…</div>')}<div class="td-slice body td-spec"></div></div>
      ${sideHTML(side)}
    </div>`
  if (keep) {
    const box = drawer.querySelector('.td-log')
    box.innerHTML = keep.html
    box.scrollTop = keep.top
    delete box.dataset.fresh
    if (keep.specText !== undefined) {
      const specBox = drawer.querySelector('.td-spec')
      specBox.innerHTML = keep.spec
      specBox.dataset.text = keep.specText
    }
  }
  loadPlanLog(p.run)
}

function renderDrawer() {
  const plan = selectedPlan && plansByRun.get(selectedPlan)
  if (plan) return renderPlanDrawer(plan)
  delete opts.drawer.dataset.plan
  const t = selected && byId.get(selected)
  const drawer = opts.drawer
  if (!t) {
    drawer.hidden = true
    drawer.innerHTML = ''
    return
  }
  drawer.hidden = false
  const text = t.text ?? {}
  const building = t.column === 'building'
  const keepScroll = drawer.querySelector('.td-log')?.scrollTop
  const cardRef = (c) => (opts.knows(c) ? `<a class="ref" href="${esc(cardHref(c))}" title="${esc(opts.titleOf(c))}">#${esc(c)}</a>` : `<span class="dim">#${esc(c)}</span>`)
  const cites = (text.cites ?? []).map(cardRef).join(' ')
  // #vi-board-ticket-decisions-2: the cards the builds proposed, or that they made none.
  const made = opts.decisionsOf?.(t.id)
  const decisions = !made
    ? ''
    : made.cards.length
      ? `<ul>${made.cards.map((c) => `<li>${cardRef(c.id)} <span class="dim">${c.proposed ? 'proposal' : 'accepted'}</span></li>`).join('')}</ul>`
      : `<p>No new card.${made.followed.length ? ` Followed ${made.followed.map(cardRef).join(' ')}.` : ''}</p>`
  const retries = t.passes > 1 ? t.passes - 1 : 0
  const build = [
    `${t.passes} pass${t.passes === 1 ? '' : 'es'}${retries ? `, ${retries} retr${retries === 1 ? 'y' : 'ies'}` : ''}`,
    t.lastEnd ? `last session ended ${esc(t.lastEnd)}` : '',
    t.live ? 'a session is running now' : '',
  ].filter(Boolean)
  const red = t.heldOutRed
    ? `<p class="td-heldout">held-out red${t.heldOutFailed.length ? ` — ${t.heldOutFailed.length} failed` : ''}</p>${
        t.heldOutFailed.length ? `<ul class="td-heldout-list">${t.heldOutFailed.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''
      }${
        t.followUps?.length
          ? `<p>Follow-up${t.followUps.length === 1 ? '' : 's'}: ${t.followUps.map((f) => `<button type="button" class="td-tref" data-ticket="${esc(f)}">${esc(f)}</button>`).join(' ')}</p>`
          : ''
      }`
    : ''
  // #st-heldout-notrun: apart from the red steps, and with no follow-up.
  const notRun = (t.heldOutNotRun ?? []).length
    ? `<p class="td-notrun">not run — ${t.heldOutNotRun.length} step${t.heldOutNotRun.length === 1 ? '' : 's'} the binder could not run</p><ul class="td-notrun-list">${t.heldOutNotRun.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : ''
  const heldout = red + notRun
  const merge = t.lastMerge && !t.lastMerge.green
    ? `<p class="td-red">merge red${t.lastMerge.cmd ? `: <code>${esc(t.lastMerge.cmd)}</code>` : ''}${t.lastMerge.code != null ? ` exit ${t.lastMerge.code}` : ''}</p>${t.lastMerge.detail ? `<pre class="td-pre">${esc(t.lastMerge.detail.slice(-600))}</pre>` : ''}`
    : t.lastMerge?.green ? `<p>merged${t.lastMerge.commit ? ` at <code>${esc(t.lastMerge.commit.slice(0, 8))}</code>` : ''}</p>` : ''
  const followUpOf = t.followUpOf
    ? `<ul>${ticketRef(t.followUpOf)}</ul>${(t.steps ?? []).length ? `<p class="dim">to make green: ${t.steps.map((x) => `<code>${esc(x)}</code>`).join(' ')}</p>` : ''}`
    : ''
  const planRef = plansByRun.get(t.run)
  const side = [
    sideSection('Plan', planRef ? `<p><button type="button" class="td-tref" data-plan="${esc(t.run)}">plan #${esc(t.run)}</button> <span class="dim">${PLAN_STATE_LABEL[planRef.state] ?? ''}</span></p>` : ''),
    sideSection('Follow-up of', followUpOf),
    sideSection('Cites', cites),
    sideSection('Decisions', decisions),
    sideSection('Touches', (text.touches ?? []).length ? `<p>${text.touches.map(esc).join(', ')}</p>` : ''),
    sideSection('Blocked by', t.blockedBy.length ? `<ul>${t.blockedBy.map(ticketRef).join('')}</ul>` : ''),
    sideSection('Reason', t.reason ? `<p>${esc(t.reason)}</p>` : ''),
    sideSection('Build', `<p>${build.join('<br>')}</p>`),
    sideSection('Merge', merge),
    sideSection('Held-out', heldout),
    sideSection('Stories', (text.stories ?? []).length ? `<p>${text.stories.map(esc).join(', ')}</p>` : '<p class="dim">none — an internal ticket</p>'),
    sideSection('Checks', (text.checks ?? []).length ? `<ul>${text.checks.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>` : ''),
  ].join('')
  const archive = t.canArchive ? `<button type="button" class="td-archive" data-archive="${esc(t.id)}">Archive</button>` : ''
  applyDrawerMode(building)
  drawer.innerHTML = `${headHTML({
    id: t.id,
    live: t.live,
    title: t.title,
    // A building ticket's time in the column is in the bar above the log, not here as well.
    badge: `<span class="td-col">${t.column}${t.since && !building ? ` · ${sinceHTML(t.since)}` : ''}${t.archived ? ' · archived' : ''}</span>`,
    extra: archive,
  })}
    <div class="td-grid">
      <div class="td-main">
        ${building ? `${logBarHTML(t)}${logBoxHTML('', '')}` : ''}
        <div class="td-slice body">${text.body ? opts.md(checkboxes(text.body), opts.knows) : '<p class="dim">The ticket file is missing or has no text.</p>'}</div>
      </div>
      ${sideHTML(side)}
    </div>`
  if (!building) {
    logFor = null
    logLines = []
    logOffset = 0
    logPending = null
    return
  }
  const box = drawer.querySelector('.td-log')
  // A redraw while the same session runs keeps what the preview already holds. The log is
  // fetched again when the ticket enters building, or when a new session starts.
  if (logFor === t.id && logSrc === (t.log ?? null)) {
    box.innerHTML = logLines.map(logLineHTML).join('') || '<div class="tl dim">waiting for the session to write…</div>'
    box.scrollTop = keepScroll ?? box.scrollHeight
  } else loadLog(t.id, t.log ?? null)
}

// ---------- clicks ----------

function onClick(e) {
  const ref = e.target.closest('a.ref')
  if (ref && !e.shiftKey) {
    e.preventDefault()
    opts.openCard(cardOfHref(ref.getAttribute('href')))
    return
  }
  const trig = e.target.closest('[data-trigger]')
  if (trig) {
    e.stopPropagation()
    act('/api/ticket/trigger', { id: trig.dataset.trigger })
    return
  }
  const arch = e.target.closest('[data-archive]')
  if (arch) {
    const t = byId.get(arch.dataset.archive)
    const ok = confirm(
      `Archive "${t?.title ?? arch.dataset.archive}"?\n\n` +
        // #werk-board-control: archive is the only way to end a build.
        (t?.column === 'building' ? 'This ends its build. The build branch stays.\n\n' : '') +
        'It leaves the board, but it is never deleted. An agent can restore it ' +
        `(werk ticket restore ${arch.dataset.archive}).`,
    )
    if (ok) {
      selected = null
      act('/api/ticket/archive', { id: arch.dataset.archive })
    }
    return
  }
  if (e.target.closest('[data-close]')) {
    select(null)
    return
  }
  if (e.target.closest('[data-log-big]')) {
    setDrawerMode({ logBig: !logBig })
    return
  }
  if (e.target.closest('[data-side-toggle]')) {
    // Opening the sidebar from a big log brings the log back to its normal height.
    if (logBig) setDrawerMode({ logBig: false, sideOff: false })
    else setDrawerMode({ sideOff: !sideOff })
    return
  }
  const resume = e.target.closest('[data-resume-subtree]')
  if (resume) {
    e.stopPropagation()
    resumeSubtree(resume.dataset.resumeSubtree).then((err) => (err && say(err), refreshBoard()), (err) => say(err.message))
    return
  }
  const restart = e.target.closest('[data-restart-subtree]')
  if (restart) {
    e.stopPropagation()
    restartSubtree(restart.dataset.restartSubtree).then((err) => (err && say(err), refreshBoard()), (err) => say(err.message))
    return
  }
  const stopBuild = e.target.closest('[data-stop-build]')
  if (stopBuild) {
    e.stopPropagation()
    const run = stopBuild.dataset.stopBuild
    if (confirm(`Stop the build of #${run}? The plan or the merge loop ends, and the tickets it was building go back to ready.`)) act('/api/subtree/stop', { run })
    return
  }
  const plan = e.target.closest('[data-plan]')
  if (plan) {
    e.stopPropagation()
    const run = plan.dataset.plan
    selectPlan(run === selectedPlan && plan.classList.contains('pcard') ? null : run)
    return
  }
  const card = e.target.closest('[data-ticket]')
  if (card) {
    const id = card.dataset.ticket
    if (byId.has(id)) select(id === selected && card.classList.contains('tcard') ? null : id)
    else say(`${id} is not on the board`)
  }
}

// ---------- drag: reorder in ready, trigger into building ----------

function onDragStart(e) {
  const card = e.target.closest('.tcard[draggable="true"]')
  if (!card) return
  drag = { id: card.dataset.ticket, from: byId.get(card.dataset.ticket)?.column }
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', drag.id)
  card.classList.add('dragging')
}

function onDragEnd(e) {
  e.target.closest?.('.tcard')?.classList.remove('dragging')
  clearDropMarks()
  drag = null
}

function clearDropMarks() {
  opts.root.querySelectorAll('.drop-ok').forEach((x) => x.classList.remove('drop-ok'))
  opts.root.querySelectorAll('.drop-line').forEach((x) => x.remove())
}

/** Where a drag may land: the person's moves in #werk-board-control, nothing else. */
function allowed(to) {
  if (!drag) return false
  if (drag.from === 'ready') return to === 'ready' || (to === 'building' && byId.get(drag.id)?.canTrigger)
  // A build is not stopped by a drag: archiving its ticket in the drawer ends it.
  return false
}

/** The card in ready that the dragged card would sit before, by the pointer's height. */
function beforeCard(list, y) {
  for (const c of list.querySelectorAll('.tcard:not(.dragging)')) {
    const r = c.getBoundingClientRect()
    if (y < r.top + r.height / 2) return c
  }
  return null
}

function onDragOver(e) {
  const col = e.target.closest('.bcol')
  if (!col || !allowed(col.dataset.col)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  clearDropMarks()
  col.classList.add('drop-ok')
  if (col.dataset.col === 'ready' && drag.from === 'ready') {
    const list = col.querySelector('.bcards')
    const line = document.createElement('div')
    line.className = 'drop-line'
    list.insertBefore(line, beforeCard(list, e.clientY))
  }
}

function onDragLeave(e) {
  const col = e.target.closest('.bcol')
  if (col && !col.contains(e.relatedTarget)) clearDropMarks()
}

function onDrop(e) {
  const col = e.target.closest('.bcol')
  if (!col || !drag || !allowed(col.dataset.col)) return
  e.preventDefault()
  const { id, from } = drag
  const to = col.dataset.col
  const list = col.querySelector('.bcards')
  const before = beforeCard(list, e.clientY)?.dataset.ticket ?? null
  clearDropMarks()
  drag = null
  if (from === 'ready' && to === 'building') return act('/api/ticket/trigger', { id })
  if (from === 'ready' && to === 'ready') {
    const ids = (data.columns.ready ?? []).filter((x) => x !== id)
    const at = before ? ids.indexOf(before) : ids.length
    ids.splice(at < 0 ? ids.length : at, 0, id)
    if (ids.join() === (data.columns.ready ?? []).join()) return
    return act('/api/ticket/reorder', { ids })
  }
}
