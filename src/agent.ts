import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { foldLog } from './fold-time.ts'
import { recordTurn, transcriptDir } from './cost-history.ts'

/** How long a turn's record waits after its result, for the transcript to be complete. */
const RECORD_DELAY_MS = 2000
import { paths } from './project.ts'
import { buildRulesFor } from './build-rules.ts'
import { HOW, WHAT } from './tops.ts'
import { agentEnv, instructionArgs } from './instructions.ts'
import {
  addAlways,
  alwaysFrom,
  appendAsk,
  Asks,
  describeCall,
  dirStrings,
  readAlways,
  ruleStrings,
  type Ask,
  type PermissionUpdate,
} from './permission.ts'

export function readSession(dir: string = paths.werk): string | null {
  const path = join(dir, 'session')
  if (!existsSync(path)) return null
  const id = readFileSync(path, 'utf8').trim()
  return id || null
}

function writeSession(dir: string, id: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session'), id + '\n')
}

/** What a conversation ran on and how full it was, kept beside its session so a server
 *  restart resumes the same model and shows the same context pie. */
type Settings = { model?: string; advisor?: string | null; context?: Context }

function readSettings(dir: string): Settings {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(dir: string, s: Settings) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(s) + '\n')
}

/** The window a model has before the CLI reports it: a `[1m]` model has a million tokens. */
function windowFor(model: string): number {
  return model.includes('[1m]') ? 1_000_000 : 200_000
}

function clearSession(dir: string) {
  const path = join(dir, 'session')
  if (existsSync(path)) rmSync(path)
}

/**
 * One message as the chat pane shows it. This is the transcript, not the map.
 * The transcript is disposable. The map is the record.
 */
export type ChatMessage = {
  /** `${messageId}:${blockIndex}`. A streaming block and its final form share this. */
  id?: string
  at: string
  from: 'you' | 'agent' | 'thinking' | 'tool' | 'result' | 'system'
  text: string
  /** The card that was open when the message was sent. */
  card?: string
  /** Absolute paths of images pasted with the message. */
  images?: string[]
  /** For a tool result: the command failed. */
  error?: boolean
  done?: boolean
  /** The turn this message belongs to: the sent message's own name, carried by every part
   *  of the reply to it, so the pane keeps a reply under its message. #werk-chat-turn-id. */
  turn?: string
  /** On a fork's first line: the parent conversation, and the `at` of its last visible
   *  message when the fork was made. The pane links back to it. #werk-mc-fork-notice. */
  forkOf?: { convo: string; at: string | null; session: string | null }
  /** On an empty conversation's first line: it has no parent. #werk-mc-empty-control. */
  emptyStart?: true
}

/** What the pane shows while a turn runs. Never written to the transcript. */
export type Status = {
  state: 'idle' | 'thinking' | 'running' | 'writing' | 'asking' | 'dead'
  detail?: string
  tokens?: number
}

/** How full the conversation is against the model's context window. */
export type Context = { used: number; max: number }

/**
 * A task the CLI is running outside the turn that started it — a `Bash` call with
 * `run_in_background: true`, or a subagent launched the same way. #werk-mc-bgagents: the
 * turn that launches one can finish and report idle while this keeps going, so it needs
 * its own signal instead of riding along on `Status`.
 */
export type BackgroundTask = { id: string; type: string; description: string }

/**
 * The tools the chat agent may use.
 *
 * It maintains the map, reads the repository, and edits code. `Edit` and `Write` already
 * let it change or create any file, so a `node` or `python` script run through `Bash`
 * cannot do more than that. Allowing both by default stops a prompt on every one-off probe
 * or rewrite script, the kind used to inspect the map or the log, without widening what the
 * agent can actually do.
 *
 * Override with `serve --allow "Bash(werk:*),Read,Grep,Glob"` to take the edit
 * tools away.
 */
const DEFAULT_TOOLS = [
  // #werk-cli-name: the map's own command, on the agent's PATH in every project.
  'Bash(werk:*)',
  'Bash(node:*)',
  'Bash(bun:*)',
  'Bash(curl:*)',
  'Bash(python3:*)',
  'Bash(python:*)',
  // Scoped to /tmp on purpose: this must not become a blanket `Bash(rm:*)` default, or the
  // agent could delete anything, anywhere, without asking.
  'Bash(rm -f /tmp/:*)',
  'Read',
  'Edit',
  'Write',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
]

/**
 * The one mode werk runs in. There is no flag: `serve` had `--permission-mode` and it was
 * removed, because a mode that is only ever set once is a setting, not a choice. Eryk chose
 * this one. See #werk-perm-mode.
 *
 * werk classifies nothing. What `auto` cannot resolve arrives as a `can_use_tool` control
 * request and is answered in the pane.
 *
 * What that means in practice, measured: a read anywhere, a write anywhere, `npm install`,
 * `rm -rf` of an existing directory, `chmod -R 777`, `sudo`, `ssh-keygen` and
 * `defaults write` all run without a question. Of nineteen calls tried across two sweeps,
 * only a network call stopped for approval, and it carried no widening suggestion — so the
 * "always" button, and everything allow.json keeps for the next child, is unreachable in
 * practice. `Edit` and `Write` are already in DEFAULT_TOOLS, so this widens what the agent
 * can reach, not what it can do to this repository.
 */
const PERMISSION_MODE = 'auto'

/**
 * Sonnet runs every turn. Opus only reads the transcript at a decision point — before the
 * agent commits to a card, or before it says a card is settled — so the map gets Opus-level
 * judgement on the calls that matter without paying Opus rates on every routine edit.
 */
const DEFAULT_MODEL = 'claude-sonnet-5-5[1m]'
const DEFAULT_ADVISOR = 'claude-opus-5-5'

/**
 * The value that routes a permission prompt onto the stream instead of to an MCP tool.
 *
 * This is not a tool name. `--permission-prompt-tool stdio` makes the CLI write a
 * `can_use_tool` control request to stdout and read the answer from stdin, on the same pipe
 * `--input-format stream-json` already uses. So there is no hook process, no MCP server and
 * no loopback HTTP between the question and the pane.
 */
const PROMPT_TOOL = 'stdio'

const SYSTEM = `You are answering inside werk, the decision map for this repository.

A chat pane is docked next to the map. The user navigates cards while you talk. When the
open card changes you receive a line like "[the map is now at #id — title]". Treat that as
the subject of the conversation until it changes again.

Keep the map current in the same turn, with the CLI:

  werk add <id> --title "..." --why "..." --parent <id> --status <s> --who <w>
  werk link <from> <to> --type refines|supported_by|alternative_to
  werk link <from> <to> --type depends_on --why "what <from> takes from <to>"
  werk status <id> decided|open|proto
  werk reopen <id>
  werk say <id> "..."
  werk show <id>

Record depends_on the moment you create a card. It cannot be reconstructed later.

Before asking Eryk to choose between two readings of a requirement, write the options
yourself. If he can judge an option only by looking at a built result, not from prose, spawn
prototyper for that fork before you put the options in front of him.

Other conversations run beside this one, and you cannot see what they said. When Eryk
refers to one — "the other tab", "we decided this elsewhere", a card you have no record of
— do not answer from your context and do not say you have no access. Run
"werk convos" to list them, then "werk recall <#card|session>
--grep 'term'" to read one. Add --tools for its tool calls, --raw for the untruncated
Claude Code transcript. Quote what you find and name the conversation it came from.

Answer in the chat. Put the settled decision on a card. Do not paste long prose into chat
that belongs in a card body. Keep replies short: the map holds the detail.

In a reply, name a map operation and its card, not the command line that runs it. Eryk
acts in the map, not in a terminal. Write "Next: accept #checkout-retry", not
"werk accept checkout-retry --actor you". You still run the full command
yourself. Write a full command line only when he must run it in a terminal (#werk-chat-opnames).

Do not rewrite a file by piping it through python or sed. Use Edit or Write instead.`

/** How an Agent starts its `claude` child. Node's `spawn` in production; a test passes a
 *  fake so it can drive the stream and watch for a kill without a real CLI. */
export type SpawnChild = (cmd: string, args: string[], opts: { cwd: string }) => ChildProcessWithoutNullStreams

// #st-build-seam-role-env: a chat agent carries the role chat. It answers many messages, so a
// test fake knows to live until its input closes (#werk-chat-fake-role).
const spawnClaude: SpawnChild = (cmd, args, opts) => spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: agentEnv('chat') })

export class Agent {
  private proc: ChildProcessWithoutNullStreams | null = null
  private spawnChild: SpawnChild
  private listeners = new Set<(m: ChatMessage) => void>()
  private deltaListeners = new Set<(d: { id: string; from: string; text: string; turn?: string }) => void>()
  private statusListeners = new Set<(s: Status) => void>()
  private backgroundListeners = new Set<(t: BackgroundTask[]) => void>()
  private queue: string[] = []
  /** Turns sent and not yet ended, oldest first. While busy, the first one is running and
   *  the rest match `queue`. Every part of the reply belongs to the first. #werk-chat-turn-id. */
  private turns: string[] = []
  private lastCard: string | null = null
  /** The message id of the assistant turn currently streaming. */
  private msgId = ''
  /** Block index -> what kind of block it is, so a delta knows where it belongs. */
  private blocks = new Map<number, { id: string; from: ChatMessage['from'] }>()
  /**
   * Claude Code emits one `assistant` event per content block, and each one carries that
   * block alone at array index 0. So the array index is not the stream's block index.
   * This keeps the blocks of the current message in order, and each final claims the first
   * unclaimed one of its kind.
   */
  private opened: Array<{ index: number; from: ChatMessage['from']; claimed: boolean }> = []
  private tokens = 0
  /** The turn being processed, kept so a failed resume can replay it. */
  private inflight: string | null = null
  /** The session this child was told to resume, and whether it ever reported init. */
  private resumedFrom: string | null = null
  private sawInit = false
  /** Everything the child wrote to stderr. The pane shows it whole when the child dies. */
  private stderr = new StderrLog()
  /** One automatic retry per failure, so a crash loop cannot spin. */
  private retried = false
  /**
   * `tool_use_id`s the pane answered with a picked message rather than a bare decline —
   * currently only an AskUserQuestion form's "Submit answer". The CLI reports these as
   * `is_error: true` tool results because the wire behavior is still `deny` (#werk-mc-askqa),
   * but a picked answer is not a failure, so the log must not paint it as one.
   */
  private answeredAsks = new Set<string>()
  busy = false
  status: Status = { state: 'idle' }
  sessionId: string | null = null
  /** Every task the CLI reported as running in the background, last snapshot it sent.
   *  #werk-mc-bgagents. */
  private bg: BackgroundTask[] = []

  // Node strips types only. Parameter properties are not supported, so assign in the body.
  private cwd: string
  private allow: string[]
  /** Extra directories the child may reach, from a past "always" click on a blocked path. */
  private dirs: string[]
  /** Set by `serve --new`. Drops the stored session once, then resumes as usual. */
  private fresh: boolean
  /**
   * The open questions. The CLI writes one here when its permission engine cannot decide,
   * and the child stays blocked until the pane answers.
   */
  private asks: Asks
  private model: string = DEFAULT_MODEL
  private advisor: string | null = DEFAULT_ADVISOR
  /** True while a kill is deliberate (a model switch or a context clear), so the exit
   * handler restarts quietly instead of reporting a crash. */
  private switching = false
  /** What the exit handler says once the restart lands. Empty says nothing extra. */
  private switchLabel = ''
  /** True while a kill is deliberate and no restart should follow — #werk-mc-reap sweeping
   * an idle parked tab, an interrupt, or the server shutting down. Without this the exit handler cannot tell a
   * park from a crash, and every parked tab printed "The agent stopped" plus whatever old,
   * unrelated text happened to be sitting in its stderr tail from earlier in its life. */
  private stopping = false
  /** The conversation's size against the model's context window, from the last turn's
   * usage. Unlike `tokens`, this never resets between turns — only a cleared context does. */
  private contextUsed = 0
  private contextMax = 200000
  private contextListeners = new Set<(c: Context) => void>()

  /** The tab label and the key #werk-multichat's manager tracks this conversation under. */
  name: string
  /** This conversation's own directory: `<dir>/session` and `<dir>/chat.jsonl`. */
  private dir: string
  private chatPath: string
  /** The card open when this conversation started. Null for `main`, which predates cards
   * having a first turn. See #werk-mc-split. */
  home: string | null
  /** A parent session to fork from on this conversation's first-ever start. Cleared once
   * that start lands, so a later restart resumes this conversation's own session instead. */
  private forkFrom: string | null
  /** The child died and the automatic retry gave up. Cleared on the next successful start.
   * See #werk-mc-live. */
  dead = false

  constructor(
    cwd: string,
    allow: string[] = DEFAULT_TOOLS,
    fresh = false,
    asks: Asks = new Asks(),
    opts: {
      name?: string
      dir?: string
      home?: string | null
      forkFrom?: string | null
      initialContext?: Context
      spawnChild?: SpawnChild
    } = {},
  ) {
    this.cwd = cwd
    this.spawnChild = opts.spawnChild ?? spawnClaude
    // Everything an earlier "always" click kept. The live child learns each one from
    // `updatedPermissions` at session scope, and that scope dies with the child, so they
    // have to go back in as --allowedTools and --add-dir on each launch.
    const held = readAlways()
    this.allow = [...new Set([...(allow ?? DEFAULT_TOOLS), ...held.rules])]
    this.dirs = held.dirs
    this.fresh = fresh
    this.asks = asks
    this.name = opts.name ?? 'main'
    this.dir = opts.dir ?? paths.werk
    this.chatPath = join(this.dir, 'chat.jsonl')
    this.home = opts.home ?? null
    this.forkFrom = opts.forkFrom ?? null
    // The stored session is known before the child starts, so a conversation rebuilt after
    // a restart can be forked before it sends anything — #werk-mc-fork.
    this.sessionId = fresh ? null : readSession(this.dir)
    // A forked conversation inherits the parent's session, so its real context is already
    // whatever the parent had used, not zero. Without this the pie reads empty until the
    // first turn lands, which reads as forking having reset the conversation.
    const saved = readSettings(this.dir)
    if (saved.model) {
      this.model = saved.model
      this.advisor = saved.advisor === undefined ? DEFAULT_ADVISOR : saved.advisor
    }
    this.contextMax = windowFor(this.model)
    const ctx = opts.initialContext ?? (this.sessionId ? saved.context : undefined)
    if (ctx) {
      this.contextUsed = ctx.used
      this.contextMax = ctx.max
    }
  }

  /** The rules the CLI is told to allow without asking. What the pane's list shows. */
  allowedTools(): string[] {
    return this.allow
  }

  /** The directories the CLI is told the child may reach past its working directory. */
  allowedDirs(): string[] {
    return this.dirs
  }

  /** What the pane's model selector shows. */
  modelSetting(): { model: string; advisor: string | null } {
    return { model: this.model, advisor: this.advisor }
  }

  /**
   * A restart is the only way to change the model, since --model is a launch flag, not a
   * live setting. Mid-turn, that restart would kill the turn, so the pane must wait for
   * idle. The session id carries over, so the restarted child resumes the conversation.
   */
  setModel(model: string, advisor: string | null) {
    if (this.busy) throw new Error('wait for the current turn to finish before switching models')
    this.model = model
    this.advisor = advisor
    // The window belongs to the model: until the next turn reports it, the old one is wrong.
    this.contextMax = windowFor(model)
    this.persistSettings()
    this.notifyContext()
    if (!this.proc) return
    this.switching = true
    this.switchLabel = `Switched to ${model}${advisor ? ` + ${advisor} advisor` : ''}.`
    this.proc.kill()
  }

  /** #werk-mc-fork-notice: the first line of a fork's own chat. It says where the
   *  conversation came from and points at the parent's last visible message. */
  noteFork(parent: Agent) {
    const last = parent.history().findLast((m) => m.from === 'you' || m.from === 'agent')
    this.emit('system', `Continued from #${parent.name}.`, {
      card: this.home ?? undefined,
      forkOf: { convo: parent.name, at: last?.at ?? null, session: parent.sessionId },
    })
  }

  /** #werk-mc-empty-control: the first line of an empty conversation. It records the home
   *  card, so a restart before the first message still knows it. */
  noteEmptyStart() {
    this.emit('system', 'Started empty, with no history.', { card: this.home ?? undefined, emptyStart: true })
  }

  /** The session a fork of this conversation resumes: its own, or — for a fork that has not
   *  sent anything yet — the one it would itself resume. */
  forkSource(): string | null {
    return this.sessionId ?? this.forkFrom
  }

  /** What the pane's context pie shows. */
  context(): Context {
    return { used: this.contextUsed, max: this.contextMax }
  }

  onContext(cb: (c: Context) => void) {
    this.contextListeners.add(cb)
    return () => this.contextListeners.delete(cb)
  }

  /**
   * #ms-store-plan: write the turn that just ended to the pipeline log, priced from its
   * transcript. The CLI may still be flushing the transcript when the result arrives, so the
   * write waits a moment. A failure costs the record of one turn, never the conversation; the
   * backfill can still add it later.
   */
  private recordTurn(session: string | null) {
    if (!session) return
    const endedAt = Date.now()
    const dir = transcriptDir(this.cwd)
    const home = this.home
    setTimeout(() => {
      try {
        recordTurn(session, home, endedAt, { dir })
      } catch (err) {
        console.error(`werk: the cost of a turn of ${this.name} was not recorded: ${(err as Error).message}`)
      }
    }, RECORD_DELAY_MS).unref?.()
  }

  private persistSettings() {
    writeSettings(this.dir, { model: this.model, advisor: this.advisor, context: this.context() })
  }

  private notifyContext() {
    for (const cb of this.contextListeners) cb(this.context())
  }

  /**
   * Drops the stored session and the visible transcript, so the next turn starts a
   * conversation the model has never seen. The map is untouched — only the chat forgets.
   */
  clearContext() {
    if (this.busy) throw new Error('wait for the current turn to finish before clearing the context')
    clearSession(this.dir)
    this.sessionId = null
    // A forked conversation that has never sent its own first message has no session file
    // yet — `forkFrom` is the only record of what it would resume. Leaving it set meant
    // "clear" before that first message did nothing: the next send still forked the parent.
    this.forkFrom = null
    if (existsSync(this.chatPath)) rmSync(this.chatPath)
    this.contextUsed = 0
    this.persistSettings()
    this.notifyContext()
    if (!this.proc) return
    this.switching = true
    this.switchLabel = ''
    this.proc.kill()
  }

  onMessage(cb: (m: ChatMessage) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onDelta(cb: (d: { id: string; from: string; text: string; turn?: string }) => void) {
    this.deltaListeners.add(cb)
    return () => this.deltaListeners.delete(cb)
  }

  onStatus(cb: (s: Status) => void) {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  /** What the pane's permanent bottom-of-chat line shows while this runs. #werk-mc-bgagents. */
  background(): BackgroundTask[] {
    return this.bg
  }

  onBackground(cb: (t: BackgroundTask[]) => void) {
    this.backgroundListeners.add(cb)
    return () => this.backgroundListeners.delete(cb)
  }

  /** Persisted. The transcript keeps this. */
  private emit(from: ChatMessage['from'], text: string, extra: Partial<ChatMessage> = {}) {
    const turn = this.turns[0]
    const message: ChatMessage = { at: new Date().toISOString(), from, text, ...(turn ? { turn } : {}), ...extra }
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(this.chatPath, JSON.stringify(message) + '\n')
    for (const cb of this.listeners) cb(message)
  }

  /** Ephemeral. Deltas go to open panes only; the final block is persisted separately. */
  private delta(id: string, from: string, text: string) {
    const turn = this.turns[0]
    for (const cb of this.deltaListeners) cb({ id, from, text, ...(turn ? { turn } : {}) })
  }

  /** The child is gone, so no open turn will get its end line. Each one gets the exit as
   *  its end instead — an empty done line — and a held message is dropped with its turn. */
  private endTurns() {
    const open = this.turns
    const running = this.turns.length > this.queue.length
    this.turns = []
    this.queue = []
    // #werk-chat-turn-id-exit-queued: the pane tells a turn that started from one that never did.
    open.forEach((turn, i) => {
      const started = running && i === 0
      this.emit('system', started ? 'The agent exited before the reply ended.' : 'The agent exited before this message got an answer.', { done: true, turn })
    })
  }

  private setStatus(next: Status) {
    this.status = next
    for (const cb of this.statusListeners) cb(next)
  }

  /** Where this conversation is now: the card of its last turn, or `home` if it never sent
   *  one. #werk-mc-follow reads this to move the map when a tab gets focus. */
  at(): string | null {
    const h = this.history()
    for (let i = h.length - 1; i >= 0; i--) if (h[i].card) return h[i].card!
    return this.home
  }

  history(): ChatMessage[] {
    if (!existsSync(this.chatPath)) return []
    return readFileSync(this.chatPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatMessage)
      .slice(-200)
  }

  private start() {
    if (this.proc) return
    // The transcript on screen must match what the agent remembers, so a restart resumes.
    const stored = this.fresh ? null : readSession(this.dir)
    this.fresh = false
    // #werk-mc-fork: a conversation that has never run resumes its fork parent instead of
    // starting empty. Once it has its own stored session, every later restart resumes that
    // one — forkFrom only ever applies to the very first start.
    const forking = !stored && this.forkFrom
    const resume = stored ?? this.forkFrom
    this.resumedFrom = resume
    this.sawInit = false

    const args = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      // #werk-agent-instructions, #werk-agent-subagents: in a project that is not werk, the
      // werk instructions and the subagents they name come too. #st-build-howto-titles: so do
      // the titles of the project's build rules, read from the map at launch.
      ...instructionArgs(this.cwd, SYSTEM, buildRulesFor('chat', join(this.dir, 'log.jsonl'))),
      ...(resume ? ['--resume', resume, ...(forking ? ['--fork-session'] : [])] : []),
      '--model',
      this.model,
      ...(this.advisor ? ['--advisor', this.advisor] : []),
      '--permission-mode',
      PERMISSION_MODE,
      // The CLI decides first, with its own engine. Only what it cannot resolve comes back
      // to werk, as a can_use_tool control request on stdout. See #werk-perm-native.
      '--permission-prompt-tool',
      PROMPT_TOOL,
      ...(this.dirs.length ? ['--add-dir', ...this.dirs] : []),
      // Last, because it takes a variadic list. Anything after it would be swallowed.
      '--allowedTools',
      ...this.allow,
    ]
    this.stderr = new StderrLog()
    const proc = this.spawnChild('claude', args, { cwd: this.cwd })
    this.proc = proc

    createInterface({ input: proc.stdout }).on('line', (line) => this.handle(line))
    proc.stderr.on('data', (d) => {
      // Keep all of it. When the child dies the pane must say why, not just "code 1".
      this.stderr.add(String(d))
      process.stderr.write(`[agent] ${d}`)
    })
    proc.on('error', (err) => this.emit('system', `Could not start claude: ${err.message}`))
    proc.on('exit', (code) => {
      // stop() lets go of the child at once, so a send can start a new one before this
      // exit arrives. A newer child owns the state now: this late exit only ends the stop.
      if (this.proc && this.proc !== proc) {
        this.stopping = false
        return
      }
      this.proc = null
      this.busy = false
      this.setStatus({ state: 'idle' })
      // Every request id belonged to the child that just died. Answering one now would
      // write a control_response into a closed pipe, and the bar would sit there for a
      // turn nobody is running. Clearing them empties the bar instead — this conversation's
      // asks only; the queue is shared with every other tab. #werk-mc-asks.
      this.asks.clear(this.name)
      // The child that was running any background task is gone with it.
      if (this.bg.length) {
        this.bg = []
        for (const cb of this.backgroundListeners) cb(this.bg)
      }

      // A model switch or a context clear kills the child on purpose. The restart picks
      // up either the same session or a fresh one, so this is not a crash and needs none
      // of the messaging below.
      if (this.switching) {
        this.switching = false
        if (this.switchLabel) this.emit('system', this.switchLabel)
        this.switchLabel = ''
        this.start()
        return
      }

      // #werk-mc-reap or an interrupt killed this on purpose, or the server is shutting
      // down. Either way there is nothing to report and nothing to retry — the session is on
      // disk, and the next message to this conversation starts a plain, unremarkable resume.
      if (this.stopping) {
        this.stopping = false
        this.inflight = null
        this.endTurns()
        return
      }

      // Only this message means the session is really gone. Any other early crash must
      // leave the id alone: throwing away a working conversation costs more than a retry.
      if (resume && /No conversation found with session ID/i.test(this.stderr.text())) {
        clearSession(this.dir)
        this.emit('system', `Session ${resume.slice(0, 8)} is gone. Starting a new one.`)
        this.replay()
        return
      }

      this.emit('system', `The agent stopped (code ${code}).`)
      // The whole message, not a tail. The cause is usually in the first line, and a
      // result bubble folds the rest away instead of truncating it.
      const said = this.stderr.text().trim()
      if (said) this.emit('result', said, { error: true })

      // One automatic retry. The session id stays, so the retry resumes as normal.
      // A failure that will repeat, such as a login problem, is not worth retrying.
      // #werk-crashmsg-early-exit: only an exit before init is early. After the agent named its
      // session it may have run a tool or an edit, so a second run could do that twice.
      if (this.inflight && !this.sawInit && !this.retried && !FATAL.test(said)) {
        this.retried = true
        this.emit('system', 'Retrying once.')
        this.replay()
        return
      }
      // Two endings, two sentences. A FATAL failure was never retried, so only a fix helps
      // (#werk-fullerr). Anything else already had its one retry (#werk-crashmsg).
      if (this.inflight) {
        // #werk-fullerr-undelivered: every stop of a send ends with the same line.
        this.emit('system', 'Your message was not delivered. Send it again.')
      }
      // #werk-mc-live: a background death must surface the same way an ask does, not
      // wait for someone to notice a dot on an unfocused tab. A child that crashes between
      // turns is dead too: the switch and the stop above are the only exits on purpose.
      this.dead = true
      this.endTurns()
      this.setStatus({ state: 'dead' })
      this.inflight = null
    })
  }

  /** Send the turn that was in flight when the child died. */
  private replay() {
    const text = this.inflight
    this.inflight = null
    if (text) this.write(text)
  }

  /** Translate the stream-json output into the few message kinds the pane shows. */
  private handle(line: string) {
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      return
    }

    // The CLI could not decide this call by itself. It is blocked until we write the
    // answer back with the same request_id.
    if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
      this.permission(String(e.request_id), e.request)
      return
    }

    if (e.type === 'system' && e.subtype === 'init') {
      this.sessionId = e.session_id
      this.sawInit = true
      // #werk-mc-live-dead: the mark stays until the next child starts, so a child that starts
      // with no message (an un-park) must say it is no longer dead.
      const wasDead = this.dead
      this.dead = false
      if (wasDead && !this.busy) this.setStatus({ state: 'idle' })
      // Fork only ever applies once: the session file this writes is what the next start()
      // finds and resumes normally, and `forking` above already stopped reading forkFrom
      // once `stored` exists.
      this.forkFrom = null
      writeSession(this.dir, e.session_id)
      this.emit(
        'system',
        this.resumedFrom
          ? `Resumed session ${e.session_id.slice(0, 8)}.`
          : `New session ${e.session_id.slice(0, 8)}.`,
      )
      return
    }

    if (e.type === 'system' && e.subtype === 'status') {
      if (e.status === 'requesting') this.setStatus({ state: 'thinking', tokens: this.tokens })
      return
    }

    // The CLI's own snapshot of what is still running outside this turn. It replaces the
    // whole list rather than patching it, so this is the one event worth reading — a task
    // dropped off it is done, whatever `task_updated`/`task_notification` say about why.
    if (e.type === 'system' && e.subtype === 'background_tasks_changed') {
      // An event with no list leaves the count as it is — #werk-mc-live-bgcount-list-event.
      if (!Array.isArray(e.tasks)) return
      this.bg = e.tasks.map((t: any) => ({
        id: String(t.task_id),
        type: String(t.task_type ?? ''),
        description: String(t.description ?? ''),
      }))
      for (const cb of this.backgroundListeners) cb(this.bg)
      return
    }

    // The live path. Everything here is ephemeral and arrives token by token.
    if (e.type === 'stream_event') {
      const ev = e.event
      if (ev.type === 'message_start') {
        this.msgId = ev.message?.id ?? String(Date.now())
        this.opened = []
        return
      }
      if (ev.type === 'content_block_start') {
        const kind = ev.content_block?.type
        const from: ChatMessage['from'] = kind === 'thinking' ? 'thinking' : kind === 'tool_use' ? 'tool' : 'agent'
        const id = `${this.msgId}:${ev.index}`
        this.blocks.set(ev.index, { id, from })
        this.opened.push({ index: ev.index, from, claimed: false })
        // Only a tool call is worth a bubble before any text arrives: the name is useful.
        if (kind === 'tool_use') {
          this.setStatus({ state: 'running', detail: ev.content_block.name, tokens: this.tokens })
          this.delta(id, from, `${ev.content_block.name} `)
        } else if (kind === 'thinking') {
          this.setStatus({ state: 'thinking', tokens: this.tokens })
        } else if (kind === 'text') {
          // #werk-chat-status-writing: a text block is neither thinking nor a tool call.
          this.setStatus({ state: 'writing', tokens: this.tokens })
        }
        return
      }
      if (ev.type === 'content_block_delta') {
        const block = this.blocks.get(ev.index)
        if (!block) return
        const d = ev.delta ?? {}
        const text = d.text ?? d.thinking ?? d.partial_json ?? ''
        if (text) this.delta(block.id, block.from, text)
        return
      }
      if (ev.type === 'content_block_stop') {
        this.blocks.delete(ev.index)
        return
      }
      if (ev.type === 'message_delta') {
        this.tokens += ev.usage?.output_tokens ?? 0
        this.setStatus({ ...this.status, tokens: this.tokens })
        return
      }
      return
    }

    // The authoritative path. Each block replaces whatever streamed under the same id.
    if (e.type === 'assistant') {
      // Each assistant message is one API call; a turn with several tool calls makes
      // several. `usage` here is that one call's own tokens — the closest thing to the
      // conversation's real size. (The 'result' event's modelUsage is a trap: it sums
      // every call the turn made, so ten tool calls can report 10x the context in use.)
      const usage = e.message?.usage
      if (usage) {
        this.contextUsed =
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
        this.notifyContext()
      }
      const id = e.message?.id ?? this.msgId
      for (const block of e.message?.content ?? []) {
        const from: ChatMessage['from'] =
          block.type === 'thinking' ? 'thinking' : block.type === 'tool_use' ? 'tool' : 'agent'
        const text =
          block.type === 'text'
            ? (block.text ?? '').trim()
            : block.type === 'thinking'
              ? (block.thinking ?? '').trim()
              : label(block)
        const key = this.claim(id, from)
        // An empty block streamed no bubble, so there is nothing to replace or show.
        if (!text) continue
        this.emit(from, text, { id: key })
      }
      return
    }

    if (e.type === 'user') {
      for (const block of e.message?.content ?? []) {
        if (block.type !== 'tool_result') continue
        const parts = typeof block.content === 'string' ? [{ type: 'text', text: block.content }] : (block.content ?? [])
        const text = parts
          .map((c: any) => (c.type === 'image' ? '(image)' : (c.text ?? '')))
          .join('\n')
          .trim()
        // A tool that returns nothing needs no bubble. Silence is the result.
        if (!text) continue
        // The CLI reports a picked AskUserQuestion answer as `is_error: true` too, since the
        // wire behavior is still `deny` (#werk-mc-askqa) — answeredAsks overrides that so the
        // log does not paint an answer as a failure.
        const answered = typeof block.tool_use_id === 'string' && this.answeredAsks.delete(block.tool_use_id)
        this.emit('result', text.slice(0, 4000), { error: block.is_error === true && !answered })
      }
      this.setStatus({ state: 'thinking', tokens: this.tokens })
      return
    }

    if (e.type === 'result') {
      // A child that dies before init reports an error result and then exits. That is not
      // a finished turn: keep the payload so the exit handler can retry it.
      if (!this.sawInit) return

      this.busy = false
      this.inflight = null
      this.retried = false
      this.blocks.clear()
      this.opened = []
      const seconds = Math.round((e.duration_api_ms ?? 0) / 100) / 10
      const cost = e.total_cost_usd ? ` · $${e.total_cost_usd.toFixed(3)}` : ''
      this.emit('system', `${seconds}s · ${this.tokens} tokens${cost}`, { done: true })
      this.recordTurn(e.session_id ?? this.sessionId)
      this.turns.shift()
      // modelUsage sums every API call the turn made, so it is no good for "how full is
      // the context" — ten tool calls would report ten times the real size. It is the
      // right source for contextWindow, though: that number doesn't change call to call.
      // With an advisor, modelUsage lists the advisor too, and it can come first with a
      // smaller window. Read the entry of the model this conversation runs on.
      const entries = Object.entries<any>(e.modelUsage ?? {})
      const base = this.model.replace(/\[.*\]$/, '')
      const mine = entries.find(([k]) => k.replace(/\[.*\]$/, '') === base) ?? entries[0]
      if (mine?.[1]?.contextWindow) this.contextMax = mine[1].contextWindow
      this.persistSettings()
      this.notifyContext()
      this.setStatus({ state: 'idle' })
      const next = this.queue.shift()
      if (next) this.write(next)
      return
    }
  }

  /**
   * Put one `can_use_tool` request in front of the human, then answer it.
   *
   * The CLI has already run its own engine and given up, so there is nothing left for werk
   * to classify. It only names the call, offers the CLI's own suggestion as the "always"
   * button, and writes the verdict back.
   */
  private async permission(requestId: string, request: any) {
    const tool = String(request.tool_name ?? '')
    const input = (request.input ?? {}) as Record<string, unknown>
    const ask: Ask = {
      id: requestId,
      at: new Date().toISOString(),
      tool,
      label: describeCall(tool, input),
      input,
      reason: typeof request.decision_reason_type === 'string' ? request.decision_reason_type : undefined,
      always: alwaysFrom(request.permission_suggestions),
      // #werk-mc-asks: one shared queue for every conversation, so the bar must name whose
      // turn is waiting.
      convo: this.name,
    }

    const { decision, message } = await this.asks.put(ask)
    appendAsk(ask, decision, message)

    if (decision === 'deny') {
      // interrupt: false ends this one call, not the turn. The model sees the denial as a
      // tool result and can say something about it, which is more use than silence.
      // `message`, when the pane sent one, is a picked AskUserQuestion answer rather than a
      // denial — see #werk-mc-askqa.
      if (message !== undefined && typeof request.tool_use_id === 'string') {
        this.answeredAsks.add(request.tool_use_id)
      }
      this.respond(requestId, {
        behavior: 'deny',
        message: message ?? 'You denied this in the map. Do not try it again this turn.',
        interrupt: false,
      })
      return
    }

    const updates: PermissionUpdate[] = []
    if (decision === 'always' && ask.always) {
      // Session scope, whatever the CLI proposed. A suggestion at localSettings would write
      // into .claude/settings.local.json, which werk shares with Eryk's own Claude Code
      // sessions in this repository. werk's own allow.json is the right place for a rule
      // clicked in werk's own bar.
      for (const update of ask.always.updates) updates.push({ ...update, destination: 'session' })
      const rules = ask.always.updates.flatMap(ruleStrings)
      const dirs = ask.always.updates.flatMap(dirStrings)
      addAlways({ rules, dirs })
      for (const rule of rules) if (!this.allow.includes(rule)) this.allow.push(rule)
      for (const dir of dirs) if (!this.dirs.includes(dir)) this.dirs.push(dir)
    }

    this.respond(requestId, {
      behavior: 'allow',
      // Unchanged. werk never rewrites a call it is only approving — the model asked for
      // this exact command, and editing it behind the model's back would make the tool
      // result answer a question nobody asked.
      updatedInput: input,
      ...(updates.length ? { updatedPermissions: updates } : {}),
    })
  }

  /** One `control_response` on stdin, carrying the request id the CLI is waiting on. */
  private respond(requestId: string, response: unknown) {
    this.proc?.stdin.write(
      JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) +
        '\n',
    )
  }

  /** The id of the streamed bubble this finished block belongs to. */
  private claim(msgId: string, from: ChatMessage['from']): string {
    const slot = this.opened.find((b) => !b.claimed && b.from === from)
    if (!slot) {
      // A block that never streamed. Record it as claimed, so the next one in the same
      // message gets its own key — a text block and a tool call must not share a bubble.
      const key = `${msgId}:x${this.opened.length}`
      this.opened.push({ index: -1, from, claimed: true })
      return key
    }
    slot.claimed = true
    return `${msgId}:${slot.index}`
  }

  private write(text: string) {
    this.start()
    this.inflight = text
    this.busy = true
    this.tokens = 0
    this.setStatus({ state: 'thinking', tokens: 0 })
    this.proc!.stdin.write(
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n',
    )
  }

  /**
   * Send one turn. The full card description is prepended only when the open card changed.
   * Every other turn still gets a one-line tag, never nothing — see #werk-card-blind. A turn
   * dropped from context by compaction, or a session resumed after the card last changed,
   * must never leave the agent unable to name what is open.
   */
  send(text: string, card?: string, images: string[] = [], turn: string = randomUUID()) {
    let payload = text
    // #werk-chat-fresh-agent-card: the last card heard belongs to one agent. With no child
    // running, this turn starts a new one, which has heard no card yet.
    if (!this.proc) this.lastCard = null
    // The Read tool opens an image file, so a path is all the agent needs. The token
    // tells it where in the message each image belongs.
    if (images.length > 0) {
      const list = images.map((p, i) => `[Image #${i + 1}] = ${p}`).join('\n')
      payload = `${list}\n\nOpen each image above with Read before you answer.\n\n${payload}`
    }
    if (card) {
      payload = `${card === this.lastCard ? tag(card) : describe(card)}\n\n${payload}`
      this.lastCard = card
    }
    this.emit('you', text, { card, images: images.length ? images : undefined, turn })
    this.turns.push(turn)
    if (this.busy) this.queue.push(payload)
    else this.write(payload)
  }

  /**
   * #werk-mc-park-unpark: start a child now, on the stored session, when none runs. A conversation
   * with no stored session starts nothing: its first message starts a fresh child.
   */
  resumeNow() {
    if (this.proc || this.fresh || !readSession(this.dir)) return
    this.start()
  }

  /** True while a `claude` child is running for this conversation. #werk-mc-reap only has
   *  something to kill when this is true. */
  hasChild(): boolean {
    return this.proc !== null
  }

  stop() {
    // Only a live child's death needs silencing. Setting this with no proc to kill would
    // never be cleared by an exit event, and would wrongly swallow the next real crash.
    if (this.proc) this.stopping = true
    this.proc?.stdin.end()
    this.proc?.kill()
    this.proc = null
  }
}

/**
 * Failures a retry cannot fix. Sending the same turn again only doubles the wait and the
 * noise, so the pane reports these once and stops.
 */
const FATAL = /auth login|not logged in|invalid api key|credential|is invalid\. Allowed choices/i

/**
 * A child's stderr, kept whole — #werk-fullerr: the cause is usually in the first line, so a
 * tail loses it. Only a runaway child that writes past the cap loses its middle: the first
 * and the last half-cap stay, with a line that says how much was cut.
 */
export class StderrLog {
  private head = ''
  private tail = ''
  private cut = 0
  // A plain field, not a parameter property: Node strips types and cannot run one.
  private readonly cap: number
  constructor(cap = 256_000) {
    this.cap = cap
  }

  add(chunk: string) {
    const half = this.cap / 2
    if (this.head.length < half) {
      const room = half - this.head.length
      this.head += chunk.slice(0, room)
      chunk = chunk.slice(room)
    }
    if (!chunk) return
    this.tail += chunk
    if (this.tail.length > half) {
      this.cut += this.tail.length - half
      this.tail = this.tail.slice(-half)
    }
  }

  text(): string {
    if (!this.cut) return this.head + this.tail
    return `${this.head}\n… ${this.cut} characters cut …\n${this.tail}`
  }
}

/** One line naming a tool call: the tool, then the first line of the first non-empty input
 *  field among command, file_path, path, pattern, url, query and description. A line over
 *  80 characters is cut to 79 and ends with an ellipsis. #werk-chat-tool-summary. */
function label(block: any): string {
  const input = block.input ?? {}
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
    const v = input[key]
    if (typeof v !== 'string') continue
    const line = v.split('\n').find((l) => l.trim())?.trim()
    if (!line) continue
    const text = `${block.name} ${line}`
    return text.length > 80 ? `${text.slice(0, 79)}\u2026` : text
  }
  return String(block.name ?? '')
}

/** #vi-home-howwhat: the page sends this in place of a card id when the home is open. */
const HOME = '~home'
const HOME_LINE = `Home — the requirements under #${WHAT} and the build rules under #${HOW}`

/** A one-line reminder of the open card, cheap enough to send on every turn. */
function tag(id: string): string {
  if (id === HOME) return `[still on ${HOME_LINE}]`
  const n = foldLog('chat pane: card line').nodes.get(id)
  return n ? `[still on #${id} — "${n.title}"]` : `[still on #${id}]`
}

/** A compact description of the open card, from the map itself. #werk-chat-card-block-layout:
 *  one labelled line per fact, in a fixed order, and a fact the card lacks is left out. */
function describe(id: string): string {
  if (id === HOME) return `[the map is now at ${HOME_LINE}]`
  const g = foldLog('chat pane: card line')
  const n = g.nodes.get(id)
  // #werk-chat-unknown-card: the turn still goes out, and says the map holds no such card.
  if (!n) return `[the map is now at #${id} \u2014 the map holds no card with this id]`
  const named = (x: string) => `#${x} \u2014 ${g.nodes.get(x)?.title ?? ''}`
  const kids = g.edges.filter((e) => e.type === 'refines' && e.to === id).map((e) => e.from)
  const deps = g.edges.filter((e) => e.type === 'depends_on' && e.from === id).map((e) => e.to)
  const status = n.proposed ? 'proposed' : n.status
  const lines = [
    `[the map is now at #${id} \u2014 ${n.title}]`,
    `kind: ${n.kind}${status ? ` \u00b7 status: ${status}` : ''}${n.who ? ` \u00b7 who: ${n.who}` : ''}`,
    n.why ? `why: ${n.why}` : '',
    kids.length ? `children: ${kids.map(named).join('; ')}` : '',
    deps.length ? `depends on: ${deps.map(named).join('; ')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}
