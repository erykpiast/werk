import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../src/test/harness.ts'
import {
  accepted,
  boardTicket,
  finishing,
  grading,
  judges,
  lastFailure,
  launchedRoles,
  linked,
  prompts,
  proposed,
  REVIEWERS,
  reviewing,
  runRecord,
  setupProject,
} from './s83-helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const twoAc = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds done.'
const storeMap = [
  proposed('root', { status: 'decided' }),
  proposed('store', { status: 'decided', parent: 'root', title: 'Cards are append-only', body: 'Never write a card in place.' }),
  accepted('store'),
]

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = setupProject({ ticket: { cites: ['store'], brief: twoAc }, map: storeMap })
  const lines = ['ac-1', 'ac-2', '#store']
  const GAP = 'the diff writes the card in place, the card forbids it'
  const failing = grading(lines, (id) => (id === '#store' ? 2 : 4), (id) => (id === '#store' ? `${GAP} (src/store.ts:42)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(lines), builder: [finishing], grader: [failing, grading(lines, () => 4)] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = launchedRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder)).toEqual(['builder', 'grader'])
  const second = prompts(p)[1]!
  expect(lastFailure(second)).toContain(GAP)
  expect(lastFailure(second)).toContain('src/store.ts:42')
}, 60_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('alpha', { status: 'decided', parent: 'root', title: 'Alpha card' }),
    proposed('beta', { status: 'decided', title: 'Beta card' }),
    proposed('gamma', { status: 'open', title: 'Gamma card' }),
    accepted('alpha'),
    accepted('beta'),
    accepted('gamma'),
    linked('alpha', 'beta', 'depends_on'),
    linked('beta', 'gamma', 'depends_on'),
  ]
  const brief = '## What to build\n\nX.\n\n## Acceptance criteria\n\n- first crit.\n- second crit.\n- third crit.'
  p = setupProject({ ticket: { cites: ['alpha'], brief }, map })
  const lines = ['ac-1', 'ac-2', 'ac-3', '#alpha', '#beta']
  p.scriptAgent({ steps: [], roles: { ...judges(lines), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: green')
  const [grader] = prompts(p, 'grader')
  const lineBlock = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket:'))
  const delivery = lineBlock.split('\n').filter((l) => l.includes('(delivery)'))
  const contradiction = lineBlock.split('\n').filter((l) => l.includes('(contradiction)'))
  expect(delivery).toEqual(['- ac-1 (delivery): first crit.', '- ac-2 (delivery): second crit.', '- ac-3 (delivery): third crit.'])
  expect(contradiction).toEqual(['- #alpha (contradiction): Alpha card', '- #beta (contradiction): Beta card'])
  expect(grader).not.toContain('gamma')
  expect(grader).not.toContain('Gamma card')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 60_000)

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('twoparts', {
      status: 'decided',
      parent: 'root',
      title: 'Two-part card',
      body: 'Part one: write done.txt. Part two: write later.txt.',
    }),
    accepted('twoparts'),
  ]
  p = setupProject({ ticket: { cites: ['twoparts'], title: 'Build part one', brief: '## What to build\n\nPart one only.\n\n## Acceptance criteria\n\n- done.txt is there.' }, map })
  const lines = ['ac-1', '#twoparts']
  const grader = grading(lines, (id) => (id === '#twoparts' ? 3 : 4), (id) => (id === '#twoparts' ? 'not built yet: part two (later.txt)' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(lines), builder: [finishing], grader } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  expect(launchedRoles(p)).toEqual(['builder', 'grader', ...REVIEWERS])
  const titles = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, role] of REVIEWERS.entries()) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain(`You are the ${titles[i]} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Two-part card')
    expect(prompt).not.toContain('Part two: write later.txt')
    expect(prompt).not.toContain('Build part one')
    expect(prompt).not.toContain('Part one only.')
  }
}, 60_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  p = setupProject()
  const lines = ['ac-1', '#loop']
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 17, impact: 'the token is written to the log', fix: 'redact the token before logging' }
  p.scriptAgent({ steps: [], roles: { ...judges(lines), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const ps = prompts(p)
  expect(ps.length).toBeGreaterThanOrEqual(2)
  const f = lastFailure(ps[1]!)
  expect(f).toContain('HIGH')
  expect(f).toContain('src/auth.ts:17')
  expect(f).toContain('the token is written to the log')
  expect(f).toContain('redact the token before logging')
  expect(launchedRoles(p)).toEqual(['builder', 'grader', ...REVIEWERS, 'builder', 'grader', ...REVIEWERS])
  const second = runRecord(p)[1]
  expect(second.checks.length).toBeGreaterThan(0)
  expect(second.grade).toBeDefined()
  expect(second.review).toBeDefined()
}, 60_000)

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = setupProject()
  const lines = ['ac-1', '#loop']
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(lines), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  const rec = runRecord(p)
  expect(rec).toHaveLength(1)
  expect(rec[0].review.findings).toEqual(
    expect.arrayContaining([
      { area: 'maintainability', ...medium },
      { area: 'tests', ...low },
    ]),
  )
  // The ticket leaves building.
  expect(boardTicket(p)?.column).not.toBe('building')
}, 60_000)
