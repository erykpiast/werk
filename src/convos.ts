/**
 * Reading one conversation's transcript from another conversation.
 *
 * Two forks never hear each other — a forked session's history freezes at the split. That
 * is not a bug to fix by broadcasting a diff into every tab (see #werk-mc-shared). It is
 * fixed by a lookup, on demand, from the transcript on disk.
 *
 * The generic way to do this is the `prior-conversations` skill, which searches every
 * session of every worktree by keyword because it has no other way to find the right file.
 * werk does not need to guess: it wrote the session id itself. So `convos` lists the
 * siblings and `recall` reads one, with no search step and no wrong-worktree failure mode.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage } from './agent.ts'
import { paths, projectRoot } from './project.ts'

/*
 * Where a second conversation lives, from #werk-multichat on: one directory per
 * conversation under `paths.convos`, each with the same two files the single conversation
 * uses today.
 */

/** The name the one-conversation layout is listed under, so `recall main` works today. */
const LEGACY = 'main'
/** convo-manager.ts's own name for the same thing — kept as one exported constant so the
 *  two modules can't drift on what the default conversation is called. */
export const MAIN = LEGACY

export type Convo = {
  /** The directory name, or `main` for the single conversation that exists today. */
  name: string
  sessionId: string | null
  chatPath: string
  /** The card open on the first turn. A conversation's label — see #werk-mc-split. */
  home: string | null
  /** The card open on the last turn. Where it drifted to. */
  at: string | null
  /** Messages from Eryk. Assistant blocks are not turns. */
  turns: number
  lastAt: string | null
  /** A fork that has not sent its first message yet: the parent session its first start
   *  must fork. Null once it has its own session. #werk-mc-fork-notice. */
  forkFrom?: string | null
}

function readChat(path: string): ChatMessage[] {
  if (!existsSync(path)) return []
  const out: ChatMessage[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    // One unparseable line must not lose the rest of the transcript.
    try {
      out.push(JSON.parse(line) as ChatMessage)
    } catch {}
  }
  return out
}

/** One named conversation's directory, on disk, if it exists — for convo-manager.ts to
 *  rebuild an Agent after a server restart without re-forking. */
export function describeConvoDisk(name: string): Convo | null {
  return describeConvo(name, name === MAIN ? paths.werk : join(paths.convos, name))
}

function describeConvo(name: string, dir: string): Convo | null {
  const chatPath = join(dir, 'chat.jsonl')
  const sessionPath = join(dir, 'session')
  const sessionId = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8').trim() || null : null
  if (!sessionId && !existsSync(chatPath)) return null
  const chat = readChat(chatPath)
  const yours = chat.filter((m) => m.from === 'you')
  // A fork's first line names its home card and its parent session, so a fork rebuilt
  // after a restart, before its first message, still forks instead of starting empty.
  const notice = chat.find((m) => m.forkOf || m.emptyStart)
  return {
    name,
    sessionId,
    chatPath,
    // The fork or empty-start notice records the card the conversation started on. The
    // first message may have been sent after the map moved, so it comes second — #werk-mc-split.
    home: notice?.card ?? yours.find((m) => m.card)?.card ?? null,
    forkFrom: sessionId ? null : (notice?.forkOf?.session ?? null),
    at: [...yours].reverse().find((m) => m.card)?.card ?? null,
    turns: yours.length,
    lastAt: chat.length ? (chat[chat.length - 1].at ?? null) : null,
  }
}

/**
 * Every conversation, newest activity first.
 *
 * The single conversation of today lives at `.werk/session` and `.werk/chat.jsonl`, not
 * under `conversations/`. It is listed as `main` so this works before #werk-multichat is
 * built, and keeps working after: a reader does not care which layout produced the entry.
 */
export function listConvos(): Convo[] {
  const found: Convo[] = []
  const legacy = describeConvo(LEGACY, paths.werk)
  if (legacy) found.push(legacy)
  const dir = paths.convos
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name === LEGACY) continue
      if (!statSync(join(dir, name)).isDirectory()) continue
      const c = describeConvo(name, join(dir, name))
      if (c) found.push(c)
    }
  }
  return found.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}

/**
 * Find the conversation a reference names. A name, a session id or its prefix, or a card
 * id — whichever the agent happens to have.
 *
 * An ambiguous card is an error, not a guess. Two conversations on one card is already a
 * mistake worth seeing (see #werk-mc-split), and picking one silently would hide it.
 */
export function resolveConvo(ref: string): { convo: Convo } | { ambiguous: Convo[] } | null {
  const all = listConvos()
  const id = ref.replace(/^#/, '')
  const byName = all.find((c) => c.name === id)
  if (byName) return { convo: byName }
  const bySession = all.filter((c) => c.sessionId?.startsWith(id))
  if (bySession.length === 1) return { convo: bySession[0] }
  if (bySession.length > 1) return { ambiguous: bySession }
  const byCard = all.filter((c) => c.home === id || c.at === id)
  if (byCard.length === 1) return { convo: byCard[0] }
  if (byCard.length > 1) return { ambiguous: byCard }
  return null
}

/** The raw Claude Code transcript for a session, if it is still on disk. */
export function rawPath(sessionId: string, cwd = projectRoot()): string {
  // Claude Code encodes the working directory by replacing every non-alphanumeric run with
  // a dash. Every worktree is therefore its own directory under projects/.
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}

/**
 * The session's own name, the one Claude Code's `/resume` list shows. #werk-mc-desc: a
 * switcher row is described by this, not by its card's title — two tabs on one card would
 * otherwise read the same.
 *
 * Claude Code appends these records to the session's transcript: `custom-title` from a
 * `/rename`, `ai-title` from its own titler, and `summary` from older versions. The last of
 * each counts, and a rename beats a generated title. A `--print` session has so far carried
 * none, so without one this falls back to what `/resume` shows instead: the conversation's
 * first prompt — werk's own, so a fork does not show its parent's.
 */
export function convoTitle(convo: Convo, cwd = projectRoot()): string {
  const titled = convo.sessionId ? sessionTitle(rawPath(convo.sessionId, cwd)) : null
  if (titled) return titled
  const first = readChat(convo.chatPath).find((m) => m.from === 'you' && m.text?.trim())
  const line = first?.text.trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** Keyed by path. A transcript can run to megabytes, and a title only moves when it grows. */
const titleCache = new Map<string, { stamp: string; title: string | null }>()

export function sessionTitle(path: string): string | null {
  if (!existsSync(path)) return null
  const st = statSync(path)
  const stamp = `${st.size}:${st.mtimeMs}`
  const hit = titleCache.get(path)
  if (hit?.stamp === stamp) return hit.title
  const found: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    // A cheap test first: almost no line is a title record, and parsing each one is not.
    if (!line.includes('-title"') && !line.includes('"summary"')) continue
    try {
      const e = JSON.parse(line)
      if (e.type === 'custom-title' && e.customTitle) found.custom = String(e.customTitle)
      else if (e.type === 'ai-title' && e.aiTitle) found.ai = String(e.aiTitle)
      else if (e.type === 'summary' && e.summary) found.summary = String(e.summary)
    } catch {}
  }
  const title = found.custom ?? found.ai ?? found.summary ?? null
  titleCache.set(path, { stamp, title })
  return title
}

export type RecallOptions = {
  /** Case-insensitive regexes. A message must match all of them. */
  grep?: string[]
  /** Messages printed either side of a hit. */
  context?: number
  /** Without grep, the last N messages. */
  tail?: number
  /** Include tool calls and their results. Off by default: they are most of the file. */
  tools?: boolean
  thinking?: boolean
  maxChars?: number
}

/**
 * One conversation's transcript, filtered.
 *
 * This reads werk's own chat.jsonl, which already holds the tool calls and their results —
 * it is not a text-only log. What it loses is detail inside a call: a non-Bash tool is
 * flattened to a name and one field by `label()` in agent.ts, and a result is cut at 4000
 * characters. For an agent whose work is the map, that is nearly lossless, because every
 * `werk` call is a Bash call and is stored whole. Use `--raw` for an edit's
 * actual diff. See #werk-mc-recall.
 */
export function recall(convo: Convo, opts: RecallOptions = {}): string[] {
  const all = readChat(convo.chatPath)
  const keep = all.filter((m) => {
    if (m.from === 'thinking') return opts.thinking === true
    if (m.from === 'tool' || m.from === 'result') return opts.tools === true
    if (m.from === 'system') return false
    return true
  })

  let picked = keep
  if (opts.grep?.length) {
    const res = opts.grep.map((t) => new RegExp(t, 'i'))
    const context = opts.context ?? 2
    const wanted = new Set<number>()
    keep.forEach((m, i) => {
      if (!res.every((r) => r.test(m.text))) return
      for (let j = Math.max(0, i - context); j <= Math.min(keep.length - 1, i + context); j++) wanted.add(j)
    })
    picked = keep.filter((_, i) => wanted.has(i))
  } else if (opts.tail) {
    picked = keep.slice(-opts.tail)
  }

  const cap = opts.maxChars ?? 2000
  return picked.map((m) => {
    const when = (m.at ?? '').slice(0, 16).replace('T', ' ')
    const card = m.card ? ` #${m.card}` : ''
    const text = m.text.length > cap ? `${m.text.slice(0, cap)}\n… (${m.text.length - cap} more characters)` : m.text
    return `[${when}] ${m.from}${card}\n${indent(text)}`
  })
}

export type QuoteMatch = {
  msgIndex: number
  span: [number, number]
  speaker: 'you' | 'agent'
  text: string
  context: string
  at: string | null
}

/**
 * Locate a verbatim quote inside a conversation's transcript, so an excerpt node carries a
 * real pointer instead of a paraphrase. The needle must appear character-for-character in
 * one message — that is what makes msgIndex/span trustworthy evidence instead of another
 * guess (see #vi-extract). msgIndex counts every line of chat.jsonl, not the filtered view
 * `recall` prints, so the pointer stays valid no matter which options `recall` was run with.
 *
 * Candidates are `you`/`agent` messages only, the same default `recall` uses. A `result`
 * message can hold a `recall` dump of the very text being searched for, and a `tool` message
 * can hold the shell command doing the quoting — both would otherwise look like a second,
 * spurious sighting of something that was only ever said once.
 *
 * One match means one occurrence in the whole transcript (#werk-excerpt-once). A repeat
 * inside one message is as much a guess as a repeat across two, so both fail: `ambiguous`
 * counts the messages, `repeated` counts the matches inside the one message.
 */
export function findQuote(
  convo: Convo,
  needle: string,
): QuoteMatch | { ambiguous: number } | { repeated: number } | null {
  if (!needle) return null
  const all = readChat(convo.chatPath)
  const hits: { i: number; count: number }[] = []
  all.forEach((m, i) => {
    if (m.from !== 'you' && m.from !== 'agent') return
    let count = 0
    for (let at = m.text?.indexOf(needle) ?? -1; at >= 0; at = m.text.indexOf(needle, at + 1)) count++
    if (count) hits.push({ i, count })
  })
  if (hits.length === 0) return null
  if (hits.length > 1) return { ambiguous: hits.length }
  if (hits[0].count > 1) return { repeated: hits[0].count }
  const i = hits[0].i
  const m = all[i]
  const start = m.text.indexOf(needle)
  const span: [number, number] = [start, start + needle.length]
  const speaker: 'you' | 'agent' = m.from === 'you' ? 'you' : 'agent'
  const radius = 80
  const context = m.text.slice(Math.max(0, start - radius), Math.min(m.text.length, span[1] + radius))
  return { msgIndex: i, span, speaker, text: needle, context, at: m.at ?? null }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
}

/** How long ago, for a list a human reads. */
export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
