import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './project.ts'

/**
 * Approval for the chat pane's agent.
 *
 * `claude --print` cannot show a prompt, so a call the CLI could not decide by itself used
 * to come back as "This command requires approval" and the turn carried on without it.
 * `--permission-prompt-tool stdio` moves that choice into the pane: the CLI writes a
 * `can_use_tool` control request on the same pipe the turn already uses, and waits for the
 * answer on stdin. See #werk-perm-native.
 *
 * werk does not decide what is safe. The CLI's own permission engine does, and it only asks
 * werk about the calls it could not resolve. So this module has no shell parser, no list of
 * read-only commands and no rule matcher. It holds the open questions, the ask log, and the
 * rules an "always" click keeps for the next child. It does not know about HTTP.
 */

/**
 * `allow.json` beside the log holds what "always" clicks have kept, so a restarted child
 * still honours them.
 *
 * The live child learns each one from `updatedPermissions` at `destination: "session"`, and
 * a session ends when the child does — a model switch, a cleared context, a crash retry.
 * `rules` go back in as `--allowedTools` and `dirs` as `--add-dir` on the next launch. Both
 * are Claude Code's own syntax, and werk never interprets either.
 *
 * `asks.jsonl` beside it holds one line per resolved ask: what was asked, what was decided.
 * See #werk-approve-log. Only calls that actually reached the pane are recorded — a call the
 * CLI allowed by itself never asked anyone anything, so it carries no signal about what to
 * widen.
 */

export type Decision = 'allow' | 'always' | 'deny'
/** What the ask log records: a picked answer to a question is its own decision, not a deny —
 *  #werk-mc-askqa-log-answer. */
export type LoggedDecision = Decision | 'answer'

/**
 * A permission change the CLI proposed for this call.
 *
 * werk passes one of these back unchanged instead of building its own, so "always" widens
 * exactly what the CLI itself would have offered in its interactive dialog. The shape is
 * the CLI's; the fields present depend on `type`.
 */
export type PermissionUpdate = {
  type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode' | 'addDirectories' | 'removeDirectories'
  rules?: Array<{ toolName: string; ruleContent?: string }>
  behavior?: 'allow' | 'deny' | 'ask'
  mode?: string
  directories?: string[]
  destination?: 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'
}

export type Ask = {
  /** The CLI's own `request_id`. The answer has to carry it back. */
  id: string
  at: string
  tool: string
  /** One line, the same label the tool bubble shows. */
  label: string
  input: Record<string, unknown>
  /**
   * The CLI's `decision_reason_type`: why its permission engine could not decide alone.
   * Shown raw. Inventing prose for a value werk has never seen would read as fact.
   */
  reason?: string
  /**
   * What "always" would widen, and the words for the button. Absent when the CLI proposed
   * nothing werk can use for this call. Then there is no "always" button.
   */
  always?: { label: string; updates: PermissionUpdate[] }
  /** Which conversation asked. #werk-mc-asks: one shared queue, every ask names its tab. */
  convo: string
}

/**
 * Every suggestion that widens *this call*, and the words to put on the button.
 *
 * All of them, not the first one. `cat /etc/hosts | wc -l` comes back with two `addRules`
 * suggestions — `Bash(cat /etc/hosts | wc -l)` and `Read(//private/etc/**)` — and applying
 * either alone leaves the call asking again, because the command and the path are two
 * separate blocks. Measured: with only the Bash rule, the same line asked a second time.
 *
 * `setMode` is left out on purpose. It is the one suggestion that widens far past the call
 * on the screen — `acceptEdits` stops asking about every file write for the rest of the
 * session — and a button labelled with one command must not do that. There is no flag to
 * choose a mode either: werk runs `auto` and nothing else (see #werk-perm-mode).
 *
 * A shape werk does not recognise is dropped rather than guessed at. A button whose words
 * do not match what it does is worse than no button.
 */
export function alwaysFrom(suggestions: unknown): Ask['always'] | undefined {
  if (!Array.isArray(suggestions)) return undefined
  const updates = suggestions.filter((s): s is PermissionUpdate => {
    if (!s || typeof s !== 'object') return false
    const u = s as PermissionUpdate
    if (u.type === 'addRules') return u.behavior === 'allow' && (u.rules ?? []).length > 0
    if (u.type === 'addDirectories') return (u.directories ?? []).length > 0
    return false
  })
  if (updates.length === 0) return undefined

  const label = updates
    .flatMap((u) => (u.type === 'addRules' ? ruleStrings(u) : (u.directories ?? []).map((d) => `${d}/**`)))
    .join(', ')
  return { label, updates }
}

/**
 * An `addRules` update as `--allowedTools` strings, so the next child starts with it.
 *
 * `addDirectories` has no `--allowedTools` spelling — it becomes `--add-dir`, which
 * `dirStrings` collects instead.
 */
export function ruleStrings(update: PermissionUpdate): string[] {
  if (update.type !== 'addRules' || update.behavior !== 'allow') return []
  return (update.rules ?? []).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
}

/** An `addDirectories` update as `--add-dir` paths. Empty for every other type. */
export function dirStrings(update: PermissionUpdate): string[] {
  if (update.type !== 'addDirectories') return []
  return update.directories ?? []
}

/** The part of a call worth naming: the command for Bash, the path for a file tool. */
function subject(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash') return String(input.command ?? '')
  return String(input.file_path ?? input.path ?? input.pattern ?? input.url ?? '')
}

/** One line naming what the call is about to do. Mirrors `label` in agent.ts. */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash') return String(input.command ?? '').trim()
  const s = subject(tool, input)
  return s ? `${tool} ${s}` : `${tool} ${JSON.stringify(input).slice(0, 200)}`
}

/** What every past "always" click adds to the next child's launch. */
export type Always = { rules: string[]; dirs: string[] }

export function readAlways(): Always {
  if (!existsSync(paths.allow)) return { rules: [], dirs: [] }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  try {
    const parsed = JSON.parse(readFileSync(paths.allow, 'utf8'))
    // The file used to be a bare array of rules, before a click could add a directory.
    if (Array.isArray(parsed)) return { rules: strings(parsed), dirs: [] }
    return { rules: strings(parsed?.rules), dirs: strings(parsed?.dirs) }
  } catch {
    // A corrupt file must not stop the server. An empty list only means more prompts.
    return { rules: [], dirs: [] }
  }
}

export function addAlways(add: Partial<Always>): Always {
  const held = readAlways()
  const next: Always = {
    rules: [...new Set([...held.rules, ...(add.rules ?? [])])],
    dirs: [...new Set([...held.dirs, ...(add.dirs ?? [])])],
  }
  mkdirSync(dirname(paths.allow), { recursive: true })
  writeFileSync(paths.allow, JSON.stringify(next, null, 2) + '\n')
  return next
}

/** Append one resolved ask to paths.asks. Never deleted, never rewritten — a plain history. */
export function appendAsk(ask: Ask, resolved: Decision, message?: string) {
  // A picked answer travels as a deny with the answer as its message. The log names it
  // `answer`, so a count of denies holds only refusals, and an answer widens nothing.
  const decision: LoggedDecision = resolved === 'deny' && message !== undefined ? 'answer' : resolved
  mkdirSync(dirname(paths.asks), { recursive: true })
  const line = {
    at: new Date().toISOString(),
    // #ms-outcome-interv-chat-q: when the ask went up, and whose tab it waited on.
    asked: ask.at,
    convo: ask.convo,
    tool: ask.tool,
    label: ask.label,
    input: ask.input,
    reason: ask.reason,
    widened: decision === 'always' ? ask.always?.updates : undefined,
    decision,
  }
  appendFileSync(paths.asks, JSON.stringify(line) + '\n')
}

/**
 * The open questions, keyed by the CLI's request id.
 *
 * The child is blocked on each one, so an unanswered entry is a stalled turn. The pane
 * re-reads this list on load, which is what makes a browser reload safe.
 */
/**
 * What an answer resolves to. `message` carries free text back to the model as the tool
 * result — normally only set on `deny`, to spell out *why* (or, for an AskUserQuestion form,
 * to carry the picked answer instead of the fixed denial line). See #werk-mc-askqa.
 */
export type AskResult = { decision: Decision; message?: string }

export class Asks {
  private waiting = new Map<string, { ask: Ask; resolve: (r: AskResult) => void }>()
  private listeners = new Set<(open: Ask[]) => void>()

  onChange(cb: (open: Ask[]) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  open(): Ask[] {
    return [...this.waiting.values()].map((w) => w.ask)
  }

  private changed() {
    const open = this.open()
    for (const cb of this.listeners) cb(open)
  }

  put(ask: Ask): Promise<AskResult> {
    return new Promise((resolve) => {
      this.waiting.set(ask.id, { ask, resolve })
      this.changed()
    })
  }

  /** Returns false when the id is unknown, so a double click is not an error. */
  answer(id: string, decision: Decision, message?: string): boolean {
    const entry = this.waiting.get(id)
    if (!entry) return false
    this.waiting.delete(id)
    entry.resolve({ decision, message })
    this.changed()
    return true
  }

  /**
   * The child died. Nothing is listening for these answers any more. One queue holds every
   * conversation's asks, so a child's death answers only its own — `convo` names it. Without
   * it, one tab exiting denied every other tab's pending question. #werk-mc-asks.
   */
  clear(convo?: string, reason: Decision = 'deny') {
    for (const [id, w] of this.waiting) if (convo === undefined || w.ask.convo === convo) this.answer(id, reason)
  }
}
