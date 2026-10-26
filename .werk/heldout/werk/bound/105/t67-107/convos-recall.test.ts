/** Held-out steps 106.1 to 106.4: the convos and recall verbs. */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const S2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const S3 = 'cccccccc-0000-4000-8000-000000000003'

function convos(p: Project, entries: object[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'conversations.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''))
}

function transcript(p: Project, session: string, lines: object[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-proj')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${session}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const said = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const toolCall = (id: string, command: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
})
const toolResult = (id: string, content: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content }] },
})

test('106.1 an agent lists the sibling conversations of its project', () => {
  const p = makeProject()
  convos(p, [
    { tab: 'main', session: S1, home: 'alpha' },
    { tab: 'tab-1', session: S2, home: 'beta' },
    { tab: 'tab-2', session: S3, home: 'gamma' },
  ])
  const r = p.werk(['convos'])
  expect(r.code).toBe(0)
  const lines = r.stdout.split('\n').filter(Boolean)
  expect(lines).toHaveLength(3)
  for (const [s, h] of [[S1, 'alpha'], [S2, 'beta'], [S3, 'gamma']] as const) {
    const line = lines.find((l) => l.includes(s))
    expect(line).toBeDefined()
    expect(line!).toContain(`#${h}`)
  }
})

test('106.2 an agent reads what a sibling said about a keyword', () => {
  const p = makeProject()
  convos(p, [
    { tab: 'main', session: S1, home: 'alpha' },
    { tab: 'tab-1', session: S2, home: 'beta' },
  ])
  transcript(p, S2, [
    user('What should the pricing page show?'),
    said('The pricing page shows three plans.'),
    toolCall('t1', 'grep -r pricing web/'),
    toolResult('t1', 'web/pricing.tsx: export function Pricing'),
    said('The checkout flow needs no change.'),
    user('Thanks, that is all.'),
  ])
  const list = p.werk(['convos']).stdout
  const sibling = list.split('\n').find((l) => l.includes('#beta'))!
  const session = sibling.match(/[0-9a-f]{8}-[0-9a-f-]{27}/)![0]
  expect(session).toBe(S2)
  const r = p.werk(['recall', session, '--grep', 'pricing'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('What should the pricing page show?')
  expect(r.stdout).toContain('The pricing page shows three plans.')
  expect(r.stdout).not.toContain('grep -r pricing')
  expect(r.stdout).not.toContain('export function Pricing')
  expect(r.stdout).not.toContain('checkout flow')
  expect(r.stdout).not.toContain('Thanks, that is all.')
})

test('106.3 an agent reads a whole sibling conversation without a keyword', () => {
  const p = makeProject()
  convos(p, [
    { tab: 'main', session: S1, home: 'alpha' },
    { tab: 'tab-1', session: S2, home: 'beta' },
  ])
  transcript(p, S2, [
    user('First question from the user.'),
    said('First answer from the assistant.'),
    toolCall('t1', 'ls -la secret-dir'),
    toolResult('t1', 'tool-output-marker'),
    user('Second question from the user.'),
    said('Second answer from the assistant.'),
  ])
  const r = p.werk(['recall', S2])
  expect(r.code).toBe(0)
  const order = ['First question from the user.', 'First answer from the assistant.', 'Second question from the user.', 'Second answer from the assistant.']
  const at = order.map((t) => r.stdout.indexOf(t))
  for (const i of at) expect(i).toBeGreaterThan(-1)
  expect(at).toEqual([...at].sort((a, b) => a - b))
  expect(r.stdout).not.toContain('ls -la secret-dir')
  expect(r.stdout).not.toContain('tool-output-marker')
})

test('106.4 an agent asks for a session that does not exist', () => {
  const p = makeProject()
  convos(p, [{ tab: 'main', session: S1, home: 'alpha' }])
  const unknown = 'dddddddd-0000-4000-8000-00000000dead'
  const r = p.werk(['recall', unknown])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/no conversation|unknown|not know/i)
  expect(r.stderr + r.stdout).toContain(unknown)
})
