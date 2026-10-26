/** Held-out steps 106.1-106.4: the convos and recall verbs. */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

const S1 = '11111111-0000-4000-8000-000000000001'
const S2 = '22222222-0000-4000-8000-000000000002'
const S3 = '33333333-0000-4000-8000-000000000003'

function withConvos(p: Project, lines: object[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'conversations.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''))
}
function withTranscript(p: Project, session: string, lines: object[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-worktree')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${session}.jsonl`), lines.map((l) => JSON.stringify(l) + '\n').join(''))
}
const user = (session: string, text: string) => ({ type: 'user', sessionId: session, message: { role: 'user', content: text } })
const assistant = (session: string, content: object[]) => ({ type: 'assistant', sessionId: session, message: { role: 'assistant', content } })
const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string, command: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command } })
const toolResult = (session: string, id: string, out: string) => ({
  type: 'user',
  sessionId: session,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
})

test('106.1 the convos verb lists each sibling with its session id and home card', () => {
  const p = makeProject()
  withConvos(p, [
    { tab: 'tab-a', session: S1, home: 'alpha' },
    { tab: 'tab-b', session: S2, home: 'beta' },
    { tab: 'tab-c', session: S3, home: 'gamma' },
  ])
  const r = p.werk(['convos'])
  expect(r.code).toBe(0)
  const lines = r.stdout.split('\n').filter(Boolean)
  expect(lines).toHaveLength(3)
  for (const [s, h] of [[S1, '#alpha'], [S2, '#beta'], [S3, '#gamma']] as const) {
    const line = lines.find((l) => l.includes(s))
    expect(line).toBeDefined()
    expect(line).toContain(h)
  }
})

test('106.2 recall with a keyword shows only the spoken messages that mention it', () => {
  const p = makeProject()
  withConvos(p, [
    { tab: 'main', session: S1, home: 'alpha' },
    { tab: 'tab-1', session: S2, home: 'beta' },
  ])
  withTranscript(p, S2, [
    user(S2, 'What is our pricing model for teams?'),
    assistant(S2, [text('Let me look at the files.'), toolUse('t1', 'grep -r pricing docs/')]),
    toolResult(S2, 't1', 'docs/plans.md: tool output line'),
    assistant(S2, [text('The pricing is per seat, ten euro a month.')]),
    user(S2, 'Thanks, now the storage question.'),
  ])
  const convos = p.werk(['convos']).stdout
  const line = convos.split('\n').find((l) => l.includes('#beta'))!
  const session = line.match(/[0-9a-f-]{36}/)![0]
  expect(session).toBe(S2)
  const r = p.werk(['recall', session, '--grep', 'pricing'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('What is our pricing model for teams?')
  expect(r.stdout).toContain('The pricing is per seat, ten euro a month.')
  expect(r.stdout).not.toContain('grep -r pricing')
  expect(r.stdout).not.toContain('tool output line')
  expect(r.stdout).not.toContain('storage question')
  expect(r.stdout).not.toContain('Let me look at the files.')
})

test('106.3 recall with no keyword shows user and assistant messages in order, no tools', () => {
  const p = makeProject()
  withConvos(p, [
    { tab: 'main', session: S1 },
    { tab: 'tab-1', session: S2, home: 'beta' },
  ])
  withTranscript(p, S2, [
    user(S2, 'First question from the user.'),
    assistant(S2, [text('First answer.'), toolUse('t1', 'ls secret-dir')]),
    toolResult(S2, 't1', 'result-of-ls'),
    assistant(S2, [text('Second answer.')]),
    user(S2, 'Second question from the user.'),
    assistant(S2, [text('Third answer.')]),
  ])
  const r = p.werk(['recall', S2])
  expect(r.code).toBe(0)
  const order = ['First question from the user.', 'First answer.', 'Second answer.', 'Second question from the user.', 'Third answer.']
  const idx = order.map((t) => r.stdout.indexOf(t))
  for (const i of idx) expect(i).toBeGreaterThanOrEqual(0)
  expect(idx).toEqual([...idx].sort((a, b) => a - b))
  expect(r.stdout).not.toContain('ls secret-dir')
  expect(r.stdout).not.toContain('result-of-ls')
})

test('106.4 recall on an unknown session says it does not know it and exits non-zero', () => {
  const p = makeProject()
  withConvos(p, [{ tab: 'main', session: S1, home: 'alpha' }])
  const unknown = '99999999-0000-4000-8000-000000000009'
  const r = p.werk(['recall', unknown])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain(unknown)
  expect(r.stderr).toMatch(/no conversation|unknown|not know/i)
})
