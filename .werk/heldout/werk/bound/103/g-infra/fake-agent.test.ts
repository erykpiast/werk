/** Held-out steps 96.1 to 96.5 and 97.1 to 97.5: the fake agent. */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runHeadless } from '../../src/build/headless.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'

type Line = { at: number; event: { type: string; [key: string]: unknown } }

/** Starts `claude` in the project and calls onLine for each output line as it arrives. */
function start(p: Project, onLine: (line: Line, send: (m: unknown) => void) => void, opts: { input: boolean; role?: string } = { input: true }) {
  const env = opts.role === undefined ? p.env : { ...p.env, WERK_AGENT_ROLE: opts.role }
  const cmd = opts.input ? ['claude', '--input-format', 'stream-json', '-p'] : ['claude', '-p', 'go']
  const agent = Bun.spawn(cmd, { cwd: p.dir, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const send = (m: unknown) => {
    agent.stdin.write(JSON.stringify(m) + '\n')
    agent.stdin.flush()
  }
  if (opts.input) send({ type: 'user', message: { role: 'user', content: 'go' } })
  else void agent.stdin.end()
  const lines = (async () => {
    const seen: Line[] = []
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of agent.stdout) {
      const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n')
      rest = parts.pop()!
      for (const part of parts.filter(Boolean)) {
        const line = { at: performance.now(), event: JSON.parse(part) }
        seen.push(line)
        onLine(line, send)
      }
    }
    if (rest.trim()) seen.push({ at: performance.now(), event: { type: '__trailing__', raw: rest } })
    return seen
  })()
  const stderr = new Response(agent.stderr).text()
  return { agent, lines, stderr }
}

const ev = (name: string): FakeStep => ({ event: { type: 'note', name } })
const ask: FakeStep = { ask: { id: 'r1', tool: 'Bash', input: { command: 'touch x' } } }
const toolUse: FakeStep = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }
const result: FakeStep = { event: { type: 'result', subtype: 'success' } }
const allow = (id: string) => ({
  type: 'control_response',
  response: { subtype: 'success', request_id: id, response: { behavior: 'allow', updatedInput: {} } },
})

test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ev('first'), { edit: { path: 'notes/plan.md', content: '# Plan\n' } }, ev('second')], exit: 0 })
  const plan = join(p.dir, 'notes/plan.md')
  const at: Record<string, boolean> = {}
  const { agent, lines } = start(p, (l) => (at[l.event.name as string] = existsSync(plan)), { input: false })
  const seen = await lines
  expect(seen.map((l) => l.event.name)).toEqual(['first', 'second'])
  expect(at.first).toBe(false)
  expect(at.second).toBe(true)
  expect(readFileSync(plan, 'utf8')).toBe('# Plan\n')
  expect(await agent.exited).toBe(0)
})

test('96.2 the fake agent exits with the exit code of its script after the last step', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ev('one'), ev('two')], exit: 3 })
  const { agent, lines } = start(p, () => {}, { input: false })
  const seen = await lines
  expect(seen.map((l) => l.event.name)).toEqual(['one', 'two'])
  expect(await agent.exited).toBe(3)
})

function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const path = join(d, f)
      const s = statSync(path)
      if (s.isDirectory()) walk(path)
      else out.set(path, s.mtimeMs)
    }
  }
  walk(dir)
  return out
}

test('96.3 an edit that leads outside the project fails and writes nothing there', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out' } }], exit: 0 })
  const parent = dirname(p.dir)
  // Outside the project: the parent folder, minus the project itself.
  const outside = () => new Map([...snapshot(parent)].filter(([k]) => !k.startsWith(p.dir + '/') && !k.includes('agent-launches') && !k.includes('agent-input') && !k.includes('/Library/Caches/')))
  const before = outside()
  const { agent, lines, stderr } = start(p, () => {}, { input: false })
  await lines
  const code = await agent.exited
  expect(code).not.toBe(0)
  expect(await stderr).toMatch(/outside the project/)
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  expect(outside()).toEqual(before)
})

test('96.4 two launches are recorded in order with their arguments', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [result], exit: 0 })
  const saved = { ...process.env }
  Object.assign(process.env, {
    PATH: p.env.PATH,
    WERK_FAKE_AGENT_SCRIPT: p.env.WERK_FAKE_AGENT_SCRIPT,
    WERK_FAKE_AGENT_LOG: p.env.WERK_FAKE_AGENT_LOG,
    WERK_FAKE_AGENT_INPUT: p.env.WERK_FAKE_AGENT_INPUT,
  })
  try {
    const opts = { cwd: p.dir, role: 'builder', timeoutMs: 20_000, overseer: { silenceMs: 10_000, loopEveryMs: 60_000, classifierTimeoutMs: 5_000 } }
    await runHeadless({ ...opts, prompt: 'first request' })
    await runHeadless({ ...opts, prompt: 'second request' })
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const argv = p.agentLaunches()
  expect(argv).toHaveLength(2)
  // The arguments of each launch: its argv, and the request werk gave it.
  const given = (i: number) => JSON.stringify([argv[i], p.agentInputs()[i]])
  expect(given(0)).toContain('first request')
  expect(given(0)).not.toContain('second request')
  expect(given(1)).toContain('second request')
  // Recorded in argv itself?
  console.log('96.4 argv of launch 1:', JSON.stringify(argv[0]), 'argv has request:', argv[0]!.join(' ').includes('first request'))
})

test('96.5 the fake agent refuses to run when no script is installed', async () => {
  const p = makeProject()
  const { agent, lines, stderr } = start(p, () => {}, { input: false })
  const seen = await lines
  expect(await agent.exited).not.toBe(0)
  expect(await stderr).toMatch(/no script is installed/)
  expect(seen).toEqual([])
})

test('97.1 a pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolUse, result] })
  const { agent, lines } = start(p, (l) => {
    if (l.event.type === 'assistant') setTimeout(() => void agent.kill('SIGKILL'), 400)
  })
  const seen = await lines
  const types = seen.map((l) => l.event.type)
  expect(types[0]).toBe('control_request')
  expect(types[1]).toBe('assistant')
  expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(100)
  expect(types).not.toContain('result')
})

test('97.2 an answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolUse, result] })
  let sentAt = 0
  const { agent, lines } = start(p, (l, send) => {
    if (l.event.type === 'assistant') {
      sentAt = performance.now()
      send(allow('r1'))
    }
  })
  const seen = await lines
  expect(await agent.exited).toBe(0)
  const types = seen.map((l) => l.event.type)
  expect(types.slice(0, 2)).toEqual(['control_request', 'assistant'])
  const final = seen.find((l) => l.event.type === 'result')
  expect(final).toBeDefined()
  expect(final!.at).toBeGreaterThanOrEqual(sentAt)
})

test('97.3 with no input channel the open ask is denied at the end of the turn', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolUse, result] })
  const { agent, lines } = start(p, () => {}, { input: false })
  const seen = await lines
  expect(await agent.exited).toBe(0)
  expect(seen.map((l) => l.event.type)).toEqual(['control_request', 'assistant', 'user', 'result'])
  const content = (seen[2]!.event.message as { content: { tool_use_id: string; is_error?: boolean }[] }).content[0]!
  expect(content).toMatchObject({ tool_use_id: 'r1', is_error: true })
})

test('97.4 a crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { crash: 1 }, toolUse, result] })
  const { agent, lines } = start(p, () => {})
  const seen = await lines
  const code = await agent.exited
  expect(code).not.toBe(0)
  const types = seen.map((l) => l.event.type)
  expect(types[0]).toBe('control_request')
  const toolResults = seen.filter((l) => l.event.type === 'user')
  expect(toolResults).toEqual([])
  expect(types).not.toContain('result')
})

test('97.5 a scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolUse, result] })
  const { agent, lines } = start(p, (l, send) => {
    if (l.event.type === 'assistant') send(allow('r1'))
  })
  const seen = await lines
  await agent.exited
  expect(seen[0]!.event.type).toBe('control_request')
  expect(seen[1]!.event.type).toBe('assistant')
  expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(120)
})
