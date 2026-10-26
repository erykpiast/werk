/** Held-out steps 96.x and 97.x: the fake agent, driven by its real name in a harness project. */
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'

type Line = { at: number; event: { type: string; [k: string]: unknown }; onDisk?: boolean }

/** Starts `claude` in the project, reads its output line by line, and calls onLine at the moment each line arrives. */
function start(p: Project, args: string[], opts: { input?: boolean; onLine?: (l: Line, send: (m: unknown) => void) => void } = {}) {
  const agent = Bun.spawn(['claude', ...args], { cwd: p.dir, env: p.env, stdin: opts.input ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const send = (m: unknown) => {
    const stdin = agent.stdin as unknown as { write: (s: string) => void; flush: () => void }
    stdin.write(JSON.stringify(m) + '\n')
    stdin.flush()
  }
  const seen: Line[] = []
  const lines = (async () => {
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of agent.stdout) {
      const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n')
      rest = parts.pop()!
      for (const part of parts) {
        const line: Line = { at: performance.now(), event: JSON.parse(part) }
        seen.push(line)
        opts.onLine?.(line, send)
      }
    }
    if (rest.trim() !== '') seen.push({ at: performance.now(), event: { type: '__partial__', raw: rest } })
    return seen
  })()
  const stderr = new Response(agent.stderr).text()
  return { agent, lines, send, stderr, seen }
}

const userMessage = (content: string) => ({ type: 'user', message: { role: 'user', content } })
const ask: FakeStep = { ask: { id: 'r1', tool: 'Bash', input: { command: 'touch x' } } }
const toolCall: FakeStep = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }
const final: FakeStep = { event: { type: 'result', subtype: 'success' } }
const allow = (id: string) => ({
  type: 'control_response',
  response: { subtype: 'success', request_id: id, response: { behavior: 'allow', updatedInput: {} } },
})
const isToolResult = (l: Line) =>
  l.event.type === 'user' && JSON.stringify(l.event).includes('"tool_result"')

test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  const file = join(p.dir, 'notes', 'plan.md')
  p.scriptAgent({
    steps: [{ event: { type: 'first' } }, { edit: { path: 'notes/plan.md', content: '# The plan\n' } }, { event: { type: 'second' } }],
    exit: 0,
  })
  const { agent, lines } = start(p, ['-p', 'go'], {
    onLine: (l) => {
      l.onDisk = existsSync(file)
      if (l.onDisk) l.event.content = readFileSync(file, 'utf8')
    },
  })
  const seen = await lines
  expect(seen.map((l) => l.event.type)).toEqual(['first', 'second'])
  expect(seen[0]!.onDisk).toBe(false)
  expect(seen[1]!.onDisk).toBe(true)
  expect(seen[1]!.event.content).toBe('# The plan\n')
  expect(await agent.exited).toBe(0)
})

test('96.2 the fake agent exits with the exit code of its script after the last step', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }, { event: { type: 'two' } }], exit: 3 })
  const { agent, lines } = start(p, ['-p', 'go'])
  const seen = await lines
  expect(await agent.exited).toBe(3)
  // Nothing after the second event: the output holds exactly the two events, in order.
  expect(seen.map((l) => l.event.type)).toEqual(['one', 'two'])
})

test('96.3 an edit that leads outside the project fails and writes nothing there', async () => {
  const p = makeProject()
  const parent = dirname(p.dir)
  const snapshot = () => {
    const out: Record<string, number> = {}
    // HOME is this folder: Library/Caches/bun is the Bun runtime's own compile cache, not a file the edit writes.
    for (const f of readdirSync(parent)) if (f !== 'project' && f !== 'Library') out[f] = statSync(join(parent, f)).mtimeMs
    return out
  }
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out\n' } }], exit: 0 })
  const before = snapshot()
  const { agent, lines, stderr } = start(p, ['-p', 'go'])
  await lines
  const code = await agent.exited
  expect(code).not.toBe(0)
  expect(await stderr).toMatch(/outside the project/)
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  // The launch log is the harness's own record, outside the project; every other file stays as it was.
  const after = snapshot()
  delete before['agent-launches.jsonl']
  delete after['agent-launches.jsonl']
  expect(after).toEqual(before)
})

test('96.4 two launches are recorded in order with their arguments', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }], exit: 0 })
  expect(p.run(['claude', '-p', 'first request']).code).toBe(0)
  expect(p.run(['claude', '-p', 'second request']).code).toBe(0)
  const launches = p.agentLaunches()
  expect(launches).toHaveLength(2)
  expect(launches[0]).toContain('first request')
  expect(launches[1]).toContain('second request')
})

test('96.5 the fake agent refuses to run when no script is installed', () => {
  const p = makeProject()
  const r = p.run(['claude', '-p', 'go'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/no script is installed/)
  expect(r.stdout).toBe('')
})

test('97.1 a pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall, final] })
  const toolSeen = Promise.withResolvers<void>()
  const { agent, lines, send, seen } = start(p, ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p'], {
    input: true,
    onLine: (l) => {
      if (l.event.type === 'assistant') toolSeen.resolve()
    },
  })
  send(userMessage('go'))
  await toolSeen.promise
  // No answer goes out. The ask stays open for half a second more.
  await Bun.sleep(500)
  const types = seen.map((l) => l.event.type)
  expect(agent.exitCode).toBeNull()
  expect(types[0]).toBe('control_request')
  expect(types).toContain('assistant')
  expect(types).not.toContain('result')
  agent.kill('SIGKILL')
  await lines
})

test('97.2 an answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, final] })
  let sentAt = 0
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], {
    input: true,
    onLine: (l, s) => {
      if (l.event.type === 'assistant') {
        sentAt = performance.now()
        s(allow('r1'))
      }
    },
  })
  send(userMessage('go'))
  const seen = await lines
  expect(await agent.exited).toBe(0)
  const types = seen.map((l) => l.event.type)
  expect(types.slice(0, 2)).toEqual(['control_request', 'assistant'])
  const result = seen.find((l) => l.event.type === 'result')
  expect(result).toBeDefined()
  expect(sentAt).toBeGreaterThan(0)
  expect(result!.at).toBeGreaterThanOrEqual(sentAt)
})

test('97.3 with no input channel the open ask is denied at the end of the turn', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, final] })
  const { agent, lines } = start(p, ['-p', 'go'])
  const seen = await lines
  expect(await agent.exited).toBe(0)
  const types = seen.map((l) => l.event.type)
  expect(types[0]).toBe('control_request')
  expect(types).toContain('assistant')
  const denial = seen.findIndex((l) => isToolResult(l) && JSON.stringify(l.event).includes('"is_error":true'))
  expect(denial).toBeGreaterThan(types.indexOf('assistant'))
  const result = types.indexOf('result')
  expect(result).toBeGreaterThan(denial)
})

test('97.4 a crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { crash: 1 }, toolCall, final] })
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], { input: true })
  send(userMessage('go'))
  const seen = await lines
  const code = await agent.exited
  expect(code).not.toBeNull()
  const types = seen.map((l) => l.event.type)
  expect(types[0]).toBe('control_request')
  expect(seen.some(isToolResult)).toBe(false)
  expect(types).not.toContain('result')
})

test('97.5 a scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall, final] })
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], {
    input: true,
    onLine: (l, s) => {
      if (l.event.type === 'assistant') s(allow('r1'))
    },
  })
  send(userMessage('go'))
  const seen = await lines
  await agent.exited
  expect(seen[0]!.event.type).toBe('control_request')
  expect(seen[1]!.event.type).toBe('assistant')
  expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(120)
})
