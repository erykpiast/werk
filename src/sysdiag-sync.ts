/**
 * #vi-sysdiag-quiet: the product diagram follows the map from inside `werk serve`, not from a
 * chat turn. A log change that touches a decided card queues one background run of
 * sysdiag-scout and, if scout names a change, sysdiag-updater. Nothing here writes to a chat.
 *
 * The pure half compares two folds of the log — which decided cards appeared, disappeared,
 * or changed — and turns that into the brief scout reads. The I/O half debounces log
 * changes, runs one job at a time, and keeps the last good diagram when a run fails.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fold } from './fold.ts'
import { readEvents } from './log.ts'
import { agentEnv } from './instructions.ts'
import type { AgentRole } from './instructions.ts'
import type { Event, Graph } from './types.ts'

/** What scout can see of one decided card. Nothing else can change what the diagram may cite. */
export type CardShape = { title: string; why: string; body: string; edges: string[] }

/** Decided, live (not ghost, not removed) cards only — only those may justify diagram content. */
export function snapshot(graph: Graph): Map<string, CardShape> {
  const out = new Map<string, CardShape>()
  for (const n of graph.nodes.values()) {
    if (n.kind !== 'card' || n.status !== 'decided' || graph.proposed.has(n.id)) continue
    const edges = graph.edges
      .filter((e) => e.from === n.id && (e.type === 'depends_on' || e.type === 'refines'))
      .map((e) => `${e.type} ${e.to}`)
      .sort()
    out.set(n.id, { title: n.title, why: n.why ?? '', body: n.body ?? '', edges })
  }
  return out
}

/** One line per change, in the operation vocabulary scout's prompt expects. */
export function diffSnapshots(before: Map<string, CardShape>, after: Map<string, CardShape>, graph: Graph): string[] {
  const lines: string[] = []
  for (const [id, a] of after) {
    const b = before.get(id)
    if (!b) {
      lines.push(`card ${id} became decided: "${a.title}"`)
      continue
    }
    if (b.title !== a.title) lines.push(`card ${id} retitled: "${b.title}" -> "${a.title}"`)
    if (b.why !== a.why || b.body !== a.body) lines.push(`card ${id} why/body edited ("${a.title}")`)
    for (const e of a.edges) if (!b.edges.includes(e)) lines.push(`linked ${id} ${e}`)
    for (const e of b.edges) if (!a.edges.includes(e)) lines.push(`unlinked ${id} ${e}`)
  }
  for (const [id, b] of before) {
    if (after.has(id)) continue
    const now = graph.nodes.get(id)
    const where = !now ? 'removed from the map' : `now ${now.status ?? 'without a status'}`
    lines.push(`card ${id} stopped being decided (${where}): "${b.title}"`)
  }
  return lines
}

/** The changes between two log positions, or [] when nothing the diagram may cite moved. */
export function changesBetween(events: Event[], fromSeq: number): string[] {
  const before = fold(events.filter((e) => e.seq <= fromSeq))
  const after = fold(events)
  return diffSnapshots(snapshot(before), snapshot(after), after)
}

export function scoutBrief(changes: string[]): string {
  return [
    'These decided-card changes reached the map since the diagram was last checked:',
    '',
    ...changes.map((c) => `- ${c}`),
    '',
    'Nobody reads your report but the next agent. Do not address a person, do not ask a question.',
  ].join('\n')
}

export function updaterBrief(scoutReport: string): string {
  return [
    'sysdiag-scout reported this content-section change. Apply it:',
    '',
    scoutReport,
    '',
    'You run unattended. Nobody reads your report but a program. Do not ask anything.',
  ].join('\n')
}

export function needsChange(scoutReport: string): boolean {
  return !/^\s*\**\s*NO CHANGE NEEDED/i.test(scoutReport)
}

export type ChangeKind = { kind: 'local' | 'restructure'; reason: string }

const KIND_LINE = 'CHANGE KIND:'

/** #vi-sysdiag-declare: the last "CHANGE KIND: local|restructure — reason" line of a report. */
export function parseKind(report: string): ChangeKind | undefined {
  const line = report
    .split('\n')
    .filter((l) => l.toUpperCase().includes(KIND_LINE))
    .at(-1)
  if (!line) return undefined
  const rest = line.slice(line.toUpperCase().indexOf(KIND_LINE) + KIND_LINE.length).replace(/\*/g, '').trim()
  const kind = (['local', 'restructure'] as const).find((k) => rest.toLowerCase().startsWith(k))
  if (!kind) return undefined
  return { kind, reason: rest.slice(kind.length).replace(/^[\s—–:-]+/, '').trim() }
}

/** The card ids that the change lines name, in order, without repeats. */
export function changedCards(changes: string[]): string[] {
  return [...new Set(changes.map((c) => /^(?:card|linked|unlinked) (\S+)/.exec(c)?.[1]).filter((id): id is string => !!id))]
}

/** The build prints "N error(s)". Anything but an explicit 0 is a failure. */
export function buildPassed(output: string): boolean {
  return /(^|\D)0 error\(s\)/.test(output)
}

// ---------- I/O ----------

export type SyncState = {
  /** The last log seq the diagram was checked against. */
  seq: number
  state: 'idle' | 'running' | 'failed'
  /** The last finished run: updated, unchanged, or the reason it failed. An update also says
   *  whether it was a local edit or a restructure, and why (#vi-sysdiag-declare). */
  last?: { at: string; result: 'updated' | 'unchanged' | 'failed'; detail?: string } & Partial<ChangeKind>
}

export type RunAgent = (agent: string, prompt: string, tools: string[]) => Promise<{ ok: boolean; out: string }>
export type RunBuild = () => Promise<string>

const WGRID = 'diagram-grid-full-minimal.wgrid'
const SVG = 'diagram-grid-full-minimal.svg'
const DEBOUNCE_MS = 5000
const TIMEOUT_MS = 10 * 60 * 1000

const SCOUT_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(werk show:*)']
const UPDATER_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(bun src/gridsys/build.ts:*)']

export const runClaudeAgent =
  (cwd: string): RunAgent =>
  (agent, prompt, tools) =>
    new Promise((resolve) => {
      // The prompt goes first: --allowedTools is variadic and swallows what follows it.
      const args = ['--print', prompt, '--agent', agent, '--no-session-persistence', '--allowedTools', ...tools]
      // #st-build-seam-role-env: the role is the subagent's own name.
      const proc = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: agentEnv(agent as AgentRole) })
      let out = ''
      let err = ''
      const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => (err += d))
      proc.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, out: e.message })
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code === 0 ? { ok: true, out: out.trim() } : { ok: false, out: (err || out).trim().slice(-2000) || `exit ${code}` })
      })
    })

export const runGridBuild =
  (cwd: string, werkDir: string): RunBuild =>
  () =>
    new Promise((resolve) => {
      const args = ['src/gridsys/build.ts', join(werkDir, WGRID), join(werkDir, SVG), '--tracks']
      const proc = spawn('bun', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => (out += d))
      proc.on('error', (e) => resolve(e.message))
      proc.on('exit', () => resolve(out))
    })

export function startSysdiagSync(opts: {
  werkDir: string
  logPath: string
  runAgent: RunAgent
  runBuild: RunBuild
  onState: (s: SyncState) => void
  /** A restructure is worth a note on the cards that caused it, so the map shows it. */
  onRestructure?: (cards: string[], reason: string) => void
  debounceMs?: number
}) {
  const statePath = join(opts.werkDir, 'sysdiag-sync.json')
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS
  const latestSeq = () => readEvents(opts.logPath).at(-1)?.seq ?? 0

  // A first start does not replay history: the diagram as it stands is the baseline.
  let state: SyncState = existsSync(statePath)
    ? { ...JSON.parse(readFileSync(statePath, 'utf8')), state: 'idle' }
    : { seq: latestSeq(), state: 'idle' }
  const save = (s: SyncState) => {
    state = s
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
    opts.onState(state)
  }
  save(state)

  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false

  // A failed run does not move the position, so the next log change retries these changes too.
  const finish = (seq: number, result: 'updated' | 'unchanged' | 'failed', detail?: string, kind?: ChangeKind) =>
    save({
      seq: result === 'failed' ? state.seq : seq,
      state: result === 'failed' ? 'failed' : 'idle',
      last: { at: new Date().toISOString(), result, detail, ...kind },
    })

  async function run() {
    running = true
    const wgrid = join(opts.werkDir, WGRID)
    const svg = join(opts.werkDir, SVG)
    let backedUp = false
    const restore = () => {
      copyFileSync(`${wgrid}.bak`, wgrid)
      if (existsSync(`${svg}.bak`)) copyFileSync(`${svg}.bak`, svg)
    }
    try {
      const events = readEvents(opts.logPath)
      const seq = events.at(-1)?.seq ?? 0
      const changes = changesBetween(events, state.seq)
      if (changes.length === 0) {
        // Keep a failure visible until a real run clears it.
        if (state.state === 'failed') save({ ...state, seq })
        else save({ ...state, seq, state: 'idle' })
        return
      }
      save({ ...state, state: 'running' })

      const scout = await opts.runAgent('sysdiag-scout', scoutBrief(changes), SCOUT_TOOLS)
      if (!scout.ok) return finish(seq, 'failed', `scout: ${scout.out}`)
      if (!needsChange(scout.out)) return finish(seq, 'unchanged')

      // The updater edits the files in place. Keep the last good pair to put back.
      copyFileSync(wgrid, `${wgrid}.bak`)
      if (existsSync(svg)) copyFileSync(svg, `${svg}.bak`)
      backedUp = true
      const updater = await opts.runAgent('sysdiag-updater', updaterBrief(scout.out), UPDATER_TOOLS)
      if (!updater.ok) {
        restore()
        return finish(seq, 'failed', `updater: ${updater.out}`)
      }
      const build = await opts.runBuild()
      if (!buildPassed(build)) {
        restore()
        return finish(seq, 'failed', `build: ${build.trim().slice(-500)}`)
      }
      // The updater repeats the scout's call, or makes its own when the scout left it open.
      const kind = parseKind(updater.out) ?? parseKind(scout.out)
      finish(seq, 'updated', undefined, kind)
      if (kind?.kind === 'restructure') opts.onRestructure?.(changedCards(changes), kind.reason)
    } catch (err) {
      if (backedUp) restore()
      finish(state.seq, 'failed', (err as Error).message)
    } finally {
      running = false
      if (again) {
        again = false
        poke()
      }
    }
  }

  function poke() {
    if (running) {
      again = true
      return
    }
    clearTimeout(timer)
    timer = setTimeout(run, debounceMs)
  }

  return { poke, state: () => state, stop: () => clearTimeout(timer) }
}
