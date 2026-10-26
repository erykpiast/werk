/** Group 97: the fake agent's permission asks, pauses and crashes. */
import { expect, test } from 'bun:test'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'

type Line = { at: number; event: { type: string; [k: string]: unknown } }

const ask: FakeStep = { ask: { id: 'r1', tool: 'Bash', input: { command: 'touch x' } } }
const toolCall: FakeStep = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }
const result: FakeStep = { event: { type: 'result', subtype: 'success' } }
const isToolCall = (l: Line) => l.event.type === 'assistant'
const isRequest = (l: Line) => l.event.type === 'control_request'
const isToolResult = (l: Line) => l.event.type === 'user'
const isResult = (l: Line) => l.event.type === 'result'

/** Starts a turn of the fake agent with an input channel, and sends the prompt. */
function startTurn(p: Project) {
  const agent = Bun.spawn(['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json'], {
    cwd: p.dir,
    env: p.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const send = (m: unknown) => {
    agent.stdin.write(JSON.stringify(m) + '\n')
    agent.stdin.flush()
  }
  send({ type: 'user', message: { role: 'user', content: 'go' } })
  const seen: Line[] = []
  const waiters = new Set<() => void>()
  const done = (async () => {
    let rest = ''
    for await (const chunk of agent.stdout) {
      const parts = (rest + new TextDecoder().decode(chunk)).split('\n')
      rest = parts.pop()!
      for (const part of parts) {
        seen.push({ at: performance.now(), event: JSON.parse(part) })
        for (const w of waiters) w()
      }
    }
  })()
  const until = (match: (l: Line) => boolean, ms = 10_000) =>
    new Promise<Line>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no such line in time; seen ${JSON.stringify(seen.map((l) => l.event.type))}`)), ms)
      const look = () => {
        const found = seen.find(match)
        if (!found) return
        clearTimeout(timer)
        waiters.delete(look)
        resolve(found)
      }
      waiters.add(look)
      look()
    })
  return { agent, send, seen, until, done }
}

const allow = (id: string) => ({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'allow', updatedInput: {} } } })

test('97.1 a pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall] })
  const t = startTurn(p)
  const request = await t.until(isRequest)
  const call = await t.until(isToolCall)
  expect(call.at - request.at).toBeGreaterThanOrEqual(100)
  // The ask stays unanswered for a while; no final result may show in that time.
  await Bun.sleep(500)
  expect(t.seen.some(isResult)).toBe(false)
  expect(t.seen.some(isToolResult)).toBe(false)
  t.agent.stdin.end()
  await t.agent.exited
})

test('97.2 an answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, result] })
  const t = startTurn(p)
  await t.until(isRequest)
  await t.until(isToolCall)
  const sentAt = performance.now()
  t.send(allow('r1'))
  const final = await t.until(isResult)
  expect(final.at).toBeGreaterThan(sentAt)
  t.agent.stdin.end()
  await t.agent.exited
})

test('97.3 with no input channel the open ask is denied at the end of the turn', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, result] })
  const r = p.run(['claude', '-p', 'go', '--output-format', 'stream-json'])
  expect(r.code).toBe(0)
  const events = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as { type: string; message?: { content: { is_error?: boolean; tool_use_id?: string }[] } })
  const types = events.map((e) => e.type)
  expect(types).toEqual(['control_request', 'assistant', 'user', 'result'])
  expect(events[2]!.message!.content[0]!.is_error).toBe(true)
  expect(events[2]!.message!.content[0]!.tool_use_id).toBe('r1')
})

test('97.4 a crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { crash: 1 }] })
  const t = startTurn(p)
  await t.until(isRequest)
  const code = await t.agent.exited
  await t.done
  expect(code).not.toBe(0)
  expect(t.seen.some(isToolResult)).toBe(false)
  expect(t.seen.some(isResult)).toBe(false)
})

test('97.5 a scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall] })
  const t = startTurn(p)
  const request = await t.until(isRequest)
  const next = await t.until((l) => l.at > request.at || (l !== request && t.seen.indexOf(l) > t.seen.indexOf(request)))
  expect(next.at - request.at).toBeGreaterThanOrEqual(120)
  expect(next.event.type).toBe('assistant')
  t.agent.stdin.end()
  await t.agent.exited
})
