#!/usr/bin/env bun
/**
 * A fake `claude` for the pipeline tests. See #st-build-seam.
 *
 * It takes the place of the real binary on the PATH. It reads a script of rules from
 * $FAKE_CLAUDE_SCRIPT, picks the first rule whose `role` is the launch's role and whose `match`
 * fits the prompt and is not used up, and plays it: it writes files and runs shell lines in its
 * working directory, the way a real agent edits a checkout, then prints a scripted event stream
 * in the output format it was asked for. Every call is recorded, so a test can read what each
 * agent was told.
 *
 * The role comes from the launch's environment, never from the prompt (#st-build-seam-role-env).
 * It also sets how long the fake lives (#werk-chat-fake-role): a chat agent plays one rule per
 * message and waits for the next, until its input closes; any other agent plays one rule and
 * exits with its code. A permission answer during a rule is part of that rule, not a new turn.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

export type FakeRule = {
  /** The role this rule answers: the launch's WERK_ROLE (#st-build-seam-role-env). No role
   *  field answers every role. */
  role?: string
  /** A regular expression tested against the prompt. No match field matches every prompt. */
  match?: string
  /** How many calls this rule answers. Unlimited when left out. */
  times?: number
  /** Files to write before any output, relative to the working directory. */
  files?: Record<string, string>
  /** Shell lines run in the working directory after the files are written. */
  sh?: string[]
  /** Events printed before the result event, in stream-json mode. */
  events?: object[]
  /** A pause before the first event: the agent is still starting (#lp-overseer-silence-start). */
  startMs?: number
  /** A pause between two printed events. */
  delayMs?: number
  /** A pause after the events and before the result: the agent goes silent. */
  hangMs?: number
  /** The final answer text. */
  result?: string
  exitCode?: number
  stderr?: string
  /** A tool call that runs as a child process: a tool_use event, then `sh -c` this line, then
   *  a tool_result event, killed or not. Runs before `events`. */
  toolSh?: string
  /** Permission asks, each sent as a `can_use_tool` control request on stdout. The fake waits
   *  for each answer on stdin and prints it as a `fake_ask_answer` event. Needs stdin mode. */
  asks?: Array<{ tool: string; input: Record<string, unknown> }>
}

/** One played rule. A chat agent records one call per message, with its `turn`. */
export type FakeCall = { argv: string[]; prompt: string; cwd: string; rule: number; werkLog?: string; role?: string; turn?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const scriptPath = process.env.FAKE_CLAUDE_SCRIPT
  if (!scriptPath) {
    console.error('fake claude: FAKE_CLAUDE_SCRIPT is not set')
    process.exit(2)
  }
  const argv = process.argv.slice(2)
  const printAt = argv.indexOf('--print')
  // With --input-format stream-json the prompt is the first user message on stdin, and the
  // answers to permission asks follow it there.
  const stdinMode = argv.includes('--input-format')
  const lines: string[] = []
  const waiting: Array<(l: string | undefined) => void> = []
  let closed = false
  if (stdinMode) {
    const rl = createInterface({ input: process.stdin })
    rl.on('line', (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)))
    rl.on('close', () => {
      closed = true
      while (waiting.length) waiting.shift()!(undefined)
    })
  }
  const nextLine = () => new Promise<string | undefined>((r) => (lines.length ? r(lines.shift()) : closed ? r(undefined) : waiting.push(r)))
  let prompt = printAt >= 0 && !stdinMode ? (argv[printAt + 1] ?? '') : ''
  // Hook callbacks the host registered in an `initialize` control request, by hook event.
  const hooks: Record<string, string[]> = {}
  if (stdinMode) {
    let first = JSON.parse((await nextLine()) ?? '{}')
    // The host may open with control requests, `initialize` first; each gets a success answer.
    while (first?.type === 'control_request') {
      for (const [event, matchers] of Object.entries(first.request?.hooks ?? {})) {
        hooks[event] = (matchers as Array<{ hookCallbackIds: string[] }>).flatMap((m) => m.hookCallbackIds)
      }
      process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: first.request_id, response: {} } }) + '\n')
      first = JSON.parse((await nextLine()) ?? '{}')
    }
    prompt = first?.message?.content?.[0]?.text ?? ''
  }
  const formatAt = argv.indexOf('--output-format')
  const format = formatAt >= 0 ? argv[formatAt + 1] : 'text'

  const role = process.env.WERK_ROLE
  if (!role) {
    console.error('fake claude: WERK_ROLE is not set')
    process.exit(2)
  }
  const rules = (JSON.parse(readFileSync(scriptPath, 'utf8')) as { rules: FakeRule[] }).rules
  const statePath = `${scriptPath}.state.json`
  const out = (o: object) => process.stdout.write(JSON.stringify(o) + '\n')

  /** Pick the rule for one prompt and play it. Returns the rule's exit code. */
  const play = async (prompt: string, turn?: number): Promise<number> => {
    const used: number[] = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : []
    const index = rules.findIndex(
      (r, i) =>
        // A rule for reviewer answers reviewer-<area> too, so a script that names no area still
        // answers every reviewer (#st-build-seam-role-env-reviewer-area).
        (r.role === undefined || r.role === role || (role !== undefined && role.startsWith(`${r.role}-`))) &&
        (r.match === undefined || new RegExp(r.match).test(prompt)) &&
        (r.times === undefined || (used[i] ?? 0) < r.times),
    )
    const call: FakeCall = { argv, prompt, cwd: process.cwd(), rule: index, werkLog: process.env.WERK_LOG, ...(role ? { role } : {}), ...(turn ? { turn } : {}) }
    appendFileSync(`${scriptPath}.calls.jsonl`, JSON.stringify(call) + '\n')
    if (index < 0) {
      console.error(`fake claude: no rule matches the role ${role ?? '(none)'} and the prompt: ${prompt.slice(0, 200)}`)
      process.exit(3)
    }
    used[index] = (used[index] ?? 0) + 1
    writeFileSync(statePath, JSON.stringify(used))
    const rule = rules[index]

    // Every path is checked before any file is written, so a bad path writes nothing. An edit
    // lands inside the folder the fake started in, also through a link out of it.
    const root = realpathSync(process.cwd())
    const targets = Object.entries(rule.files ?? {}).map(([path, content]) => {
      const abs = resolve(process.cwd(), path)
      // An absolute path is the script's own choice of place (the plan writers answer in the
      // map folder, beside the repository), so only a relative path is held to the folder.
      if (isAbsolute(path)) return { abs, content }
      let at = abs
      while (!existsSync(at) && dirname(at) !== at) at = dirname(at)
      const real = join(realpathSync(at), abs.slice(at.length))
      if (real !== root && !real.startsWith(root + sep)) {
        console.error(`fake claude: the edit path "${path}" leads outside ${process.cwd()}`)
        process.exit(2)
      }
      return { abs, content }
    })
    for (const { abs, content } of targets) {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    for (const line of rule.sh ?? []) {
      const r = spawnSync('sh', ['-c', line], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
      if (r.status !== 0) console.error(`fake claude: "${line}" exited ${r.status}: ${r.stderr}`)
    }

    const session = `fake-${index}-${used[index]}`
    const result = rule.result ?? 'done'
    const exitCode = rule.exitCode ?? 0
    const final = {
      type: 'result',
      subtype: exitCode === 0 ? 'success' : 'error_during_execution',
      is_error: exitCode !== 0,
      result,
      session_id: session,
      total_cost_usd: 0.01,
      num_turns: 1,
    }

    if (rule.startMs) await sleep(rule.startMs)
    if (format === 'stream-json') {
      out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() })
      for (const [i, a] of (rule.asks ?? []).entries()) {
        out({ type: 'control_request', request_id: `req-${i}`, request: { subtype: 'can_use_tool', tool_name: a.tool, input: a.input } })
        const answer = await nextLine()
        const response = answer ? JSON.parse(answer)?.response?.response : undefined
        appendFileSync(`${scriptPath}.asks.jsonl`, JSON.stringify({ ask: a, response }) + '\n')
        out({ type: 'fake_ask_answer', response })
      }
      if (rule.toolSh) {
        out({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: rule.toolSh } }] } })
        const child = spawn('sh', ['-c', rule.toolSh], { stdio: 'ignore' })
        const sig = await new Promise<string | null>((r) => child.on('exit', (_code, signal) => r(signal)))
        // As the real CLI does: a registered PostToolUse (or, for a failed call, PostToolUseFailure)
        // hook is asked before the result is printed. The answer is printed as `fake_hook_answer`.
        const hookEvent = sig ? 'PostToolUseFailure' : 'PostToolUse'
        for (const id of hooks[hookEvent] ?? []) {
          const input = { hook_event_name: hookEvent, tool_name: 'Bash', tool_input: { command: rule.toolSh }, tool_use_id: 'toolu_1' }
          out({ type: 'control_request', request_id: `hook-${id}`, request: { subtype: 'hook_callback', callback_id: id, input, tool_use_id: 'toolu_1' } })
          const answer = await nextLine()
          out({ type: 'fake_hook_answer', response: answer ? JSON.parse(answer)?.response?.response : undefined })
        }
        out({ type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: !!sig, content: sig ? `killed by ${sig}` : 'ok' }] } })
      }
      for (const e of rule.events ?? []) {
        if (rule.delayMs) await sleep(rule.delayMs)
        out(e)
      }
      if (rule.hangMs) await sleep(rule.hangMs)
      out({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: result }] } })
      out(final)
    } else {
      if (rule.hangMs) await sleep(rule.hangMs)
      if (format === 'json') out(final)
      else process.stdout.write(result + '\n')
    }
    if (rule.stderr) process.stderr.write(rule.stderr)
    return exitCode
  }

  // #werk-chat-fake-role: any agent but a chat agent does one unit of work and exits.
  if (role !== 'chat' || !stdinMode) process.exit(await play(prompt))

  // A chat agent: one rule per message, then wait for the next, until the input closes.
  for (let turn = 1; ; turn++) {
    await play(prompt, turn)
    let next: any
    for (;;) {
      const line = await nextLine()
      if (line === undefined) process.exit(0)
      try {
        next = JSON.parse(line)
      } catch {
        continue
      }
      if (next?.type === 'user') break
      if (next?.type === 'control_request') out({ type: 'control_response', response: { subtype: 'success', request_id: next.request_id, response: {} } })
    }
    prompt = next?.message?.content?.[0]?.text ?? ''
  }
}

if (import.meta.main) await main()
