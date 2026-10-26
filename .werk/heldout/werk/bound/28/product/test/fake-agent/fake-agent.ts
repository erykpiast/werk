/**
 * A scripted stand-in for every Claude Code child. It never talks to a model.
 *
 * WERK_FAKE_SCRIPT names a JSON file with an array of steps, run in order:
 *   { "emit": <object> }                     one stream-json line on stdout
 *   { "stderr": "<text>" }                   one line on stderr
 *   { "write": { "path": "...", "text": "..." } }   write a file, relative to the cwd
 *   { "sleep": <ms> }
 *   { "hold": true }                         stay alive until killed
 *   { "exit": <code> }
 * With no script, it emits an init event and a successful result, then exits 0. With no
 * script and `--input-format stream-json`, it is a chat agent like the real one: an init
 * event, then one result per user line on stdin, echoing the text, until stdin closes.
 *
 * WERK_FAKE_CALLS names a file. Each run appends one JSON line: its argv and cwd.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type Step =
  | { emit: unknown }
  | { stderr: string }
  | { write: { path: string; text: string } }
  | { sleep: number }
  | { hold: true }
  | { exit: number }

const INIT = { type: 'system', subtype: 'init', session_id: 'fake-session', model: 'fake' }

const DEFAULT_SCRIPT: Step[] = [
  { emit: INIT },
  { emit: { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 'fake-session' } },
]

const calls = process.env.WERK_FAKE_CALLS
if (calls) appendFileSync(calls, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\n')

const scriptPath = process.env.WERK_FAKE_SCRIPT
const script: Step[] = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : DEFAULT_SCRIPT
const argv = process.argv.slice(2)
const streamInput = argv.includes('--input-format') && argv[argv.indexOf('--input-format') + 1] === 'stream-json'

if (!scriptPath && streamInput) {
  const emit = (event: unknown) => process.stdout.write(JSON.stringify(event) + '\n')
  emit(INIT)
  let buffered = ''
  for await (const chunk of process.stdin) {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop()!
    for (const line of lines.filter(Boolean)) {
      const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content
      emit({ type: 'result', subtype: 'success', is_error: false, result: content, session_id: 'fake-session' })
    }
  }
  process.exit(0)
}

for (const step of script) {
  if ('emit' in step) process.stdout.write(JSON.stringify(step.emit) + '\n')
  else if ('stderr' in step) process.stderr.write(step.stderr + '\n')
  else if ('write' in step) {
    const target = resolve(step.write.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, step.write.text)
  } else if ('sleep' in step) await Bun.sleep(step.sleep)
  else if ('hold' in step) {
    setInterval(() => {}, 1 << 30)
    await new Promise(() => {})
  } else if ('exit' in step) process.exit(step.exit)
}
