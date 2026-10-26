import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/cli-harness.ts'
import { spawnServe, type ServeProcess } from '../src/test/server-harness.ts'

let project: Project
const servers: ServeProcess[] = []

beforeEach(async () => {
  project = await makeProject()
})
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop()
  project.cleanup()
})

type Event = Record<string, unknown> & { type: string }
const lines = (s: string): Event[] => s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Event)
const STREAM = ['--output-format', 'stream-json', '--verbose']

test('01.5 a command-line test runs a werk command against a temporary project', async () => {
  const p = await makeProject()
  expect(existsSync(join(p.dir, '.git'))).toBe(true)
  expect((await p.git('rev-parse', '--is-inside-work-tree')).trim()).toBe('true')
  const r = await p.werk()
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('usage: werk <verb>')
  // Any agent the command calls is the scripted fake: `claude` on the project PATH is the fake.
  const which = await p.run('sh', '-c', 'command -v claude')
  expect(readFileSync(which.stdout.trim(), 'utf8')).toContain('fake claude')
  p.claude.script({ replies: [{ steps: [{ text: 'hi' }] }] })
  const c = await p.run('claude', '-p', 'x')
  expect(c.stdout).toBe('hi\n')
  expect(p.claude.calls()).toHaveLength(1)
  p.cleanup()
  expect(existsSync(p.dir)).toBe(false)
})

test('31.2 werk lists its verbs and refuses an unknown verb', async () => {
  const r = await project.werk()
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('help')
  expect(r.stdout).toContain('serve')
  const bad = await project.werk('frobnicate')
  expect(bad.code).not.toBe(0)
  expect(bad.stdout + bad.stderr).toContain('unknown verb "frobnicate"')
})

test('33.1 a one-shot fake replays its script and edits files', async () => {
  const events = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'one' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'three' }] } },
  ]
  project.claude.script({
    replies: [{ steps: [...events.map((event) => ({ event })), { write: 'notes.md', content: '# notes\n' }], exit: 0 }],
  })
  const r = await project.run('claude', '-p', 'write notes', ...STREAM)
  const out = lines(r.stdout)
  const idx = events.map((e) => out.findIndex((o) => JSON.stringify(o) === JSON.stringify(e)))
  expect(idx.every((i) => i >= 0)).toBe(true)
  expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  expect(readFileSync(join(project.dir, 'notes.md'), 'utf8')).toBe('# notes\n')
  expect(r.code).toBe(0)
  const [call] = project.claude.calls()
  expect(call).toMatchObject({ args: ['-p', 'write notes', ...STREAM], prompt: 'write notes', cwd: project.dir })
  expect(call?.input).toBe('')
})

test('33.2 a long-lived chat fake answers two turns', async () => {
  project.claude.script({
    replies: [
      { when: { role: 'chat', turn: 1 }, steps: [{ text: 'reply one' }] },
      { when: { role: 'chat', turn: 2 }, steps: [{ text: 'reply two' }] },
    ],
  })
  const child = Bun.spawn(['claude', '-p', '--input-format', 'stream-json', ...STREAM], {
    cwd: project.dir,
    env: project.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const reader = child.stdout.getReader()
  let buf = ''
  const readUntilResult = async () => {
    const got: Event[] = []
    for (;;) {
      const nl = buf.indexOf('\n')
      if (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        const e = JSON.parse(line) as Event
        got.push(e)
        if (e.type === 'result') return got
        continue
      }
      const c = await reader.read()
      if (c.done) throw new Error('closed')
      buf += new TextDecoder().decode(c.value)
    }
  }
  const say = (t: string) => {
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: t } })}\n`)
    child.stdin.flush()
  }
  say('first')
  const one = await readUntilResult()
  expect(one.at(-1)).toMatchObject({ result: 'reply one' })
  expect(child.exitCode).toBeNull()
  say('second')
  const two = await readUntilResult()
  expect(two.at(-1)).toMatchObject({ result: 'reply two' })
  child.stdin.end()
  await child.exited
  const calls = project.claude.calls()
  expect(calls).toHaveLength(1)
  expect(calls[0]?.turns).toEqual(['first', 'second'])
  expect(calls[0]?.input).toContain('first')
  expect(calls[0]?.input).toContain('second')
})

test('33.3 resume keeps the session and fork gets a new id', async () => {
  project.claude.script({ replies: [{ steps: [{ text: 'ok' }] }] })
  const first = await project.run('claude', '-p', 'a', '--session-id', 'S1', ...STREAM)
  expect(lines(first.stdout)[0]?.session_id).toBe('S1')
  const resumed = await project.run('claude', '-p', 'b', '--resume', 'S1', ...STREAM)
  const forked = await project.run('claude', '-p', 'c', '--resume', 'S1', '--fork-session', ...STREAM)
  expect(new Set(lines(resumed.stdout).map((e) => e.session_id))).toEqual(new Set(['S1']))
  const fid = lines(forked.stdout)[0]?.session_id
  expect(fid).toBeString()
  expect(fid).not.toBe('S1')
  const calls = project.claude.calls()
  expect(calls[1]).toMatchObject({ resume: 'S1', fork: false })
  expect(calls[2]).toMatchObject({ resume: 'S1', fork: true })
})

test('33.5 ask, stall, repeat, die', async () => {
  project.claude.script({
    replies: [
      {
        steps: [
          { ask: 'Bash', input: { command: 'ls' } },
          { sleep: 200 },
          { tool: 'Bash', input: { command: 'make' }, result: 'x', times: 3 },
          { die: 137 },
        ],
      },
    ],
  })
  const child = Bun.spawn(['claude', '-p', 'go', ...STREAM], {
    cwd: project.dir,
    env: project.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stamped: { e: Event; t: number }[] = []
  let buf = ''
  for await (const chunk of child.stdout) {
    buf += new TextDecoder().decode(chunk)
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) stamped.push({ e: JSON.parse(line) as Event, t: performance.now() })
    }
  }
  const code = await child.exited
  const body = stamped.filter((s) => s.e.type !== 'system')
  const askAt = body.findIndex((s) => s.e.type === 'control_request')
  expect(askAt).toBeGreaterThanOrEqual(0)
  // Nothing but the ask (its tool_use announcement may come first) precedes it.
  expect(body.slice(0, askAt).every((s) => s.e.type === 'assistant')).toBe(true)
  const after = body.slice(askAt + 1)
  // The headless call has no answer channel; the fake reports the denied ask as a tool result.
  const askT = (body[askAt] as { t: number }).t
  const firstAfterAsk = after[0] as { e: Event; t: number }
  const nextAssistant = after.find((s) => s.e.type === 'assistant') as { t: number }
  expect(nextAssistant.t - askT).toBeGreaterThanOrEqual(190)
  const uses = after
    .filter((s) => s.e.type === 'assistant')
    .map((s) => (s.e.message as { content: { type: string; id: string }[] }).content[0])
    .filter((b) => b?.type === 'tool_use')
  expect(uses).toHaveLength(3)
  expect(new Set(uses.map((u) => JSON.stringify({ ...u, id: undefined }))).size).toBe(1)
  expect(stamped.some((s) => s.e.type === 'result')).toBe(false)
  expect(code).toBe(137)
  // The step: no event at all for 200 ms after the ask.
  expect({ firstEventAfterAsk: firstAfterAsk.e.type, gapMs: Math.round(firstAfterAsk.t - askT) }).toMatchObject({
    gapMs: expect.any(Number),
  })
  expect(firstAfterAsk.t - askT).toBeGreaterThanOrEqual(190)
})

test('32.2 a second server waits for the lock, then refuses', async () => {
  const first = spawnServe({ cwd: project.dir, env: project.env, args: ['--port', '0'] })
  servers.push(first)
  const url = await first.serving()
  const port = new URL(url).port
  const second = spawnServe({ cwd: project.dir, env: project.env, args: ['--port', '0', '--lock-wait-ms', '50', '--lock-poll-ms', '10'] })
  servers.push(second)
  await second.waitFor(new RegExp(`waiting for pid ${first.pid}`))
  const code = await second.exited
  expect(code).not.toBe(0)
  expect(second.output()).toContain(`port ${port}`)
  expect(second.output()).toContain(`pid ${first.pid}`)
  const page = await fetch(url)
  expect(page.ok).toBe(true)
  expect(await page.text()).toContain('<div id="root">')
})
