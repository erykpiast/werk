import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/cli-harness.ts'

let project: Project
beforeEach(async () => {
  project = await makeProject()
})
afterEach(() => project?.cleanup())

type Ev = Record<string, unknown> & { type: string }
const lines = (s: string): Ev[] =>
  s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Ev)
const STREAM = ['--output-format', 'stream-json', '--verbose']

function start(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(['claude', ...args], {
    cwd: project.dir,
    env: { ...project.env, ...env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const reader = child.stdout.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const read = async (until: (e: Ev) => boolean): Promise<{ ev: Ev[]; times: number[] }> => {
    const ev: Ev[] = []
    const times: number[] = []
    for (;;) {
      const nl = buf.indexOf('\n')
      if (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        const e = JSON.parse(line) as Ev
        ev.push(e)
        times.push(performance.now())
        if (until(e)) return { ev, times }
        continue
      }
      const c = await reader.read()
      if (c.done) return { ev, times }
      buf += dec.decode(c.value, { stream: true })
    }
  }
  const send = (o: object) => {
    child.stdin.write(`${JSON.stringify(o)}\n`)
    child.stdin.flush()
  }
  return { child, read, send }
}
const userTurn = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })

// 01.5
test('01.5 harness: temp project, werk exit code and output, fake agent, cleanup', async () => {
  const dir = project.dir
  expect(existsSync(join(dir, '.git'))).toBe(true)
  const r = await project.werk('help')
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('verbs:')
  const which = await project.run('sh', '-c', 'command -v claude')
  const claudePath = which.stdout.trim()
  expect(readFileSync(claudePath, 'utf8')).toContain('fake claude')
  project.cleanup()
  expect(existsSync(dir)).toBe(false)
})

// 31.2
test('31.2 werk with no verb lists verbs; unknown verb refused', async () => {
  const r = await project.werk()
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('help')
  const u = await project.werk('frobnicate')
  expect(u.code).not.toBe(0)
  expect(u.stdout + u.stderr).toContain('frobnicate')
  expect(u.stdout + u.stderr).toMatch(/unknown verb/)
})

// 33.1
test('33.1 one-shot fake replays script and edits files', async () => {
  project.claude.script({
    replies: [
      {
        steps: [{ text: 'one' }, { write: 'notes.md', content: 'scripted notes\n' }],
        exit: 0,
      },
    ],
  })
  const r = await project.run('claude', '-p', 'hello there', ...STREAM)
  const ev = lines(r.stdout)
  // three scripted events: text message, Write tool_use, tool_result (plus init and result framing)
  const scripted = ev.filter((e) => e.type === 'assistant' || e.type === 'user')
  expect(scripted.length).toBe(3)
  expect(JSON.stringify(scripted[0])).toContain('"one"')
  expect(JSON.stringify(scripted[1])).toContain('tool_use')
  expect(JSON.stringify(scripted[2])).toContain('tool_result')
  expect(readFileSync(join(project.dir, 'notes.md'), 'utf8')).toBe('scripted notes\n')
  expect(r.code).toBe(0)
  const calls = project.claude.calls()
  expect(calls.length).toBe(1)
  expect(calls[0]!.args).toContain('-p')
  expect(calls[0]!.prompt).toBe('hello there')
  expect(calls[0]!.cwd).toBe(project.dir)
})

// 33.2
test('33.2 long-lived chat fake answers two turns', async () => {
  project.claude.script({
    replies: [
      { when: { role: 'chat', turn: 1 }, steps: [{ text: 'reply one' }] },
      { when: { role: 'chat', turn: 2 }, steps: [{ text: 'reply two' }] },
    ],
  })
  const c = start(['-p', '--input-format', 'stream-json', ...STREAM], { WERK_AGENT_ROLE: 'chat' })
  c.send(userTurn('first'))
  const t1 = await c.read((e) => e.type === 'result')
  expect(JSON.stringify(t1.ev)).toContain('reply one')
  expect(c.child.exitCode).toBeNull()
  c.send(userTurn('second'))
  const t2 = await c.read((e) => e.type === 'result')
  expect(JSON.stringify(t2.ev)).toContain('reply two')
  expect(JSON.stringify(t2.ev)).not.toContain('reply one')
  c.child.stdin.end()
  await c.child.exited
  const calls = project.claude.calls()
  expect(calls.length).toBe(1)
  expect(calls[0]!.turns).toEqual(['first', 'second'])
  expect(calls[0]!.input).toContain('first')
  expect(calls[0]!.input).toContain('second')
})

// 33.3
test('33.3 resume keeps session, fork gets new id', async () => {
  project.claude.script({ replies: [{ steps: [{ text: 'ok' }] }] })
  const sid = (out: string) => lines(out).find((e) => e.type === 'system')?.session_id
  const r1 = await project.run('claude', '-p', 'x', '--session-id', 'S1', ...STREAM)
  expect(sid(r1.stdout)).toBe('S1')
  const r2 = await project.run('claude', '-p', 'x', '--resume', 'S1', ...STREAM)
  const r3 = await project.run('claude', '-p', 'x', '--resume', 'S1', '--fork-session', ...STREAM)
  expect(sid(r2.stdout)).toBe('S1')
  expect(sid(r3.stdout)).toBeDefined()
  expect(sid(r3.stdout)).not.toBe('S1')
  const calls = project.claude.calls()
  expect(calls[1]!.resume).toBe('S1')
  expect(calls[1]!.fork).toBe(false)
  expect(calls[2]!.resume).toBe('S1')
  expect(calls[2]!.fork).toBe(true)
})

// 33.4
test('33.4 build command: builder edits, grader fail then pass', async () => {
  project.claude.script({
    replies: [
      { when: { role: 'builder' }, steps: [{ write: 'a.ts', content: 'export const a = 1\n' }] },
      { when: { role: 'grader', pass: 1 }, steps: [{ text: 'FAIL' }] },
      { when: { role: 'grader', pass: 2 }, steps: [{ text: 'PASS' }] },
    ],
  })
  const r = await project.werk('build', 't1')
  expect(r.code, r.stdout + r.stderr).toBe(0)
  const calls = project.claude.calls()
  expect(calls.some((c) => c.role === 'builder')).toBe(true)
  expect(calls.filter((c) => c.role === 'grader').length).toBe(2)
})

// 33.5
test('33.5 ask, stall, repeat, die', async () => {
  const ask = {
    type: 'control_request',
    request_id: 'req_1',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 't1' },
  }
  project.claude.script({
    replies: [
      {
        steps: [
          { event: ask },
          { sleep: 200 },
          { tool: 'Read', input: { file_path: 'x' }, times: 3 },
          { die: 137 },
        ],
      },
    ],
  })
  const c = start(['-p', 'go', ...STREAM])
  const all = await c.read(() => false)
  const code = await c.child.exited
  const items = all.ev.map((e, i) => ({ e, t: all.times[i]! })).filter((x) => x.e.type !== 'system')
  expect(items[0]!.e.type).toBe('control_request')
  const askT = items[0]!.t
  const toolUses = items.filter((x) => x.e.type === 'assistant')
  expect(toolUses.length).toBe(3)
  expect(items[1]!.t - askT).toBeGreaterThanOrEqual(195)
  const strip = (e: Ev) => {
    const m = (e.message as { content: { name: string; input: unknown }[] }).content[0]!
    return JSON.stringify({ name: m.name, input: m.input })
  }
  expect(new Set(toolUses.map((x) => strip(x.e))).size).toBe(1)
  expect(all.ev.some((e) => e.type === 'result')).toBe(false)
  expect(code).toBe(137)
})
