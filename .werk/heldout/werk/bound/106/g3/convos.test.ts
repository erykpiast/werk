/** Held-out steps 106.1-106.4: the convos and recall verbs. */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

const S1 = '11111111-0000-4000-8000-000000000001'
const S2 = '22222222-0000-4000-8000-000000000002'
const S3 = '33333333-0000-4000-8000-000000000003'

function withConvos(lines: object[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'conversations.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''))
  return p
}
function transcript(p: Project, session: string, entries: object[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-worktree')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${session}.jsonl`), entries.map((e) => JSON.stringify({ sessionId: session, ...e }) + '\n').join(''))
}
const user = (uuid: string, content: unknown) => ({ type: 'user', uuid, message: { role: 'user', content } })
const assistant = (uuid: string, content: unknown[]) => ({ type: 'assistant', uuid, message: { role: 'assistant', content } })

test('106.1 an agent lists the sibling conversations of its project', () => {
  const p = withConvos([
    { tab: 'main', session: S1, home: 'werk' },
    { tab: 'tab-1', session: S2, home: 'log' },
    { tab: 'tab-2', session: S3, home: 'map' },
  ])
  const r = p.werk(['convos'])
  expect(r.code).toBe(0)
  const lines = r.stdout.split('\n').filter(Boolean)
  expect(lines).toHaveLength(3)
  for (const [s, home] of [[S1, 'werk'], [S2, 'log'], [S3, 'map']] as const) {
    const line = lines.find((l) => l.includes(s))
    expect(line).toBeDefined()
    expect(line).toContain(`#${home}`)
  }
})

function pricingProject(): Project {
  const p = withConvos([
    { tab: 'main', session: S1, home: 'werk' },
    { tab: 'tab-1', session: S2, home: 'log' },
  ])
  transcript(p, S2, [
    user('u1', 'What should the pricing page say?'),
    assistant('u2', [{ type: 'text', text: 'Start with the shipping rules.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'grep -r pricing docs' } }]),
    user('u3', [{ type: 'tool_result', tool_use_id: 't1', content: 'docs/pricing.md: tiers' }]),
    assistant('u4', [{ type: 'text', text: 'The pricing has three tiers.' }]),
    user('u5', 'Thanks, that is all.'),
  ])
  return p
}

test('106.2 an agent reads what a sibling said about a keyword', () => {
  const p = pricingProject()
  const convos = p.werk(['convos'])
  const line = convos.stdout.split('\n').find((l) => l.includes('#log'))!
  const session = line.match(/[0-9a-f]{8}-[0-9a-f-]{27}/)![0]
  expect(session).toBe(S2)
  const r = p.werk(['recall', session, '--grep', 'pricing'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('What should the pricing page say?')
  expect(r.stdout).toContain('The pricing has three tiers.')
  expect(r.stdout).not.toContain('grep -r pricing docs')
  expect(r.stdout).not.toContain('docs/pricing.md')
  expect(r.stdout).not.toContain('shipping rules')
  expect(r.stdout).not.toContain('Thanks, that is all.')
})

test('106.3 an agent reads a whole sibling conversation without a keyword', () => {
  const p = pricingProject()
  const r = p.werk(['recall', S2])
  expect(r.code).toBe(0)
  const order = ['What should the pricing page say?', 'Start with the shipping rules.', 'The pricing has three tiers.', 'Thanks, that is all.']
  const at = order.map((t) => r.stdout.indexOf(t))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
  expect(r.stdout).not.toContain('grep -r pricing docs')
  expect(r.stdout).not.toContain('docs/pricing.md')
})

test('106.4 an agent asks for a session that does not exist', () => {
  const p = withConvos([{ tab: 'main', session: S1, home: 'werk' }])
  const unknown = '99999999-dead-4000-8000-000000000000'
  const r = p.werk(['recall', unknown])
  expect(r.stderr + r.stdout).toContain(unknown)
  expect(r.stderr + r.stdout).toMatch(/no conversation|unknown|not know/i)
  expect(r.code).not.toBe(0)
})
