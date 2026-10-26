/**
 * Reads sessions' transcripts and writes each finished turn into the pipeline log as a
 * plan-turn event: live, one turn as the chat pane receives its result (#ms-store-plan), and
 * in a backfill over past sessions (#ms-cost-history). Claude Code deletes old transcripts,
 * so the log, not the transcripts, is what every report reads. Pricing and the counting rule
 * live in cost.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appendCorrections, appendPipeline, appendPipelineMany, readPipeline, readPipelineRaw, type BuildStepEnded, type PlanTurnEnded, type SessionCorrected } from './pipeline.ts'
import { paths, projectRoot } from './project.ts'
import {
  activeSeconds, addTokens, classify, dollars, IDLE_SEC, nextPart, openCard, planTurn, planTurns, tokensOf,
  ZERO_TOKENS, type Block, type Response, type Tokens, type Turn,
} from './cost.ts'

/** The directory Claude Code keeps this checkout's transcripts in. */
export function transcriptDir(cwd = projectRoot()): string {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
}

/** Every chat-pane session id, mapped to its conversation's home card. */
export function chatSessions(convoDir = paths.convos): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(convoDir)) return out
  for (const name of readdirSync(convoDir)) {
    const dir = join(convoDir, name)
    const sessionFile = join(dir, 'session')
    if (existsSync(sessionFile)) {
      const id = readFileSync(sessionFile, 'utf8').trim()
      if (id) out.set(id, name)
    }
    const chat = join(dir, 'chat.jsonl')
    if (!existsSync(chat)) continue
    // A conversation that started over names each new session in its chat record.
    for (const m of readFileSync(chat, 'utf8').matchAll(/New session ([0-9a-f]{8})/g)) {
      out.set(m[1], name)
    }
  }
  return out
}

function lines(path: string): any[] {
  const out: any[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A transcript cut mid-line by a crash still has every whole line before it.
    }
  }
  return out
}

/** The text of a person's prompt, or null when the entry is a tool result or a meta line. */
function promptText(e: any): string | null {
  if (e.type !== 'user' || e.isSidechain || e.isMeta) return null
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c) || c.some((b: any) => b.type === 'tool_result')) return null
  const text = c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  return text || null
}

/**
 * Model responses in transcript order. One response is written as several lines, one per
 * content block, each repeating the usage; the last line's usage is the final count.
 */
function responses(entries: any[]): { id: string; at: string; model: string; usage: any; blocks: Block[] }[] {
  const byId = new Map<string, { id: string; at: string; model: string; usage: any; blocks: Block[] }>()
  for (const e of entries) {
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage || !m.id) continue
    const r = byId.get(m.id) ?? { id: m.id, at: e.timestamp, model: m.model, usage: m.usage, blocks: [] as Block[] }
    r.at = e.timestamp
    r.usage = m.usage
    if (Array.isArray(m.content)) r.blocks.push(...m.content)
    byId.set(m.id, r)
  }
  return [...byId.values()]
}

function priced(r: { at: string; model: string; usage: any; blocks: Block[] }): Response {
  const d = dollars(r.model, r.usage)
  const { cards, code } = classify(r.blocks)
  // A synthetic line is Claude Code's own placeholder: no model ran, nothing was paid.
  const synthetic = r.model === '<synthetic>'
  return {
    at: r.at,
    model: r.model,
    tokens: synthetic ? ZERO_TOKENS : tokensOf(r.usage),
    dollars: d ?? 0,
    unpriced: d === null && !synthetic,
    cards,
    code,
  }
}

/**
 * What one session cost with everything it started: its own transcript and every subagent
 * file under it, each response counted once (#ms-cost-tree). Null when the session has no
 * transcript. `subagents` is how many other files it counted.
 */
export function sessionTree(
  dir: string,
  session: string,
): { costUsd: number; tokens: Tokens; responses: number; subagents: number; unpriced: number } | null {
  const main = join(dir, `${session}.jsonl`)
  if (!existsSync(main)) return null
  const subDir = join(dir, session, 'subagents')
  const subs = existsSync(subDir) ? readdirSync(subDir).filter(f => f.endsWith('.jsonl')).map(f => join(subDir, f)) : []
  const seen = new Set<string>()
  let costUsd = 0
  let tokens = ZERO_TOKENS
  let unpriced = 0
  for (const file of [main, ...subs]) {
    for (const r of responses(lines(file))) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const p = priced(r)
      costUsd += p.dollars
      tokens = addTokens(tokens, p.tokens)
      if (p.unpriced) unpriced++
    }
  }
  return { costUsd, tokens, responses: seen.size, subagents: subs.length, unpriced }
}

/** Split one session into turns, and hang each subagent's responses on the turn that started it. */
export function readSession(dir: string, session: string): Turn[] {
  const path = join(dir, `${session}.jsonl`)
  const entries = lines(path)
  const turns: (Turn & { toolUses: Set<string> })[] = []
  // Each response belongs to the turn its first line fell in.
  const owner = new Map<string, number>()
  for (const e of entries) {
    const text = promptText(e)
    if (text !== null) {
      turns.push({
        session, turnId: e.uuid ?? e.timestamp, at: e.timestamp, endAt: e.timestamp, wallSec: 0,
        openCard: openCard(text), responses: [], subagent: [], toolUses: new Set(),
      })
      continue
    }
    const m = e.message
    const turn = turns[turns.length - 1]
    if (!turn || e.type !== 'assistant' || !m?.id) continue
    if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') turn.toolUses.add(b.id)
    if (!owner.has(m.id)) owner.set(m.id, turns.length - 1)
  }
  const ats = turns.map(() => [] as string[])
  for (const r of responses(entries)) {
    const i = owner.get(r.id)
    if (i === undefined) continue
    turns[i].responses.push(priced(r))
    ats[i].push(r.at)
  }
  turns.forEach((turn, i) => {
    turn.wallSec = activeSeconds(turn.at, ats[i])
    turn.endAt = [turn.at, ...ats[i]].reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
  })
  const subDir = join(dir, session, 'subagents')
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter(f => f.endsWith('.jsonl'))) {
      const toolUseId = metaToolUse(join(subDir, f.replace(/\.jsonl$/, '.meta.json')))
      const turn = (toolUseId && turns.find(x => x.toolUses.has(toolUseId))) || turns[turns.length - 1]
      if (turn) turn.subagent.push(...responses(lines(join(subDir, f))).map(priced))
    }
  }
  return turns.map(({ toolUses: _toolUses, ...turn }) => turn)
}

/**
 * The tool call that started a subagent, from its meta file. A missing or unreadable meta
 * file gives null, and the subagent's cost goes to the session's last turn, the same way a
 * cut transcript line is skipped rather than stopping the run.
 */
function metaToolUse(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')).toolUseId ?? null
  } catch {
    return null
  }
}

/**
 * Every finished turn in this checkout's transcripts, as plan-turn facts. A session written
 * to in the last few minutes may still be inside its last turn, so that turn waits for a
 * later import: a turn is imported once, and a part of a turn would stay a part.
 */
export function readPlanTurns(opts: { dir?: string; convoDir?: string; now?: number } = {}): { at: string; turn: PlanTurnEnded }[] {
  return readFinishedTurns(opts).map(({ at, turn }) => ({ at, turn }))
}

function readFinishedTurns(opts: { dir?: string; convoDir?: string; now?: number }): { at: string; turn: PlanTurnEnded; raw: Turn; home: string | null }[] {
  const dir = opts.dir ?? transcriptDir()
  const now = opts.now ?? Date.now()
  const chat = chatSessions(opts.convoDir)
  const out: { at: string; turn: PlanTurnEnded; raw: Turn; home: string | null }[] = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    const session = f.slice(0, -'.jsonl'.length)
    const home = chat.get(session) ?? chat.get(session.slice(0, 8)) ?? null
    const turns = readSession(dir, session)
    const live = now - statSync(join(dir, f)).mtimeMs < IDLE_SEC * 1000
    for (const turn of live ? turns.slice(0, -1) : turns) out.push({ at: turn.endAt, turn: planTurn(turn, home), raw: turn, home })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** The parts of each turn that the log holds, by session and prompt id. */
function recordedParts(pipeline?: string): Map<string, PlanTurnEnded[]> {
  const out = new Map<string, PlanTurnEnded[]>()
  for (const { turn } of planTurns(readPipeline(pipeline))) {
    const key = `${turn.session}\u0000${turn.turnId}`
    out.set(key, [...(out.get(key) ?? []), turn])
  }
  return out
}

/** The event of a turn's next part. Part 0 keeps the shape an event had before parts existed. */
function partEvent(turn: Turn, recorded: PlanTurnEnded[], homeCard: string | null): PlanTurnEnded | null {
  const next = nextPart(turn, recorded)
  if (!next) return null
  const payload = planTurn(next, homeCard)
  return next.part === 0 ? payload : { ...payload, part: next.part }
}

/**
 * Append the plan-turn event of the chat-pane turn that ended at `endedAt`, as the pane
 * receives its result (#ms-store-plan). The turn is the last one the person started before
 * `endedAt`, so a queued message sent right after the result is not mistaken for it. Its
 * subagents count toward it, as in the backfill. A result that a background task woke after
 * the turn's first result adds the turn's next part, with only the responses since then. Both
 * writers key a part by its session, prompt id and part number, so nothing is counted twice.
 */
export function recordTurn(
  session: string,
  homeCard: string | null,
  endedAt: number,
  opts: { dir?: string; pipeline?: string } = {},
): PlanTurnEnded | null {
  const dir = opts.dir ?? transcriptDir()
  if (!existsSync(join(dir, `${session}.jsonl`))) return null
  const turn = readSession(dir, session).filter(t => Date.parse(t.at) <= endedAt).at(-1)
  if (!turn) return null
  const payload = partEvent(turn, recordedParts(opts.pipeline).get(`${session}\u0000${turn.turnId}`) ?? [], homeCard)
  if (!payload) return null
  appendPipeline('step.ended', payload, { path: opts.pipeline, at: turn.endAt })
  return payload
}

/** The session id a run file holds: every event of the stream repeats it. */
function runSession(path: string): string | null {
  if (!existsSync(path)) return null
  for (const e of lines(path)) if (typeof e.session_id === 'string') return e.session_id
  return null
}

/** Every session id under the transcript root, with the directory its transcript is in. */
function sessionDirs(root = join(homedir(), '.claude', 'projects')): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(root)) return out
  for (const d of readdirSync(root)) {
    const dir = join(root, d)
    for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out.set(f.slice(0, -6), dir)
  }
  return out
}

/**
 * Write a correction for every past pipeline session whose logged cost is not the sum of its
 * transcript tree (#ms-cost-history-pipeline): a cost that left out subagents and forks, or
 * one that was never recorded. A session that has a correction is skipped, and a session
 * whose transcripts are gone keeps its old figure. Run it again at any time.
 */
export function importPipelineCosts(opts: { pipeline?: string; root?: string; cwd?: string } = {}): {
  corrected: number
  unchanged: number
  skipped: number
  notRebuilt: number
} {
  const cwd = opts.cwd ?? projectRoot()
  const raw = readPipelineRaw(opts.pipeline)
  const done = new Set(raw.flatMap(e => (e.type === 'step.corrected' ? [e.payload.file] : [])))
  const dirs = sessionDirs(opts.root)
  const fresh: SessionCorrected[] = []
  const counts = { corrected: 0, unchanged: 0, skipped: 0, notRebuilt: 0 }
  for (const e of raw) {
    if (e.type !== 'step.ended') continue
    const p = e.payload as BuildStepEnded
    if (p.step !== 'session' || !p.file) continue
    if (done.has(p.file)) {
      counts.skipped++
      continue
    }
    const sid = runSession(join(cwd, p.file))
    const dir = sid ? dirs.get(sid) : undefined
    const tree = sid && dir ? sessionTree(dir, sid) : null
    if (!tree) {
      counts.notRebuilt++
      continue
    }
    if (p.costUsd != null && p.tokens && Math.abs(tree.costUsd - p.costUsd) < 0.005) {
      counts.unchanged++
      continue
    }
    done.add(p.file)
    fresh.push({ file: p.file, costUsd: tree.costUsd, tokens: tree.tokens, responses: tree.responses, subagents: tree.subagents })
  }
  counts.corrected = appendCorrections(fresh, opts.pipeline)
  return counts
}

/** The role of a pipeline session that wrote no event, from the start of its first prompt. */
function roleOfPrompt(text: string): string | null {
  if (text.startsWith('You are the binder of a held-out test set')) return 'heldout-binder'
  if (text.includes('<command-message>implement</command-message>')) return 'pass'
  return null
}

/**
 * Write a session event for every pipeline session that has transcripts and no event: a
 * held-out binder, or a builder run that crashed before its step ended
 * (#ms-cost-history-pipeline). Pipeline sessions run in temporary worktrees, so they are found
 * under the transcript directories of those. A session is known by its id, so a rerun adds
 * nothing, and one that wrote to its transcript in the last 15 minutes waits. A session whose
 * first prompt names no role is counted as unclassified and left out.
 */
export function importMissingSessions(opts: { pipeline?: string; root?: string; cwd?: string; now?: number } = {}): { added: number; unclassified: number; unclassifiedUsd: number } {
  const root = opts.root ?? join(homedir(), '.claude', 'projects')
  const cwd = opts.cwd ?? projectRoot()
  const now = opts.now ?? Date.now()
  const raw = readPipelineRaw(opts.pipeline)
  const have = new Set<string>()
  for (const e of raw) {
    if (e.type !== 'step.ended') continue
    const p = e.payload as BuildStepEnded
    if (p.step !== 'session') continue
    if (p.session) have.add(p.session)
    const sid = p.file ? runSession(join(cwd, p.file)) : null
    if (sid) have.add(sid)
  }
  const fresh: { type: 'step.ended'; payload: BuildStepEnded; at: string }[] = []
  let unclassified = 0
  let unclassifiedUsd = 0
  if (!existsSync(root)) return { added: 0, unclassified, unclassifiedUsd }
  for (const d of readdirSync(root)) {
    if (!/-T-werk-(heldout|build)-wt-/.test(d)) continue
    const dir = join(root, d)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const sid = f.slice(0, -6)
      if (have.has(sid) || now - statSync(join(dir, f)).mtimeMs < 15 * 60_000) continue
      const entries = lines(join(dir, f))
      const prompt = entries.map(promptText).find(t => t !== null)
      const role = prompt ? roleOfPrompt(prompt) : null
      if (!role) {
        unclassified++
        unclassifiedUsd += sessionTree(dir, sid)?.costUsd ?? 0
        continue
      }
      const tree = sessionTree(dir, sid)
      if (!tree) continue
      const ats = entries.filter(e => e.type === 'assistant' && e.timestamp).map(e => e.timestamp as string)
      const first = entries.find(e => e.timestamp)?.timestamp ?? ats[0]
      if (!ats.length) continue
      fresh.push({
        type: 'step.ended',
        at: ats.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
        payload: {
          build: 'unlogged', ticket: 'unlogged', step: 'session', name: role, result: 'unknown',
          ms: Math.round(activeSeconds(first, ats) * 1000), costUsd: tree.costUsd, tokens: tree.tokens,
          responses: tree.responses, subagents: tree.subagents, session: sid, imported: true,
        },
      })
    }
  }
  fresh.sort((a, b) => a.at.localeCompare(b.at))
  appendPipelineMany(fresh, opts.pipeline)
  return { added: fresh.length, unclassified, unclassifiedUsd }
}

/**
 * Append every finished turn, and every part of a turn, that the pipeline log does not hold
 * yet. Run it again at any time: what the log holds is skipped, so nothing is counted twice.
 */
export function importPlanTurns(opts: { dir?: string; convoDir?: string; pipeline?: string; now?: number } = {}): {
  added: number
  skipped: number
} {
  const have = recordedParts(opts.pipeline)
  const fresh: { at: string; turn: PlanTurnEnded }[] = []
  for (const { at, turn, raw, home } of readFinishedTurns(opts)) {
    const payload = partEvent(raw, have.get(`${turn.session}\u0000${turn.turnId}`) ?? [], home)
    if (payload) fresh.push({ at, turn: payload })
  }
  appendPipelineMany(
    fresh.map(({ at, turn }) => ({ type: 'step.ended' as const, payload: { ...turn, backfilled: true }, at })),
    opts.pipeline,
  )
  return { added: fresh.length, skipped: [...have.values()].reduce((n, parts) => n + parts.length, 0) }
}
