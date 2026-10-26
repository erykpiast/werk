/**
 * A stand-in for the `claude` CLI, put first on PATH by setup.ts. It speaks just enough of
 * `--input-format stream-json` / `--output-format stream-json` for agent.ts to run a turn,
 * and records what it was asked so a test can read it back.
 *
 * Steered by environment variables, read at spawn time:
 *
 *   FAKE_CLAUDE_LOG      file: one JSON line per launch ({argv}) and per stdin line ({stdin})
 *   FAKE_CLAUDE_MODE     ok (default) | crash | gone | ask | hang
 *                          ok    init, then one assistant reply and a result per user turn
 *                          crash read one turn, write FAKE_CLAUDE_STDERR, exit 1, no init
 *                          gone  with --resume: "No conversation found with session ID", exit 1;
 *                                without it: ok
 *                          ask   per user turn, one can_use_tool request; the answer is logged,
 *                                then the turn ends with a result
 *                          hang  init, then never finish a turn
 *   FAKE_CLAUDE_SESSION  the session id init reports (default sess-<pid>)
 *   FAKE_CLAUDE_STDERR   what crash writes (default "boom")
 *   FAKE_CLAUDE_SUGGEST  JSON permission_suggestions for ask mode
 *
 * Launched with `--print <prompt>` and no stream-json input — the way sample.ts and
 * prototype.ts call it — it logs the launch and exits 0 with no output.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
const env = process.env
const record = (entry: unknown) => {
  if (env.FAKE_CLAUDE_LOG) appendFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify(entry) + '\n')
}
const out = (event: unknown) => process.stdout.write(JSON.stringify(event) + '\n')

record({ argv, pid: process.pid })

if (!argv.includes('--input-format')) process.exit(0)

const resume = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : null
let mode = env.FAKE_CLAUDE_MODE ?? 'ok'
if (mode === 'gone' && !resume) mode = 'ok'
const session = env.FAKE_CLAUDE_SESSION ?? `sess-${process.pid}`

if (mode !== 'crash' && mode !== 'gone') {
  out({ type: 'system', subtype: 'init', session_id: session })
}

let turn = 0
let waitingFor: string | null = null

const finish = () =>
  out({
    type: 'result',
    duration_api_ms: 1200,
    total_cost_usd: 0.001,
    // Summed over every call of the turn — ten times what one call used. agent.ts must
    // read context from the assistant event's usage instead (#werk-test-behaviours-agent 8).
    modelUsage: { fake: { inputTokens: 999999, outputTokens: 99999, contextWindow: 1000000 } },
  })

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  record({ stdin: msg })

  if (msg.type === 'control_response') {
    if (waitingFor && msg.response?.request_id === waitingFor) {
      waitingFor = null
      finish()
    }
    return
  }
  if (msg.type !== 'user') return
  turn++

  if (mode === 'crash') {
    process.stderr.write(env.FAKE_CLAUDE_STDERR ?? 'boom')
    process.exit(1)
  }
  if (mode === 'gone') {
    process.stderr.write(`No conversation found with session ID: ${resume}`)
    process.exit(1)
  }
  if (mode === 'hang') return

  const id = `msg-${turn}`
  if (mode === 'ask') {
    waitingFor = `req-${process.pid}-${turn}`
    out({
      type: 'control_request',
      request_id: waitingFor,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'curl example.com' },
        tool_use_id: `tool-${turn}`,
        permission_suggestions: env.FAKE_CLAUDE_SUGGEST ? JSON.parse(env.FAKE_CLAUDE_SUGGEST) : undefined,
      },
    })
    return
  }

  const text = msg.message?.content?.[0]?.text ?? ''
  out({
    type: 'assistant',
    message: {
      id,
      content: [{ type: 'text', text: `echo ${text.split('\n').pop()}` }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 400 },
    },
  })
  finish()
})
