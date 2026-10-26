// agent.ts behaviours 1-9 from #werk-test-behaviours-agent, at the child-process seam. The
// `claude` on PATH is src/test/fake-claude.ts (put there by the preload), so every test runs
// a real child process, a real pipe and real exit codes — only the model is fake.
//
// Not here: what an exit does to open asks. Another change to that path is in flight.
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, type ChatMessage, StderrLog } from './agent.ts'
import { Asks, readAlways } from './permission.ts'
import { fakeEnv, flag, launches, scratchDir, sleep, stdinOf, waitFor } from './test/harness.ts'

let undo: (() => void) | null = null
const live: Agent[] = []

afterEach(() => {
  for (const a of live.splice(0)) a.stop()
  undo?.()
  undo = null
})

/** One conversation in its own directory, with the fake steered by `env`. */
function setup(env: Record<string, string> = {}, session?: string) {
  const dir = scratchDir()
  const log = join(dir, 'fake.jsonl')
  undo = fakeEnv({ FAKE_CLAUDE_LOG: log, ...env })
  if (session) writeFileSync(join(dir, 'session'), session + '\n')
  const asks = new Asks()
  const agent = new Agent(dir, ['Read'], false, asks, { name: 't', dir })
  live.push(agent)
  const said: ChatMessage[] = []
  agent.onMessage((m) => said.push(m))
  const system = () => said.filter((m) => m.from === 'system').map((m) => m.text)
  const done = () => said.some((m) => m.done)
  return { dir, log, agent, asks, said, system, done }
}

describe('agent.ts', () => {
  test('1. a restart resumes the session id stored on disk', async () => {
    const t = setup({ FAKE_CLAUDE_SESSION: 'sess-old' }, 'sess-old')
    t.agent.send('hello')
    await waitFor(t.done, 'the turn to finish')
    const [argv] = launches(t.log)
    expect(flag(argv, '--resume')).toBe('sess-old')
    expect(argv).not.toContain('--fork-session')
    expect(t.system()).toContain('Resumed session sess-old.')
  })

  test('2. a crashed child is replayed once with the in-flight turn, then gives up loudly', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'crash', FAKE_CLAUDE_STDERR: 'segfault' })
    t.agent.send('the message')
    await waitFor(() => t.system().some((s) => s.startsWith('Your message was not delivered')), 'the give-up message')
    await sleep(300)
    expect(t.system()).toContain('Your message was not delivered. Send it again.')
    expect(launches(t.log)).toHaveLength(2)
    // Both children were handed the same turn: replayed, not dropped.
    expect(stdinOf(t.log).map((m) => m.message.content[0].text)).toEqual(['the message', 'the message'])
    expect(t.system().filter((s) => s === 'Retrying once.')).toHaveLength(1)
    expect([t.agent.dead, t.agent.status.state]).toEqual([true, 'dead'])
  })

  test('3. an auth failure is never retried', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'crash', FAKE_CLAUDE_STDERR: 'Error: not logged in. Run claude auth login' })
    t.agent.send('hi')
    await waitFor(() => t.system().includes('Fix the problem above, then send it again.'), 'the give-up message')
    await sleep(300)
    expect(launches(t.log)).toHaveLength(1)
    expect(t.system()).not.toContain('Retrying once.')
    expect(t.system().some((s) => s.startsWith('Your message was not delivered'))).toBe(false)
    expect(t.said.some((m) => m.from === 'result' && m.error && m.text.includes('not logged in'))).toBe(true)
  })

  test('4. "No conversation found" clears the stored session and starts fresh', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'gone', FAKE_CLAUDE_SESSION: 'sess-fresh' }, 'sess-gone')
    t.agent.send('still there?')
    await waitFor(t.done, 'the replayed turn to finish')
    const [first, second] = launches(t.log)
    expect(flag(first, '--resume')).toBe('sess-gone')
    expect(second).not.toContain('--resume')
    expect(readFileSync(join(t.dir, 'session'), 'utf8').trim()).toBe('sess-fresh')
    expect(t.said.some((m) => m.from === 'agent' && m.text === 'echo still there?')).toBe(true)
  })

  test('5. setModel and clearContext refuse while a turn is in flight, and the child lives', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_SESSION: 'sess-busy' })
    t.agent.send('long turn')
    await waitFor(() => existsSync(join(t.dir, 'session')), 'init')
    expect(t.agent.busy).toBe(true)
    expect(() => t.agent.setModel('claude-opus-5-5', null)).toThrow('wait for the current turn to finish')
    expect(() => t.agent.clearContext()).toThrow('wait for the current turn to finish')
    await sleep(200)
    expect(t.system().some((s) => s.startsWith('The agent stopped') || s.startsWith('Switched'))).toBe(false)
    expect(launches(t.log)).toHaveLength(1)
    expect(t.agent.modelSetting().model).not.toBe('claude-opus-5-5')
    expect(existsSync(join(t.dir, 'session'))).toBe(true)
  })

  test('6. a deliberate model switch on an idle child restarts it without a crash message', async () => {
    const t = setup({ FAKE_CLAUDE_SESSION: 'sess-switch' })
    t.agent.send('hi')
    await waitFor(t.done, 'the first turn')
    t.agent.setModel('claude-opus-5-5', null)
    await waitFor(() => launches(t.log).length === 2, 'the restart')
    await waitFor(() => t.system().includes('Switched to claude-opus-5-5.'), 'the switch message')
    expect(t.system().some((s) => s.startsWith('The agent stopped'))).toBe(false)
    const second = launches(t.log)[1]
    expect(flag(second, '--model')).toBe('claude-opus-5-5')
    expect(second).not.toContain('--advisor')
    expect(flag(second, '--resume')).toBe('sess-switch')
  })

  test('7. a denied permission ends that one call with interrupt:false, not the turn', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'ask' })
    t.agent.send('fetch it')
    const [ask] = await waitFor(() => (t.asks.open().length ? t.asks.open() : null), 'the ask')
    expect([ask.tool, ask.label, ask.convo]).toEqual(['Bash', 'curl example.com', 't'])
    t.asks.answer(ask.id, 'deny')
    const reply = await waitFor(() => stdinOf(t.log).find((m) => m.type === 'control_response'), 'the answer on stdin')
    expect(reply.response.request_id).toBe(ask.id)
    expect(reply.response.response).toMatchObject({ behavior: 'deny', interrupt: false })
    expect(typeof reply.response.response.message).toBe('string')
    await waitFor(t.done, 'the turn to finish after the denial')
    expect(launches(t.log)).toHaveLength(1)
  })

  test('8. context used comes from one assistant message, not the summed modelUsage', async () => {
    const t = setup()
    const seen: number[] = []
    t.agent.onContext((c) => seen.push(c.used))
    t.agent.send('hi')
    await waitFor(t.done, 'the turn')
    // The fake sends usage 100 + 20 + 3000 + 400 on the assistant event, and 999999 input
    // tokens summed over the turn on the result. Only the first is the conversation's size.
    expect(t.agent.context()).toEqual({ used: 3520, max: 1000000 })
    expect(seen.every((u) => u === 3520)).toBe(true)
  })

  test('8b. a rebuilt conversation keeps its model, advisor and context fill from before the restart', async () => {
    const t = setup({ FAKE_CLAUDE_SESSION: 'sess-keep' })
    t.agent.setModel('claude-opus-5-5', null)
    t.agent.send('hi')
    await waitFor(t.done, 'the turn')
    const again = new Agent(t.dir, ['Read'], false, new Asks(), { name: 't', dir: t.dir })
    live.push(again)
    expect(again.modelSetting()).toEqual({ model: 'claude-opus-5-5', advisor: null })
    expect(again.context()).toEqual(t.agent.context())
    expect(again.context().used).toBeGreaterThan(0)
  })

  test('9. "always" writes allow.json and widens the live list in the same step', async () => {
    const rule = 'Bash(curl example.com)'
    const dir = '/tmp/werk-always-dir'
    const t = setup({
      FAKE_CLAUDE_MODE: 'ask',
      FAKE_CLAUDE_SESSION: 'sess-always',
      FAKE_CLAUDE_SUGGEST: JSON.stringify([
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'curl example.com' }], behavior: 'allow', destination: 'localSettings' },
        { type: 'addDirectories', directories: [dir], destination: 'session' },
      ]),
    })
    expect(t.agent.allowedTools()).not.toContain(rule)
    t.agent.send('fetch it')
    const [ask] = await waitFor(() => (t.asks.open().length ? t.asks.open() : null), 'the ask')
    t.asks.answer(ask.id, 'always')
    const reply = await waitFor(() => stdinOf(t.log).find((m) => m.type === 'control_response'), 'the answer on stdin')

    // The current process: the file and the live list, before the next launch.
    expect(readAlways().rules).toContain(rule)
    expect(readAlways().dirs).toContain(dir)
    expect(t.agent.allowedTools()).toContain(rule)
    expect(t.agent.allowedDirs()).toContain(dir)
    // Session scope only, whatever the CLI proposed — never written into settings.local.json.
    const updates = reply.response.response.updatedPermissions as Array<{ destination: string }>
    expect(updates.map((u) => u.destination)).toEqual(['session', 'session'])

    // Every relaunch after it: the next child of this agent, and a brand-new agent.
    await waitFor(t.done, 'the turn')
    t.agent.setModel('claude-opus-5-5', null)
    await waitFor(() => launches(t.log).length === 2, 'the relaunch')
    const relaunch = launches(t.log)[1]
    expect(flag(relaunch, '--add-dir')).toBe(dir)
    expect(relaunch.slice(relaunch.indexOf('--allowedTools'))).toContain(rule)
    expect(new Agent(t.dir).allowedTools()).toContain(rule)
  })
})

// #werk-chat-turn-id: every part of a reply carries the turn of the message that asked for it.
describe('turns', () => {
  const ends = (said: ChatMessage[]) => said.filter((m) => m.done).map((m) => m.turn)

  test('a message sent mid-reply waits, and each reply carries its own turn', async () => {
    const t = setup()
    t.agent.send('first', undefined, [], 'turn-a')
    t.agent.send('second', undefined, [], 'turn-b')
    await waitFor(() => ends(t.said).length === 2, 'both turns to end')
    expect(t.said.filter((m) => m.from === 'you').map((m) => m.turn)).toEqual(['turn-a', 'turn-b'])
    expect(t.said.find((m) => m.text === 'echo first')?.turn).toBe('turn-a')
    expect(t.said.find((m) => m.text === 'echo second')?.turn).toBe('turn-b')
    expect(ends(t.said)).toEqual(['turn-a', 'turn-b'])
  })

  test('a turn the browser did not name still gets one', async () => {
    const t = setup()
    t.agent.send('hi')
    await waitFor(t.done, 'the turn to end')
    const turn = t.said.find((m) => m.from === 'you')?.turn
    expect(turn).toBeTruthy()
    expect(t.said.find((m) => m.done)?.turn).toBe(turn)
  })

  test('a stop ends every open turn, and the held message is dropped', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'hang' })
    t.agent.send('long', undefined, [], 'turn-a')
    t.agent.send('held', undefined, [], 'turn-b')
    await waitFor(() => existsSync(join(t.dir, 'session')), 'init')
    t.agent.stop()
    await waitFor(() => ends(t.said).length === 2, 'both turns to end')
    expect(ends(t.said)).toEqual(['turn-a', 'turn-b'])
    t.agent.send('next', undefined, [], 'turn-c')
    await sleep(300)
    expect(stdinOf(t.log).map((m) => m.message.content[0].text)).not.toContain('held')
  })

  test('a child that dies for good ends every open turn', async () => {
    const t = setup({ FAKE_CLAUDE_MODE: 'crash', FAKE_CLAUDE_STDERR: 'Error: not logged in' })
    t.agent.send('one', undefined, [], 'turn-a')
    t.agent.send('two', undefined, [], 'turn-b')
    await waitFor(() => t.agent.dead, 'the child to die')
    expect(ends(t.said)).toEqual(['turn-a', 'turn-b'])
    expect(t.said.find((m) => m.text.startsWith('The agent stopped'))?.turn).toBe('turn-a')
  })
})

describe('StderrLog', () => {
  test('keeps the whole stderr, first line included, across many chunks (#werk-fullerr)', () => {
    const log = new StderrLog()
    const text = 'Error: the cause\n' + 'x'.repeat(10_000) + '\nlast line'
    for (let i = 0; i < text.length; i += 1000) log.add(text.slice(i, i + 1000))
    expect(log.text()).toBe(text)
  })

  test('past the cap, the head and the tail stay and the cut is named', () => {
    const log = new StderrLog(20)
    log.add('0123456789abcdefghijKLMNOP')
    expect(log.text()).toBe('0123456789\n… 6 characters cut …\nghijKLMNOP')
  })
})
