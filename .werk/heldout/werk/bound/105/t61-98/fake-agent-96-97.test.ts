import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

type Line = { at: number; event: { type?: string; [k: string]: unknown } }

/** Starts `claude` by its real name in the project and collects its stdout lines with arrival times. */
function startAgent(p: Project, args: string[] = ['-p', 'go'], opts: { input?: boolean; onLine?: (l: Line, send: (m: unknown) => void) => void } = {}) {
  const proc = Bun.spawn(['claude', ...args], { cwd: p.dir, env: p.env, stdin: opts.input ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const lines: Line[] = []
  const send = (m: unknown) => {
    const sink = proc.stdin as unknown as { write: (s: string) => void; flush: () => void }
    sink.write(JSON.stringify(m) + '\n')
    sink.flush()
  }
  const done = (async () => {
    let rest = ''
    for await (const chunk of proc.stdout) {
      const parts = (rest + new TextDecoder().decode(chunk)).split('\n')
      rest = parts.pop()!
      for (const raw of parts.filter(Boolean)) {
        const l = { at: performance.now(), event: JSON.parse(raw) }
        lines.push(l)
        opts.onLine?.(l, send)
      }
    }
    const code = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    return { code, stderr }
  })()
  return { proc, lines, send, done }
}

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const answer = (id: string, behavior: 'allow' | 'deny') => ({
  type: 'control_response',
  response: { subtype: 'success', request_id: id, response: behavior === 'allow' ? { behavior, updatedInput: {} } : { behavior, message: 'no' } },
})
const toolCall = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } } }
const final = { event: { type: 'result', subtype: 'success', result: 'done' } }

test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  p.scriptAgent({
    steps: [{ event: { type: 'first' } }, { edit: { path: 'notes/plan.md', content: 'the plan\n' } }, { event: { type: 'second' } }],
    exit: 0,
  })
  const seen: { type: string; exists: boolean; content?: string }[] = []
  const file = join(p.dir, 'notes/plan.md')
  const a = startAgent(p, ['-p', 'go'], {
    onLine: (l) => seen.push({ type: String(l.event.type), exists: existsSync(file), content: existsSync(file) ? readFileSync(file, 'utf8') : undefined }),
  })
  const { code } = await a.done
  expect(seen.map((s) => s.type)).toEqual(['first', 'second'])
  expect(seen[0]!.exists).toBe(false)
  expect(seen[1]!.exists).toBe(true)
  expect(seen[1]!.content).toBe('the plan\n')
  expect(code).toBe(0)
})

test('96.2 the fake agent exits with the exit code of its script after the last step', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }, { event: { type: 'two' } }], exit: 3 })
  const proc = Bun.spawn(['claude', '-p', 'go'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  const lines = out.split('\n')
  expect(lines.filter(Boolean).map((l) => JSON.parse(l).type)).toEqual(['one', 'two'])
  // nothing after the second event: the output ends with that line
  expect(out.endsWith(JSON.stringify({ type: 'two' }) + '\n')).toBe(true)
  expect(code).toBe(3)
})

function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(e.parentPath, e.name)
    if (e.isFile()) out.set(path, statSync(path).mtimeMs)
  }
  return out
}

test('96.3 an edit that leads outside the project fails and writes nothing there', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'x' } }], exit: 0 })
  const parent = dirname(p.dir)
  const before = snapshot(parent)
  const proc = Bun.spawn(['claude', '-p', 'go'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  expect(code).not.toBe(0)
  expect(stderr).toMatch(/outside the project/)
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  const after = snapshot(parent)
  // the launch log and bun's own transpile cache under HOME aside, nothing outside the project changed
  const changed = [...after].filter(([f, m]) => !f.startsWith(p.dir + '/') && before.get(f) !== m && !f.endsWith('agent-launches.jsonl') && !f.includes('/Library/Caches/'))
  expect(changed).toEqual([])
})

test('96.4 two launches are recorded in order with their arguments', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }], exit: 0 })
  for (const req of ['first request', 'second request']) {
    const proc = Bun.spawn(['claude', '-p', req], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  }
  const launches = p.agentLaunches()
  expect(launches.length).toBe(2)
  expect(launches[0]).toContain('first request')
  expect(launches[1]).toContain('second request')
})

test('96.5 the fake agent refuses to run when no script is installed', async () => {
  const p = makeProject()
  const proc = Bun.spawn(['claude', '-p', 'go'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  expect(code).not.toBe(0)
  expect(err).toMatch(/no script is installed/)
  expect(out).toBe('')
})

const STREAM = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json']

test('97.1 a pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ ask: { id: 'r1', tool: 'Bash' } }, { sleep: 100 }, toolCall, final] })
  const a = startAgent(p, STREAM, { input: true })
  a.send(user('go'))
  // no answer is sent; watch the output for a while
  await Bun.sleep(1500)
  const types = a.lines.map((l) => l.event.type)
  a.proc.kill()
  await a.done
  expect(types[0]).toBe('control_request')
  expect(types).toContain('assistant')
  const req = a.lines.find((l) => l.event.type === 'control_request')!
  const call = a.lines.find((l) => l.event.type === 'assistant')!
  expect(call.at - req.at).toBeGreaterThanOrEqual(100)
  expect(types).not.toContain('result')
})

test('97.2 an answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ ask: { id: 'r1', tool: 'Bash' } }, toolCall, final] })
  let sentAt = 0
  const a = startAgent(p, STREAM, {
    input: true,
    onLine: (l, send) => {
      if (l.event.type === 'assistant') {
        setTimeout(() => {
          sentAt = performance.now()
          send(answer('r1', 'allow'))
        }, 50)
      }
    },
  })
  a.send(user('go'))
  const deadline = Date.now() + 5000
  while (!a.lines.some((l) => l.event.type === 'result') && Date.now() < deadline) await Bun.sleep(20)
  a.proc.kill()
  await a.done
  const types = a.lines.map((l) => l.event.type)
  expect(types.slice(0, 2)).toEqual(['control_request', 'assistant'])
  const result = a.lines.find((l) => l.event.type === 'result')
  expect(result).toBeDefined()
  expect(sentAt).toBeGreaterThan(0)
  expect(result!.at).toBeGreaterThan(sentAt)
})

test('97.3 with no input channel the open ask is denied at the end of the turn', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ ask: { id: 'r1', tool: 'Bash' } }, toolCall, final] })
  const proc = Bun.spawn(['claude', '-p', 'go', '--output-format', 'stream-json'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const events = out.trim().split('\n').map((l) => JSON.parse(l))
  expect(events.map((e) => e.type)).toEqual(['control_request', 'assistant', 'user', 'result'])
  const denial = events[2].message.content[0]
  expect(denial.is_error).toBe(true)
  expect(denial.content).toMatch(/denied/)
})

test('97.4 a crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ ask: { id: 'r1', tool: 'Bash' } }, { crash: 1 }] })
  const a = startAgent(p, STREAM, { input: true })
  a.send(user('go'))
  const { code } = await a.done
  const types = a.lines.map((l) => l.event.type)
  expect(types).toContain('control_request')
  expect(code).not.toBeNull()
  const toolResults = a.lines.filter((l) => JSON.stringify(l.event).includes('tool_result'))
  expect(toolResults).toEqual([])
  expect(types).not.toContain('result')
})

test('97.5 a scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ ask: { id: 'r1', tool: 'Bash' } }, { sleep: 100 }, toolCall, final] })
  const a = startAgent(p, STREAM, { input: true })
  a.send(user('go'))
  const deadline = Date.now() + 5000
  while (a.lines.length < 2 && Date.now() < deadline) await Bun.sleep(5)
  a.proc.kill()
  await a.done
  const [req, next] = a.lines
  expect(req!.event.type).toBe('control_request')
  expect(next!.at - req!.at).toBeGreaterThanOrEqual(120)
  expect(next!.event.type).toBe('assistant')
})
