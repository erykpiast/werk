/** 96.1–96.5 and 97.1–97.5: the scripted fake agent. Run from the repo root, with the unit test preload. */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'

type Line = { at: number; event: Record<string, unknown> }

/** Starts the agent by its real name in the project, and calls `onLine` as each line arrives. */
function start(p: Project, args: string[], onLine: (line: Line, send: (m: unknown) => void) => void = () => {}, input = false, role?: string) {
  const env = role === undefined ? p.env : { ...p.env, WERK_AGENT_ROLE: role }
  const agent = Bun.spawn(['claude', ...args], { cwd: p.dir, env, stdin: input ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const send = (m: unknown) => {
    if (!input) return
    const stdin = agent.stdin as unknown as { write: (s: string) => void; flush: () => void }
    stdin.write(JSON.stringify(m) + '\n')
    stdin.flush()
  }
  const lines = (async () => {
    const seen: Line[] = []
    const dec = new TextDecoder()
    let rest = ''
    for await (const chunk of agent.stdout) {
      const parts = (rest + dec.decode(chunk, { stream: true })).split('\n')
      rest = parts.pop()!
      for (const part of parts) {
        const line = { at: performance.now(), event: JSON.parse(part) as Record<string, unknown> }
        seen.push(line)
        onLine(line, send)
      }
    }
    if (rest.trim() !== '') seen.push({ at: performance.now(), event: { unparsed: rest } })
    return seen
  })()
  const stderr = new Response(agent.stderr).text()
  return { agent, lines, send, stderr }
}

const ev = (name: string): FakeStep => ({ event: { type: 'system', name } })
const ask: FakeStep = { ask: { id: 'r1', tool: 'Bash', input: { command: 'touch x' } } }
const toolUse: FakeStep = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }
const result: FakeStep = { event: { type: 'result', subtype: 'success' } }
const userMessage = (content: string) => ({ type: 'user', message: { role: 'user', content } })
const allow = (id: string) => ({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'allow', updatedInput: {} } } })
const isAsk = (l: Line) => l.event.type === 'control_request'
const isToolUse = (l: Line) => l.event.type === 'assistant'
const isResult = (l: Line) => l.event.type === 'result'
const isToolResult = (l: Line) => l.event.type === 'user'

test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ev('first'), { edit: { path: 'notes/plan.md', content: '# the plan\n' } }, ev('second')], exit: 0 })
  const plan = join(p.dir, 'notes/plan.md')
  const seenAt: Record<string, string | null> = {}
  const { agent, lines } = start(p, ['-p', 'go'], (l) => {
    const name = l.event.name as string
    seenAt[name] = existsSync(plan) ? readFileSync(plan, 'utf8') : null
  })
  const all = await lines
  expect(all.map((l) => l.event.name)).toEqual(['first', 'second'])
  expect(seenAt.first).toBeNull()
  expect(seenAt.second).toBe('# the plan\n')
  expect(await agent.exited).toBe(0)
})

test('96.2 the fake agent exits with the exit code of its script after the last step', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ev('one'), ev('two')], exit: 3 })
  const { agent, lines } = start(p, ['-p', 'go'])
  const all = await lines
  expect(all.map((l) => l.event.name)).toEqual(['one', 'two'])
  expect(await agent.exited).toBe(3)
})

test('96.3 an edit that leads outside the project fails and writes nothing there', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out' } }], exit: 0 })
  const parent = dirname(p.dir)
  const before = readdirSync(parent).toSorted()
  const { agent, lines, stderr } = start(p, ['-p', 'go'])
  await lines
  const code = await agent.exited
  const err = await stderr
  expect(code).not.toBe(0)
  expect(err).toContain('outside the project')
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  // Bun's own cache under HOME (the harness root) is not the edit's doing; nothing else may appear.
  expect(readdirSync(parent).filter((f) => f !== 'Library').toSorted()).toEqual(before)
})

test('96.4 two launches are recorded in order with their arguments', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ev('only')], exit: 0 })
  for (const request of ['first request', 'second request']) {
    const { agent, lines } = start(p, ['-p', request])
    await lines
    expect(await agent.exited).toBe(0)
  }
  const launches = p.agentLaunches()
  expect(launches).toHaveLength(2)
  expect(launches[0]).toContain('first request')
  expect(launches[1]).toContain('second request')
})

test('96.5 the fake agent refuses to run when no script is installed', async () => {
  const p = makeProject()
  const { agent, lines, stderr } = start(p, ['-p', 'go'])
  const all = await lines
  expect(await agent.exited).not.toBe(0)
  expect(await stderr).toContain('no script is installed')
  expect(all).toEqual([])
})

test('97.1 a pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolUse, result] })
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], () => {}, true)
  send(userMessage('go'))
  // Wait well past the pause, with no answer sent.
  await Bun.sleep(1500)
  agent.kill('SIGKILL')
  const all = await lines
  const askAt = all.findIndex(isAsk)
  const toolAt = all.findIndex(isToolUse)
  expect(askAt).toBeGreaterThanOrEqual(0)
  expect(toolAt).toBeGreaterThan(askAt)
  expect(all[toolAt]!.at - all[askAt]!.at).toBeGreaterThanOrEqual(100)
  expect(all.some(isResult)).toBe(false)
})

test('97.2 an answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolUse, result] })
  let sentAt = 0
  let toolSeen = false
  let askSeen = false
  const { agent, lines, send } = start(
    p,
    ['--input-format', 'stream-json', '-p'],
    (l, sendNow) => {
      if (isAsk(l)) askSeen = true
      if (isToolUse(l)) toolSeen = true
      if (askSeen && toolSeen && sentAt === 0) {
        sentAt = performance.now()
        sendNow(allow('r1'))
      }
    },
    true,
  )
  send(userMessage('go'))
  const timer = setTimeout(() => agent.kill('SIGKILL'), 10_000)
  const all = await lines
  clearTimeout(timer)
  const res = all.find(isResult)
  expect(sentAt).toBeGreaterThan(0)
  expect(res).toBeDefined()
  expect(res!.at).toBeGreaterThan(sentAt)
})

test('97.3 with no input channel the open ask is denied at the end of the turn', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolUse, result] })
  const { agent, lines } = start(p, ['-p', 'go'])
  const all = await lines
  await agent.exited
  const askAt = all.findIndex(isAsk)
  const toolAt = all.findIndex(isToolUse)
  const denialAt = all.findIndex((l) => isToolResult(l) && JSON.stringify(l.event).includes('"is_error":true'))
  const resAt = all.findIndex(isResult)
  expect(askAt).toBeGreaterThanOrEqual(0)
  expect(toolAt).toBeGreaterThan(askAt)
  expect(denialAt).toBeGreaterThan(toolAt)
  expect(resAt).toBeGreaterThan(denialAt)
})

test('97.4 a crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { crash: 1 }] })
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], () => {}, true)
  send(userMessage('go'))
  const timer = setTimeout(() => agent.kill('SIGKILL'), 10_000)
  const all = await lines
  clearTimeout(timer)
  const code = await agent.exited
  expect(all.some(isAsk)).toBe(true)
  // The fake agent exits on its own, not by the timer.
  expect(agent.signalCode).toBeNull()
  expect(code).toBe(1)
  expect(all.some(isToolResult)).toBe(false)
  expect(all.some(isResult)).toBe(false)
})

test('97.5 a scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolUse, result] })
  const { agent, lines, send } = start(p, ['--input-format', 'stream-json', '-p'], (l, sendNow) => {
    if (isToolUse(l)) sendNow(allow('r1'))
  }, true)
  send(userMessage('go'))
  const timer = setTimeout(() => agent.kill('SIGKILL'), 10_000)
  const all = await lines
  clearTimeout(timer)
  const askAt = all.findIndex(isAsk)
  const next = all[askAt + 1]!
  expect(isToolUse(next)).toBe(true)
  expect(next.at - all[askAt]!.at).toBeGreaterThanOrEqual(120)
})
