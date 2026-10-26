/**
 * The per-option build runner. See #al-sample-proto-agent.
 *
 * The unit is an **option**, not a sample: a fork clusters N plan-rung samples into two or
 * three choices, and this builds exactly one artifact per choice, in parallel. The fan-out
 * lives here, in code, not in nested subagents — the prototyper agent picks the tier per
 * option and calls this once; it does not spawn a subagent per option itself.
 *
 * Two tiers, picked per option per #al-sample-build-isolation, extended from a sample to a
 * built option:
 *   - 'output'   the option only produces an artifact from the checkout as it stands. A
 *                private scratch directory, no git operation at all.
 *   - 'worktree' the option must change tracked files. A throwaway git worktree per
 *                #al-ephem, diffed to a `.patch` and removed afterward — always, even on a
 *                timeout or an error.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProcessProbe } from './overseer.ts'
import { frozenNote } from './overseer-text.ts'
import { buildRulesFor } from './build-rules.ts'
import { agentEnv, instructionArgs, modelArgs } from './instructions.ts'
import type { AgentRole } from './instructions.ts'
import { tokensOf, type Tokens } from './cost.ts'
import { sessionTree, transcriptDir } from './cost-history.ts'

export type ForkOption = { label: string; brief: string }
export type Fork = { field: string; options: ForkOption[] }

export type PrototypeResult = {
  label: string
  /** The scratch directory this option's artifact (if any) was told to land in. Survives
   *  worktree removal — it is never inside the worktree itself. */
  artifactDir: string
  /** Set only when the tier was 'worktree' and the diff was non-empty. */
  patchPath?: string
  error?: string
}

const TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']
/** #al-sample-proto-agent's own default in its CLI sketch. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/** No-questions contract, shared with sample.ts's in spirit: a headless build cannot stop at
 *  a question, so it must pick and say so instead. */
const BUILD_CONTRACT = `You are building one option of a fork, so a human can compare it against the other options for the same decision. You may not ask a question, and you may not use AskUserQuestion. If the brief leaves something open, pick a reasonable reading and say so in one short line at the end of your answer — do not stop to ask.`

function outputContract(dir: string): string {
  return `${BUILD_CONTRACT}\n\nYou may write to exactly one path: ${dir} — it already exists and is yours alone. Everything else in this checkout is read-only: do not create, edit, or delete anything at any other path. Build the option's artifact and leave it inside that path.`
}

function worktreeContract(worktreeDir: string, artifactDir: string): string {
  return `${BUILD_CONTRACT}\n\nThis checkout at ${worktreeDir} is a disposable git worktree made only for this option. Edit and write its tracked files directly — that is expected and safe. Your changes will be captured as a diff and this worktree deleted afterward, so nothing here is permanent. If the brief also wants a rendered file or a screenshot, save it to ${artifactDir} instead of inside the worktree, so it survives the worktree's removal.`
}

export function runGit(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', (e) => resolve({ code: -1, stdout, stderr: e.message }))
    proc.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** One headless `claude -p` build. Returns an error string, or undefined on a clean exit. */
async function runClaude(cwd: string, brief: string, contract: string, timeoutMs: number, logPath: string): Promise<string | undefined> {
  return (await runHeadless(cwd, `${contract}\n\nBrief:\n${brief}`, { timeoutMs, logPath, role: 'prototyper' })).error
}

/**
 * #lp-prod-judge-read-only: the arguments that make `tools` the whole tool set of a session.
 * `--tools` names the only built-in tools that exist; `--restricted` ignores the user, project
 * and local settings files, so no allow rule there widens the list; `--strict-mcp-config`
 * loads no MCP server. With no permission prompt tool, the runtime refuses every call that
 * `--allowedTools` does not allow, and no ask reaches the overseer.
 */
export function onlyToolArgs(tools: string[]): string[] {
  const names = [...new Set(tools.map((t) => t.replace(/\(.*$/, '')))]
  return ['--restricted', '--strict-mcp-config', '--tools', names.join(',')]
}

/** What one headless session gave back. `result`, `costUsd` and `turns` come from the final
 *  `result` event of the stream. */
export type HeadlessResult = {
  error?: string
  stdout: string
  result?: string
  costUsd?: number
  /** The whole session's tokens by kind, from the same event (#vi-flow-ms-stage-unit). */
  tokens?: Tokens
  turns?: number
  /** The session's id, from the result event. */
  sessionId?: string
  /** The responses the cost covers, and the subagents and forks among them (#ms-cost-tree). */
  responses?: number
  subagents?: number
  /** The overseer cancelled it: no event for `silenceMs` (#lp-overseer-silence). */
  silent?: boolean
  /** The caller's signal cancelled it. */
  stopped?: boolean
}

/**
 * The session's cost counts every subagent and fork it started, not only its main thread
 * (#ms-cost-tree). The result event holds the main thread, so the sum comes from the
 * transcripts. A session whose transcripts are gone keeps the figure of the result event.
 */
function addTree(out: HeadlessResult, cwd: string): void {
  if (!out.sessionId) return
  let tree
  try {
    tree = sessionTree(transcriptDir(realpathSync(cwd)), out.sessionId)
  } catch {
    return
  }
  if (!tree || (tree.subagents === 0 && out.costUsd !== undefined)) return
  out.costUsd = Math.max(tree.costUsd, out.costUsd ?? 0)
  out.tokens = tree.tokens
  out.responses = tree.responses
  out.subagents = tree.subagents
}

/** A permission ask the agent made, and the overseer's answer (#lp-overseer-asks). */
export type AskAnswer = { allow: boolean; message: string }
export type OnAsk = (ask: { tool: string; input: Record<string, unknown> }) => Promise<AskAnswer>

/** How the overseer reads a tool call that is still running (#lp-overseer-inflight). */
export type InflightWatch = {
  probe: ProcessProbe
  /** No CPU change in the call's process tree and no new line on the stream for this long: the
   *  call is frozen. */
  flatMs: number
  /** How often the probe samples while a call runs. */
  everyMs: number
}

/** The most stretches of the wall-clock cap that one session gets (#lp-overseer-cap-extend). */
export const MAX_STRETCHES = 3

/** One headless `claude -p` run, shared with the build loop (src/loop.ts) and the planner.
 *
 * It runs with `--output-format stream-json --verbose`. Every line of the stream is appended
 * to `logPath` the moment it arrives, so a reader can tail the file for a live view, and is
 * handed to `onEvent`. The final `result` event gives the answer, the cost and the turns.
 *
 * Three things end a session early, each a parameter so a test can set it to milliseconds:
 * the wall-clock cap `timeoutMs`, `silenceMs` with no new event (#lp-overseer-silence,
 * #st-build-silence-act), and `signal`.
 *
 * Two overseer parts are optional:
 *
 * - `inflight`: a tool call that started and has no result yet is not silence. The probe
 *   reads its process tree instead; CPU time that stays flat for `flatMs`, with no new line on
 *   the stream in that time, means frozen, and
 *   the call's processes are killed. The agent gets the kill as the call's result and goes
 *   on. A frozen call with no process of its own is silence after all. A probe that cannot
 *   read the process table proves nothing: the sample is skipped, and the wall-clock cap is
 *   the stop (#lp-overseer-psfail). At the end the session records its probe counts.
 * - `onAsk`: the session runs with `--permission-prompt-tool stdio`, and every `can_use_tool`
 *   request is answered by `onAsk`.
 *
 * With either part on, the prompt goes in on stdin as stream-json, where the answers go too.
 * With `inflight` on, werk also registers a PostToolUse and a PostToolUseFailure hook in the
 * `initialize` control request: the CLI asks werk about each finished call, and for a call werk
 * killed the answer is the evidence, as `additionalContext` on the call's result.
 *
 * Every overseer act is a `werk_overseer` line in the same event stream: an ask, a frozen
 * call, a silence cancel, a wall-clock cancel (#lp-overseer-mechanics). */
export function runHeadless(
  cwd: string,
  prompt: string,
  opts: {
    timeoutMs: number
    logPath: string
    /** The job of this agent, in its environment (#st-build-seam-role-env). */
    role: AgentRole
    tools?: string[]
    /** The tool list is the whole tool set: no other tool exists in the session, whatever the
     *  settings files allow. A judge reads only (#lp-prod-judge-read-only). */
    onlyTools?: boolean
    extraArgs?: string[]
    onEvent?: (event: any) => void
    silenceMs?: number
    signal?: AbortSignal
    env?: Record<string, string>
    inflight?: InflightWatch
    /** Asked when the wall-clock cap is reached: the reason to run another stretch, or nothing
     *  to end the session (#lp-overseer-cap-extend). */
    moreTime?: () => string | undefined
    onAsk?: OnAsk
    /** Append the werk agent instructions to the system prompt (#werk-agent-instructions). */
    instructions?: boolean
  },
): Promise<HeadlessResult> {
  const { timeoutMs, logPath } = opts
  return new Promise((resolve) => {
    try {
      writeFileSync(logPath, '')
    } catch {
      // A log write failing must not hide the build's own result.
    }
    if (opts.signal?.aborted) return resolve({ error: 'stopped before it started', stdout: '', stopped: true })
    // An empty tool list is a model call with no tools at all: a classifier, a step author.
    const tools = opts.tools ?? TOOLS
    const toolArgs = tools.length ? [...(opts.onlyTools ? onlyToolArgs(tools) : []), '--allowedTools', ...tools] : ['--tools', '']
    // Prompt first: --allowedTools is variadic and swallows anything after it. With asks on,
    // the prompt goes in on stdin instead, where the answers to the asks go too.
    const stdin = !!(opts.onAsk || opts.inflight)
    const input = stdin ? ['--input-format', 'stream-json', ...(opts.onAsk ? ['--permission-prompt-tool', 'stdio'] : [])] : [prompt]
    // Partial messages stream the model's tokens, a long file write included, so the silence
    // limit sees a model that is still writing (#lp-overseer-silence). They keep it armed and
    // go nowhere else: not to the log, not to onEvent.
    // #st-build-howto-titles: a stage agent gets the project's build-rule titles, with the
    // instructions or alone. The map is the one the agent's own werk command writes to.
    const rules = buildRulesFor(opts.role, opts.env?.WERK_LOG)
    const system = opts.instructions ? instructionArgs(cwd, '', rules) : rules ? ['--append-system-prompt', rules] : []
    const args = ['--print', ...input, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...modelArgs(opts.role), ...system, ...(opts.extraArgs ?? []), ...toolArgs]
    const proc = spawn('claude', args, {
      cwd,
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: agentEnv(opts.role, opts.env),
    })
    const out: HeadlessResult = { stdout: '' }
    let partial = ''
    let err = ''
    let ended: 'timeout' | 'silence' | 'stopped' | undefined
    let silenceWhy: string | undefined
    const end = (why: 'timeout' | 'silence' | 'stopped') => {
      if (ended) return
      ended = why
      proc.kill()
    }
    const record = (event: object) => {
      const e = { type: 'werk_overseer', at: new Date().toISOString(), ...event }
      try {
        appendFileSync(logPath, JSON.stringify(e) + '\n')
      } catch {
        // As below: the log is for a reader, not for the verdict.
      }
      opts.onEvent?.(e)
    }
    const write = (o: object) => {
      if (proc.stdin?.writable) proc.stdin.write(JSON.stringify(o) + '\n')
    }
    // #lp-overseer-mechanics: every overseer act is a werk_overseer line, a cancel included.
    const cancel = (why: 'timeout' | 'silence', event: object) => {
      if (ended) return
      record(event)
      end(why)
    }
    // #lp-overseer-inflight: the hooks that let werk add the evidence to a killed call's result.
    const HOOK = 'werk_frozen'
    if (opts.inflight) {
      const hooks = [{ hookCallbackIds: [HOOK] }]
      write({ type: 'control_request', request_id: 'werk-init', request: { subtype: 'initialize', hooks: { PostToolUse: hooks, PostToolUseFailure: hooks } } })
    }
    if (stdin) write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })

    // The tool calls that started and have no result yet (#lp-overseer-inflight).
    const running = new Map<string, { name: string; input: unknown; at: number }>()
    // #lp-overseer-inflight: the last line on the stream. While a call runs the agent is quiet,
    // so a line is output of the work in flight: a subagent's message, or a new call starting.
    let streamAt = 0
    // The calls werk killed, by tool_use_id, with the note the agent gets as part of the result.
    const killed = new Map<string, string>()
    // #lp-overseer-cap-extend: the cap is a checkpoint. A session that the progress classifier
    // last judged not looping gets another stretch, up to MAX_STRETCHES in all.
    let stretch = 1
    const onCap = () => {
      const why = stretch < MAX_STRETCHES ? opts.moreTime?.() : undefined
      if (why === undefined) return cancel('timeout', { kind: 'timeout', timeoutMs, act: 'cancel the session', ...(stretch > 1 ? { stretches: stretch } : {}) })
      stretch++
      record({ kind: 'extend', stretch, reason: why, act: `run another ${timeoutMs}ms` })
      timer = setTimeout(onCap, timeoutMs)
    }
    let timer = setTimeout(onCap, timeoutMs)
    let silence: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      if (opts.silenceMs === undefined) return
      if (silence) clearTimeout(silence)
      silence = setTimeout(() => {
        // A running call is not silence: the probe decides about it.
        if (opts.inflight && running.size > 0) return arm()
        cancel('silence', { kind: 'silence', silenceMs: opts.silenceMs, act: 'cancel the session' })
      }, opts.silenceMs)
    }
    // #lp-overseer-silence-start: the clock starts at the agent's first event, not at spawn. A
    // start that never ends is still stopped by the wall-clock timer above.

    let probe: ReturnType<typeof setInterval> | undefined
    // #lp-overseer-psfail-metric: every sample the probe took, and the ones that failed.
    const probes = { samples: 0, failed: 0 }
    if (opts.inflight) {
      const w = opts.inflight
      let last: { cpuMs: number; changed: number } | undefined
      let sampling = false
      probe = setInterval(async () => {
        if (running.size === 0 || sampling || ended || proc.pid === undefined) {
          if (running.size === 0) last = undefined
          return
        }
        sampling = true
        try {
          const s = await w.probe.sample(proc.pid)
          probes.samples++
          // #lp-overseer-psfail: a failed read is unknown. It cancels nothing, and the flat
          // window starts again at the next read that works.
          if (s.error !== undefined) {
            probes.failed++
            last = undefined
            const call = [...running.values()].at(-1)
            record({ kind: 'probe-failed', tool: call?.name, error: s.error })
            return
          }
          const now = Date.now()
          if (!last || s.cpuMs !== last.cpuMs || streamAt > last.changed) last = { cpuMs: s.cpuMs, changed: now }
          if (now - last.changed < w.flatMs) return
          const [id, call] = [...running.entries()].at(-1)!
          const evidence = { cpuMs: s.cpuMs, flatMs: now - last.changed, pids: s.pids, runningMs: now - call.at }
          if (s.pids.length === 0) {
            silenceWhy = `a ${call.name} call froze with no process of its own`
            record({ kind: 'frozen', tool: call.name, input: call.input, evidence, act: 'cancel the session' })
            return end('silence')
          }
          record({ kind: 'frozen', tool: call.name, input: call.input, evidence, act: 'kill the call' })
          // Before the kill: the CLI asks the hook as soon as the call ends.
          killed.set(id, frozenNote({ tool: call.name, evidence }))
          for (const pid of s.pids) {
            try {
              process.kill(pid, 'SIGTERM')
            } catch {
              // Gone already.
            }
          }
          last = { cpuMs: s.cpuMs, changed: now }
        } finally {
          sampling = false
        }
      }, w.everyMs)
    }

    const onAbort = () => end('stopped')
    opts.signal?.addEventListener('abort', onAbort)
    const ask = async (requestId: string, request: any) => {
      const tool = String(request?.tool_name ?? '')
      const input = (request?.input ?? {}) as Record<string, unknown>
      const a = await opts.onAsk!({ tool, input })
      record({ kind: 'ask', tool, input, allow: a.allow, comment: a.message })
      const response = a.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: a.message, interrupt: false }
      write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
    }
    /** #lp-overseer-inflight: a finished call. A call werk killed gets the evidence as extra
     *  context on its result; any other call gets an empty answer, so the CLI never waits. */
    const hook = (requestId: string, request: any) => {
      const id = String(request?.tool_use_id ?? request?.input?.tool_use_id ?? '')
      const note = killed.get(id)
      killed.delete(id)
      const event = String(request?.input?.hook_event_name ?? 'PostToolUse')
      const response = note ? { hookSpecificOutput: { hookEventName: event, additionalContext: note } } : {}
      write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
    }
    const line = (text: string) => {
      if (!text.trim()) return
      streamAt = Date.now()
      let event: any
      try {
        event = JSON.parse(text)
      } catch {
        event = undefined
      }
      if (event?.type === 'stream_event') return
      out.stdout += text + '\n'
      try {
        appendFileSync(logPath, text + '\n')
      } catch {
        // As above: the log is for a reader, not for the verdict.
      }
      if (event === undefined) return
      if (event?.type === 'control_request' && event.request?.subtype === 'can_use_tool' && opts.onAsk) {
        void ask(String(event.request_id), event.request)
      }
      if (event?.type === 'control_request' && event.request?.subtype === 'hook_callback' && event.request.callback_id === HOOK) {
        hook(String(event.request_id), event.request)
      }
      const content = Array.isArray(event?.message?.content) ? event.message.content : []
      if (event?.type === 'assistant') {
        for (const c of content) if (c?.type === 'tool_use') running.set(String(c.id), { name: String(c.name), input: c.input, at: Date.now() })
      }
      if (event?.type === 'user') {
        for (const c of content) if (c?.type === 'tool_result') running.delete(String(c.tool_use_id))
      }
      if (event?.type === 'result') {
        out.result = typeof event.result === 'string' ? event.result : undefined
        out.costUsd = event.total_cost_usd
        if (event.usage) out.tokens = tokensOf(event.usage)
        out.turns = event.num_turns
        if (typeof event.session_id === 'string') out.sessionId = event.session_id
        if (event.is_error) out.error = out.result || event.subtype || 'the agent reported an error'
        // With input on stdin the CLI waits for the next turn; there is none.
        proc.stdin?.end()
      }
      opts.onEvent?.(event)
    }
    proc.stdout!.on('data', (d) => {
      arm()
      partial += d
      const lines = partial.split('\n')
      partial = lines.pop() ?? ''
      for (const l of lines) line(l)
    })
    proc.stderr!.on('data', (d) => (err += d))
    proc.stdin?.on('error', () => {
      // The CLI exited before it read an answer. Its exit says why.
    })
    const finish = () => {
      clearTimeout(timer)
      if (silence) clearTimeout(silence)
      if (probe) clearInterval(probe)
      opts.signal?.removeEventListener('abort', onAbort)
      if (probes.samples > 0) record({ kind: 'probes', ...probes })
    }
    proc.on('error', (e) => {
      finish()
      resolve({ ...out, error: e.message })
    })
    proc.on('exit', (code) => {
      finish()
      if (partial) line(partial)
      addTree(out, cwd)
      if (ended === 'timeout') return resolve({ ...out, error: `killed after ${timeoutMs * stretch}ms wall-clock cap` })
      if (ended === 'silence') return resolve({ ...out, error: silenceWhy ?? `cancelled: no event for ${opts.silenceMs}ms`, silent: true })
      if (ended === 'stopped') return resolve({ ...out, error: 'stopped', stopped: true })
      if (code !== 0) return resolve({ ...out, error: err.trim().slice(-2000) || out.error || `exit ${code}` })
      resolve(out)
    })
  })
}

async function runOutputOption(cwd: string, opt: ForkOption, artifactDir: string, timeoutMs: number): Promise<PrototypeResult> {
  const error = await runClaude(cwd, opt.brief, outputContract(artifactDir), timeoutMs, join(artifactDir, 'agent-events.jsonl'))
  return { label: opt.label, artifactDir, error }
}

async function runWorktreeOption(
  cwd: string,
  opt: ForkOption,
  artifactDir: string,
  worktreeDir: string,
  timeoutMs: number,
): Promise<PrototypeResult> {
  let error: string | undefined
  let patchPath: string | undefined
  const add = await runGit(cwd, ['worktree', 'add', '--detach', worktreeDir, 'HEAD'])
  if (add.code !== 0) {
    return { label: opt.label, artifactDir, error: `git worktree add failed: ${add.stderr.trim().slice(-2000) || add.stdout.trim()}` }
  }
  try {
    error = await runClaude(worktreeDir, opt.brief, worktreeContract(worktreeDir, artifactDir), timeoutMs, join(artifactDir, 'agent-events.jsonl'))
    // Stage everything, including new files, so the patch is the option's whole change —
    // not just what happened to already be tracked before the build ran.
    await runGit(worktreeDir, ['add', '-A'])
    const diff = await runGit(worktreeDir, ['diff', '--cached'])
    if (diff.stdout.trim()) {
      patchPath = join(artifactDir, 'option.patch')
      writeFileSync(patchPath, diff.stdout)
    }
  } finally {
    // #al-ephem: the worktree is always removed, including on a timeout or an error above —
    // never left behind for the next run to trip over.
    const removed = await runGit(cwd, ['worktree', 'remove', '--force', worktreeDir])
    if (removed.code !== 0) {
      try {
        rmSync(worktreeDir, { recursive: true, force: true })
        await runGit(cwd, ['worktree', 'prune'])
      } catch {
        // Best-effort cleanup only; the error already on this result is the one that matters.
      }
    }
  }
  return { label: opt.label, artifactDir, patchPath, error }
}

/** Build every option of one fork, concurrently. #al-sample-proto-agent: one artifact per
 *  option, never one per sample — `fork.options` is already the clustered set. */
export async function prototype(
  cwd: string,
  fork: Fork,
  opts: { tier?: 'output' | 'worktree'; timeoutMs?: number; runId?: string } = {},
): Promise<PrototypeResult[]> {
  const tier = opts.tier ?? 'output'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runId = opts.runId ?? String(Date.now())
  return Promise.all(
    fork.options.map((opt, i) => {
      const artifactDir = join(tmpdir(), `werk-prototype-${runId}-${i}`)
      mkdirSync(artifactDir, { recursive: true })
      if (tier === 'output') return runOutputOption(cwd, opt, artifactDir, timeoutMs)
      const worktreeDir = join(tmpdir(), `werk-prototype-wt-${runId}-${i}`)
      return runWorktreeOption(cwd, opt, artifactDir, worktreeDir, timeoutMs)
    }),
  )
}
