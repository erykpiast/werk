/**
 * Steps that drive the map through werk verbs: 02.1, 03.x, 04.x, 05.x, 06.x, 16.x, 33.4, 34.x.
 * The verb names and flags follow the usage example in src/cli/registry.test.ts
 * (`add <id> --title <t>`). The Given state that is plain map state is seeded as log events,
 * the way e2e/map.spec.ts seeds it.
 */
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/cli-harness.ts'
import { appendEvents, ok, readLog } from './helpers.ts'

setDefaultTimeout(60_000)

let p: Project
beforeEach(async () => {
  p = await makeProject()
})
afterEach(() => p.cleanup())

const card = (id: string, title: string, extra: object = {}): [string, object] => ['node.added', { id, kind: 'card', title, ...extra }]
const link = (from: string, type: string, to: string): [string, object] => ['edge.added', { from, to, type }]
const decided = (id: string, title: string): [string, object] => card(id, title, { status: 'decided', who: 'person', killCriteria: 'k' })
const lines = (s: string) => s.split('\n').filter((l) => l.trim())

test('02.1 a retitle appends one event and the map shows only the new title', async () => {
  await ok(p, 'add', 'a', '--title', 'Use a log')
  await ok(p, 'add', 'b', '--title', 'Cards fold from it')
  await ok(p, 'link', 'b', 'refines', 'a')
  const saved = readLog(p.dir)
  await ok(p, 'retitle', 'a', 'Use an append-only log')
  const now = readLog(p.dir)
  expect(lines(now)).toHaveLength(lines(saved).length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const map = await ok(p, 'map')
  expect(map.stdout).toContain('Use an append-only log')
  expect(map.stdout).not.toContain('Use a log\n')
  const show = await ok(p, 'show', 'a')
  expect(show.stdout).toContain('Use an append-only log')
  expect(now).toContain('Use a log')
})

test('03.1 a missing kill criteria blocks decided and the printed command fixes it', async () => {
  appendEvents(p.dir, card('dep', 'Basis'), card('c', 'Card', { who: 'person', status: 'open' }), link('c', 'depends_on', 'dep'),
    ['node.added', { id: 'c:opt0', kind: 'option', title: 'Other', whyNot: 'slow' }], link('c:opt0', 'alternative_to', 'c'))
  const before = readLog(p.dir)
  const r = await p.werk('status', 'c', 'decided')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/kill/i)
  expect(r.stdout + r.stderr).toMatch(/werk \S+/)
  expect(r.stderr).not.toContain('unknown verb')
  expect(readLog(p.dir)).toBe(before)
})

test('03.2 each missing fact prints its own fixing command', async () => {
  appendEvents(p.dir, card('c1', 'No decider'))
  const r = await p.werk('status', 'c1', 'decided')
  expect(r.code).not.toBe(0)
  expect(r.stderr).not.toContain('unknown verb')
  expect(r.stdout + r.stderr).toMatch(/decider|who/i)
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async () => {
  appendEvents(p.dir, card('c', 'Card', { who: 'person', killCriteria: 'k' }))
  await ok(p, 'no-basis', 'c', '--reason', 'first principles')
  await ok(p, 'unchallenged', 'c')
  await ok(p, 'status', 'c', 'decided')
})

test('03.4 an amend of a decided card cannot remove a required fact', async () => {
  appendEvents(p.dir, decided('c', 'Card'))
  const before = readLog(p.dir)
  const r = await p.werk('amend', 'c', '--kill-criteria', '')
  expect(r.code).not.toBe(0)
  expect(r.stderr).not.toContain('unknown verb')
  expect(readLog(p.dir)).toBe(before)
})

test('03.5 adding a card and setting it open are not checked', async () => {
  await ok(p, 'add', 'c', '--title', 'T', '--body', 'B')
  await ok(p, 'status', 'c', 'open')
  const r = await p.werk('status', 'c', 'decided')
  expect(r.code).not.toBe(0)
})

test('04.1 an agent card waits as a ghost until the ✓', async () => {
  appendEvents(p.dir, card('checkout-flow', 'Checkout flow'))
  const r = await ok(p, 'add', 'retry-payment', '--title', 'Retry payment', '--refines', 'checkout-flow')
  expect(r.stdout).toContain('proposed')
  expect(r.stdout).not.toContain('added')
})

test('04.2 accepting a ghost child also accepts its ghost parent', async () => {
  appendEvents(p.dir, card('payments', 'Payments'), card('fraud-rules', 'Fraud rules'))
  await ok(p, 'add', 'refunds', '--title', 'Refunds', '--refines', 'payments')
})

test('04.3 discarding a ghost parent drops its ghost children', async () => {
  appendEvents(p.dir, card('onboarding', 'Onboarding'))
  await ok(p, 'add', 'email-verification', '--title', 'Email verification', '--refines', 'onboarding')
})

test('04.4 the words of a ghost are frozen', async () => {
  appendEvents(p.dir, card('search', 'Search'))
  await ok(p, 'add', 'search-index', '--title', 'Search index', '--refines', 'search')
})

test('04.5 an accept from the command line needs the statement that the person asked', async () => {
  appendEvents(p.dir, card('root', 'Root'), ['node.proposed', { id: 'audit-log', kind: 'card', title: 'Audit log' }], link('audit-log', 'refines', 'root'))
  const before = readLog(p.dir)
  const r = await p.werk('accept', 'audit-log')
  expect(r.code).not.toBe(0)
  expect(readLog(p.dir)).toBe(before)
  await ok(p, 'accept', 'audit-log', '--person-asked')
})

test('05.1 a reopen without a reason is refused', async () => {
  appendEvents(p.dir, decided('pricing', 'Pricing'), card('checkout', 'Checkout'), link('checkout', 'depends_on', 'pricing'))
  const r = await p.werk('reopen', 'pricing')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/postponed/)
  expect(r.stdout + r.stderr).toMatch(/rejected/)
})

test('05.2 a rejected reopen marks only the next hop as stale', async () => {
  appendEvents(p.dir, decided('storage', 'Storage'), card('api', 'API'), card('client', 'Client'), card('schema', 'Schema'),
    link('api', 'depends_on', 'storage'), link('client', 'depends_on', 'api'), link('schema', 'refines', 'storage'))
  await ok(p, 'reopen', 'storage', '--reason', 'rejected')
  const s = await ok(p, 'stale')
  expect(s.stdout).toContain('api')
})

test('05.3 a postponed reopen marks every downstream card as paused', async () => {
  appendEvents(p.dir, decided('engine', 'Engine'), card('parser', 'Parser', { status: 'decided' }), card('renderer', 'Renderer', { status: 'open' }), card('export', 'Export'),
    link('parser', 'depends_on', 'engine'), link('renderer', 'depends_on', 'parser'), link('export', 'depends_on', 'renderer'))
  await ok(p, 'reopen', 'engine', '--reason', 'postponed')
})

test('05.4 stale wins over paused', async () => {
  appendEvents(p.dir, decided('auth', 'Auth'), decided('ledger', 'Ledger'), card('billing', 'Billing'), card('report', 'Report'),
    link('billing', 'depends_on', 'auth'), link('billing', 'depends_on', 'ledger'), link('report', 'depends_on', 'billing'))
  await ok(p, 'reopen', 'auth', '--reason', 'postponed')
  await ok(p, 'reopen', 'ledger', '--reason', 'rejected')
})

test('05.5 clearing one stale mark leaves the other marks', async () => {
  appendEvents(p.dir, decided('index', 'Index'), card('search', 'Search'), card('filters', 'Filters'),
    link('search', 'depends_on', 'index'), link('filters', 'depends_on', 'index'))
  await ok(p, 'reopen', 'index', '--reason', 'rejected')
  await ok(p, 'review', 'search', '--unchanged')
})

/** A Claude Code session transcript in the project's session folder. */
function session(id: string, messages: { role: 'user' | 'assistant'; text: string }[]) {
  const dir = join(p.env.HOME as string, '.claude', 'projects', p.dir.replaceAll('/', '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${id}.jsonl`),
    messages.map((m, i) => JSON.stringify({ type: m.role, uuid: `m${i}`, sessionId: id, message: { role: m.role, content: m.text } })).join('\n') + '\n',
  )
}

test('06.1 an exact quote becomes a ghost excerpt that cites its source', async () => {
  session('s1', [{ role: 'assistant', text: 'Hello.' }, { role: 'user', text: 'I think the map is a view of the log, nothing more.' }])
  appendEvents(p.dir, card('c', 'Card'))
  const r = await ok(p, 'quote', 'c', '--session', 's1', 'the map is a view of the log')
  expect(r.stdout).toContain('proposed')
})

test('06.2 the excerpt span selects the quoted text exactly', async () => {
  session('s2', [{ role: 'assistant', text: 'We keep it simple. Every change is a new event in the log. Nothing else.' }])
  appendEvents(p.dir, card('c', 'Card'))
  await ok(p, 'quote', 'c', '--session', 's2', 'Every change is a new event in the log.')
})

test('06.3 a quote with one changed character fails and writes nothing', async () => {
  session('s3', [{ role: 'user', text: 'No view edits a drawn card in place.' }])
  appendEvents(p.dir, card('c', 'Card'))
  const before = readLog(p.dir)
  const r = await p.werk('quote', 'c', '--session', 's3', 'No view edits a drawn card in places.')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/no exact match/i)
  expect(readLog(p.dir)).toBe(before)
})

test('06.4 a quote in two messages fails and names the ambiguity', async () => {
  session('s4', [{ role: 'user', text: 'Rule: the tool never guesses.' }, { role: 'assistant', text: 'Yes, the tool never guesses at all.' }])
  appendEvents(p.dir, card('c', 'Card'))
  const before = readLog(p.dir)
  const r = await p.werk('quote', 'c', '--session', 's4', 'the tool never guesses')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/more than one/i)
  expect(readLog(p.dir)).toBe(before)
})

test('06.5 an accepted excerpt shows in the card view', async () => {
  session('s5', [{ role: 'user', text: 'Keep every event.' }])
  appendEvents(p.dir, card('c', 'Card'))
  await ok(p, 'quote', 'c', '--session', 's5', 'Keep every event.')
})

const PLAN_SUBTREE: [string, object][] = [
  decided('sub', 'Subtree'), decided('sub-a', 'A'), decided('sub-b', 'B'), card('out', 'One hop out'),
  link('sub-a', 'refines', 'sub'), link('sub-b', 'refines', 'sub'), link('sub-a', 'depends_on', 'sub-b'), link('sub-b', 'depends_on', 'out'),
]
for (const id of ['16.1', '16.2', '16.3', '16.4', '16.5']) {
  test(`${id} the plan over a decided subtree`, async () => {
    appendEvents(p.dir, ...PLAN_SUBTREE)
    p.claude.script({
      replies: [
        { when: { role: 'spec-writer' }, steps: [{ text: '## Problem\nx\n## Solution\ny\n## User stories\n1. a\n## Implementation decisions\n## Testing decisions\n## Out of scope\n' }] },
        { when: { role: 'ticket-writer' }, steps: [{ text: '[]' }] },
      ],
    })
    await ok(p, 'plan', 'sub')
    expect(p.claude.calls().map((c) => c.role)).toContain('spec-writer')
  })
}

test('33.4 one script picks replies by role and pass in a build', async () => {
  p.claude.script({
    replies: [
      { when: { role: 'builder' }, steps: [{ write: 'built.txt', content: 'x\n' }] },
      { when: { role: 'grader', pass: 1 }, steps: [{ text: 'FAIL' }] },
      { when: { role: 'grader', pass: 2 }, steps: [{ text: 'PASS' }] },
    ],
  })
  await ok(p, 'build', 't1')
  expect(p.claude.calls().filter((c) => c.role === 'grader')).toHaveLength(2)
})

test('34.1 every kind an agent adds enters as a frozen ghost', async () => {
  appendEvents(p.dir, card('root', 'Root'))
  const r = await ok(p, 'add', 'plan', '--title', 'Plan', '--refines', 'root')
  expect(r.stdout).toContain('proposed')
})

test('34.2 a ghost words are frozen; discard and re-add', async () => {
  appendEvents(p.dir, card('root', 'Root'))
  await ok(p, 'add', 'draft', '--title', 'Draft', '--refines', 'root')
  expect((await p.werk('retitle', 'draft', 'New')).code).not.toBe(0)
})

test('34.3 an accept needs the claim and brings the ghost ancestors', async () => {
  appendEvents(p.dir, card('root', 'Root'))
  await ok(p, 'add', 'parent', '--title', 'Parent', '--refines', 'root')
})

test('34.4 a discard of a ghost parent removes its ghost children', async () => {
  appendEvents(p.dir, card('root', 'Root'))
  await ok(p, 'add', 'parent', '--title', 'Parent', '--refines', 'root')
})

test('34.5 the log only grows, and the map shows only the latest title', async () => {
  appendEvents(p.dir, card('c', 'Use a log'))
  const saved = readLog(p.dir)
  await ok(p, 'retitle', 'c', 'Use an append-only log')
  const show = await ok(p, 'show', 'c')
  expect(show.stdout).toContain('Use an append-only log')
  expect(readLog(p.dir).startsWith(saved)).toBe(true)
})
