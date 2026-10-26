/** Held-out steps 97.x: the fake agent's permission asks, pauses and crashes. */
import { expect, test } from 'bun:test'
import type { FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'

type Line = { at: number; event: { type: string; [k: string]: unknown } }

const ask: FakeStep = { ask: { id: 'r1', tool: 'Bash', input: { command: 'touch x' } } }
const toolCall: FakeStep = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }
// A scripted turn ends with its final result.
const finalResult: FakeStep = { event: { type: 'result', subtype: 'success' } }
const allow = { type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: {} } } }

/** Starts a turn on the fake agent with an input channel, and collects each output line as it comes. */
function startTurn(p: Project, onLine: (line: Line, send: (m: unknown) => void) => void = () => {}) {
  const agent = Bun.spawn(['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json'], {
    cwd: p.dir,
    env: p.env,
    stdin: 'pipe',
    stdout: 'pipe',
  })
  const send = (m: unknown) => {
    agent.stdin.write(JSON.stringify(m) + '\n')
    agent.stdin.flush()
  }
  send({ type: 'user', message: { role: 'user', content: 'go' } })
  const seen: Line[] = []
  const done = (async () => {
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of agent.stdout) {
      const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n')
      rest = parts.pop()!
      for (const part of parts) {
        const line = { at: performance.now(), event: JSON.parse(part) }
        seen.push(line)
        onLine(line, send)
      }
    }
  })()
  return { agent, send, seen, done }
}

const types = (seen: Line[]) => seen.map((l) => l.event.type)
const isToolResult = (l: Line) => l.event.type === 'user' && JSON.stringify(l.event).includes('tool_result')

test('97.1 A pause and a tool call play while a permission ask is still open', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall, finalResult] })
  // When the test writer starts a turn and sends no answer to the ask
  const t = startTurn(p)
  const deadline = Date.now() + 5000
  while (!types(t.seen).includes('assistant') && Date.now() < deadline) await Bun.sleep(20)
  // Observe the output for a while longer with the ask unanswered
  await Bun.sleep(1000)
  const snapshot = types(t.seen)
  t.agent.kill('SIGKILL')
  await t.done
  // Then the permission request, then the tool call after the pause, and no final result
  expect(snapshot[0]).toBe('control_request')
  expect(snapshot[1]).toBe('assistant')
  expect(t.seen[1]!.at - t.seen[0]!.at).toBeGreaterThanOrEqual(100)
  expect(snapshot).not.toContain('result')
})

test('97.2 An answer on the input channel settles the open ask and the turn finishes', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, finalResult] })
  let sentAt = 0
  const t = startTurn(p, (line, send) => {
    // Once the output shows the permission request and the tool call, send an allow answer
    if (line.event.type === 'assistant') {
      sentAt = performance.now()
      send(allow)
    }
  })
  await t.done
  expect(await t.agent.exited).toBe(0)
  expect(types(t.seen).slice(0, 2)).toEqual(['control_request', 'assistant'])
  // Then the output shows the final result, after the answer was sent
  const result = t.seen.find((l) => l.event.type === 'result')
  expect(result).toBeDefined()
  expect(sentAt).toBeGreaterThan(0)
  expect(result!.at).toBeGreaterThan(sentAt)
})

test('97.3 With no input channel the open ask is denied at the end of the turn', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, toolCall, finalResult] })
  const r = p.run(['claude', '-p', 'go'])
  const events = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as { type: string; message?: { content: { is_error?: boolean; tool_use_id?: string }[] } })
  expect(events.map((e) => e.type)).toEqual(['control_request', 'assistant', 'user', 'result'])
  // the ask is denied: its tool result is an error
  expect(events[2]!.message!.content[0]).toMatchObject({ tool_use_id: 'r1', is_error: true })
})

test('97.4 A crash with an ask open ends the run like a real agent that dies', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { crash: 1 }] })
  const t = startTurn(p)
  await t.done
  // Then the permission request; the fake agent exits; no tool result; no final result
  expect(types(t.seen)[0]).toBe('control_request')
  expect(await t.agent.exited).toBe(1)
  expect(t.seen.some(isToolResult)).toBe(false)
  expect(types(t.seen)).not.toContain('result')
})

test('97.5 A scripted pause keeps the output silent for at least its length plus the margin', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [ask, { sleep: 100 }, toolCall] })
  const t = startTurn(p)
  const deadline = Date.now() + 5000
  while (t.seen.length < 2 && Date.now() < deadline) await Bun.sleep(10)
  t.agent.kill('SIGKILL')
  await t.done
  // Then the output stays silent for at least 120 ms; And the tool call shows after that silence
  expect(t.seen[0]!.event.type).toBe('control_request')
  expect(t.seen[1]!.event.type).toBe('assistant')
  expect(t.seen[1]!.at - t.seen[0]!.at).toBeGreaterThanOrEqual(120)
})
