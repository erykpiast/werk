/**
 * Several conversations at once. See #werk-multichat.
 *
 * Each conversation is its own `Agent`, forked at a card and living in its own directory —
 * `.werk/conversations/<name>/{session,chat.jsonl}`, or `.werk` itself for the one named
 * `main` (see convos.ts). One `Asks` queue is shared by every agent this manager holds;
 * each ask names its conversation, and the pane shows it only on that tab — #werk-mc-asks.
 *
 * Parking a conversation does not stop its child. A sweep kills the child of a conversation
 * that has stayed parked and untouched for `reapMs` — #werk-mc-reap.
 *
 * An agent is created lazily: forking makes one immediately, but a conversation that only
 * exists on disk from a previous server run is not reconstructed until something asks for
 * it by name. Its child process is not started until the first message is sent — the same
 * laziness `Agent.start()` already had for `main`.
 */
import { mkdirSync } from 'node:fs'
import { Agent, type Context, type SpawnChild } from './agent.ts'
import { Asks } from './permission.ts'
import { describeConvoDisk, listConvos, MAIN } from './convos.ts'
import { dirFor, nameForCard } from './convo-names.ts'

/** #werk-mc-reap: how long a parked conversation may sit untouched before its child is
 *  killed. "A start, not a defended value." */
export const REAP_MS = 30 * 60_000

/** #werk-cli-serve: an environment value for a duration. Only a positive whole number counts;
 *  anything else is ignored, so the defaults of #werk-mc-reap-sweep hold. */
export function wholeMs(v: string | undefined): number | undefined {
  return v && /^[1-9]\d*$/.test(v) ? Number(v) : undefined
}

export class ConvoManager {
  asks = new Asks()
  private agents = new Map<string, Agent>()
  private cwd: string
  private allow?: string[]
  private fresh: boolean
  private spawnListeners = new Set<(agent: Agent) => void>()
  private spawnChild?: SpawnChild
  /** Parked conversations, and when each was last touched. #werk-mc-reap. */
  private parked = new Map<string, number>()
  private reapMs: number
  private sweeper: ReturnType<typeof setInterval>

  constructor(
    cwd: string,
    allow?: string[],
    fresh = false,
    opts: { reapMs?: number; checkMs?: number; spawnChild?: SpawnChild } = {},
  ) {
    this.cwd = cwd
    this.allow = allow
    this.fresh = fresh
    this.spawnChild = opts.spawnChild
    this.reapMs = opts.reapMs ?? REAP_MS
    // Checking once a minute is fine against 30; a test's few milliseconds check at their
    // own pace. unref: the sweep alone must never keep the process alive.
    this.sweeper = setInterval(() => this.sweep(), opts.checkMs ?? Math.min(this.reapMs, 60_000))
    this.sweeper.unref?.()
  }

  /** Called once for every agent this manager ever creates, including `main`. Wire up
   *  per-conversation broadcast here — see server.ts. */
  onSpawn(cb: (agent: Agent) => void) {
    this.spawnListeners.add(cb)
    return () => this.spawnListeners.delete(cb)
  }

  private spawn(name: string, home: string | null, forkFrom: string | null, initialContext?: Context): Agent {
    const dir = dirFor(name)
    mkdirSync(dir, { recursive: true })
    const agent = new Agent(this.cwd, this.allow, name === MAIN ? this.fresh : false, this.asks, {
      name,
      dir,
      home,
      forkFrom,
      initialContext,
      spawnChild: this.spawnChild,
    })
    // Anything the conversation says or does counts as a touch, so a parked tab still
    // finishing a background agent is not swept the moment it goes quiet.
    agent.onMessage(() => this.touch(name))
    agent.onStatus(() => this.touch(name))
    agent.onBackground(() => this.touch(name))
    this.agents.set(name, agent)
    for (const cb of this.spawnListeners) cb(agent)
    return agent
  }

  /** The conversation every reference implicitly means before a fork exists. */
  main(): Agent {
    return this.agents.get(MAIN) ?? this.spawn(MAIN, null, null)
  }

  /** A live agent by name, or one rebuilt from its own directory on disk — its session file
   *  is what a restart resumes, no different from `main` resuming across a server restart. */
  ensure(name: string): Agent {
    const live = this.agents.get(name)
    if (live) return live
    if (name === MAIN) return this.main()
    const disk = describeConvoDisk(name)
    if (!disk) throw new Error(`no conversation named "${name}"`)
    return this.spawn(name, disk.home, disk.forkFrom ?? null)
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name)
  }

  list(): Agent[] {
    return [...this.agents.values()]
  }

  /**
   * Fork `from`'s current session into a new conversation rooted at `atCard`. #werk-mc-fork:
   * `--fork-session` is the child's own launch flag, applied on this new agent's first
   * start — see Agent.start().
   */
  fork(from: string, atCard: string): Agent {
    const parent = this.ensure(from)
    const source = parent.forkSource()
    if (!source) throw new Error(`#${from} has no conversation yet — send it a message first`)
    // A folder from an earlier server run holds a session too. Reusing its name would resume
    // that old conversation instead of forking this one.
    const taken = new Set([...this.agents.keys(), ...listConvos().map((c) => c.name)])
    const name = nameForCard(atCard, taken)
    const child = this.spawn(name, atCard, source, parent.context())
    // #werk-mc-fork-notice: the fork runs on the parent's model, not the default. The child
    // has no process yet, so setModel only records it for the first start.
    const { model, advisor } = parent.modelSetting()
    child.setModel(model, advisor)
    child.noteFork(parent)
    return child
  }

  /** #werk-mc-empty-control: a new conversation at `atCard` with no parent session. Its
   *  first message starts a session with no history. */
  startEmpty(atCard: string): Agent {
    const taken = new Set([...this.agents.keys(), ...listConvos().map((c) => c.name)])
    const child = this.spawn(nameForCard(atCard, taken), atCard, null)
    child.noteEmptyStart()
    return child
  }

  /** #werk-mc-park, #werk-mc-close: parking hides a tab. It does not kill the child — the
   *  sweep does that once the conversation has sat parked and untouched for `reapMs`. */
  park(name: string) {
    this.parked.set(name, Date.now())
  }

  /** The tab is back on the strip. A live child is no longer a sweep target and is kept as it
   *  is. A conversation whose child was stopped gets one now, on its stored session, so it is
   *  ready before the person types (#werk-mc-park-unpark). */
  unpark(name: string) {
    this.parked.delete(name)
    this.agents.get(name)?.resumeNow()
  }

  isParked(name: string): boolean {
    return this.parked.has(name)
  }

  /** Restart a parked conversation's idle clock. A no-op for a visible one. */
  private touch(name: string) {
    if (this.parked.has(name)) this.parked.set(name, Date.now())
  }

  /**
   * #werk-mc-reap: kill the child of every conversation parked and untouched for `reapMs`.
   * A running turn is never parked, but this checks anyway — and leaves a background agent
   * or an open ask alone too, since either still needs the child. The session id stays on
   * disk, so the next message resumes it with `--resume` (#werk-resume).
   */
  sweep(now = Date.now()) {
    const waiting = new Set(this.asks.open().map((a) => a.convo))
    for (const [name, since] of this.parked) {
      if (now - since < this.reapMs) continue
      const agent = this.agents.get(name)
      if (!agent?.hasChild() || agent.busy || agent.background().length || waiting.has(name)) continue
      agent.stop()
    }
  }

  /** Cut a running turn short. The session is on disk, so the next message resumes it. */
  interrupt(name: string) {
    this.agents.get(name)?.stop()
  }

  stopAll() {
    clearInterval(this.sweeper)
    for (const agent of this.agents.values()) agent.stop()
  }
}
