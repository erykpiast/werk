/** Held-out steps 84.1 - 84.5: the grader and the five reviewers after green checks. */
import { afterEach, expect, test } from 'bun:test'
import type { TicketFields } from '../../src/board/events.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'
import { boardTicket, grading, judges, makeBuildProject, prompts, result, REVIEWERS, reviewing, runRecord } from './helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

/** The check always passes. */
const MAKEFILE = 'check:\n\t@echo the check is green\n'
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

const ticketOf = (criteria: string[], cites: string[], brief = 'Make done.txt.'): TicketFields => ({
  number: 3,
  title: 'The thing is done',
  cites,
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: `## What to build\n\n${brief}\n\n## Acceptance criteria\n\n${criteria.map((c) => `- ${c}`).join('\n')}`,
  root: 'root',
})

const roles = (p: Project) => p.agentRoles().filter((r) => !(r ?? '').startsWith('heldout-')) as string[]
const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('store', { status: 'decided', parent: 'root', title: 'Cards are never written in place' }),
    accepted('store'),
  )
  p = makeBuildProject({ makefile: MAKEFILE, ticket: ticketOf(['done.txt is there.', 'done.txt holds done.'], ['store']), log })
  const GAP = 'the diff writes the card in place, the card forbids it'
  const failing = grading(
    ['ac-1', 'ac-2', '#store'],
    (id) => (id === '#store' ? 2 : 4),
    (id) => (id === '#store' ? `${GAP} (src/store.ts:12)` : 'none'),
  )
  p.scriptAgent({
    steps: [],
    roles: { ...judges(['ac-1', 'ac-2', '#store']), builder: [finishing], grader: [failing, grading(['ac-1', 'ac-2', '#store'])] },
  })
  const r = p.werk(['build', '3', '--cap', '2'])
  // The first pass fails at the grader step.
  const [first] = runRecord(p)
  expect(first.green).toBe(false)
  expect(first.checks.every((c: { ok: boolean }) => c.ok)).toBe(true)
  expect(first.grade.pass).toBe(false)
  expect(r.stdout).toContain('pass 1: red at the grader')
  // No reviewer runs for the first pass.
  expect(first.review).toBeUndefined()
  const order = roles(p)
  const secondBuilder = order.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(order.slice(0, secondBuilder).filter((x) => x.startsWith('reviewer-'))).toEqual([])
  // A second pass starts.
  expect(prompts(p, 'builder')).toHaveLength(2)
  // The second prompt holds the gap with its file and line.
  const failure = lastFailure(prompts(p, 'builder')[1]!)
  expect(failure).toContain(GAP)
  expect(failure).toContain('src/store.ts:12')
}, 30_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('cited', { status: 'decided', parent: 'root', title: 'CITED-CARD-TITLE' }),
    proposed('uncited', { status: 'decided', parent: 'root', title: 'UNCITED-CARD-TITLE' }),
    proposed('opencard', { status: 'open', parent: 'root', title: 'OPEN-CARD-TITLE' }),
    accepted('cited'),
    accepted('uncited'),
    accepted('opencard'),
    linked('cited', 'uncited', 'depends_on'),
    linked('uncited', 'opencard', 'depends_on'),
  )
  p = makeBuildProject({ makefile: MAKEFILE, ticket: ticketOf(['CRIT-ONE.', 'CRIT-TWO.', 'CRIT-THREE.'], ['cited']), log })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#cited', '#uncited']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  p.werk(['build', '3', '--cap', '1'])
  const grader = prompts(p, 'grader')[0]
  expect(grader).toBeDefined()
  const linesSection = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('\n## ', grader!.indexOf('## Lines') + 3))
  const bullets = linesSection.split('\n').filter((l) => l.startsWith('- '))
  // Three delivery lines, one per criterion.
  const delivery = bullets.filter((l) => l.includes('(delivery)'))
  expect(delivery).toHaveLength(3)
  expect(delivery.join('\n')).toContain('CRIT-ONE.')
  expect(delivery.join('\n')).toContain('CRIT-TWO.')
  expect(delivery.join('\n')).toContain('CRIT-THREE.')
  // One contradiction line for the cited card and one for the uncited decided card.
  const contradiction = bullets.filter((l) => l.includes('(contradiction)'))
  expect(contradiction).toHaveLength(2)
  expect(contradiction.filter((l) => l.includes('CITED-CARD-TITLE') && !l.includes('UNCITED'))).toHaveLength(1)
  expect(contradiction.filter((l) => l.includes('UNCITED-CARD-TITLE'))).toHaveLength(1)
  // No line for the open card.
  expect(linesSection).not.toContain('OPEN-CARD-TITLE')
  expect(linesSection).not.toContain('#opencard')
  // The brief states that an unbuilt part of a card passes its contradiction line.
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 30_000)

const simpleLog = () =>
  logOf(
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', title: 'CARD-TITLE-MARK', body: 'Part one: PART-ONE-MARK.\n\nPart two: PART-TWO-MARK.' }),
    accepted('loop'),
  )
const LINES = ['ac-1', '#loop']

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  p = makeBuildProject({ makefile: MAKEFILE, ticket: ticketOf(['done.txt is there.'], ['loop'], 'Build part one of the card: BRIEF-MARK.'), log: simpleLog() })
  const unbuilt = grading(LINES, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'not built yet: part two belongs to another ticket' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3', '--cap', '1'])
  // The pass does not fail at the grader step.
  const [line] = runRecord(p)
  expect(line.grade.pass).toBe(true)
  expect(r.stdout).not.toContain('red at the grader')
  // Five reviewers start, one per area.
  const reviewers = roles(p).filter((x) => x.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  const areas = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, area] of areas.entries()) {
    const ps = prompts(p, REVIEWERS[i]!)
    expect(ps).toHaveLength(1)
    expect(ps[0]).toContain(`You are the ${area} reviewer`)
    // Each reviewer receives the diff of the ticket only.
    expect(ps[0]).toContain('+done')
    expect(ps[0]).not.toContain('BRIEF-MARK')
    expect(ps[0]).not.toContain('done.txt is there.')
    expect(ps[0]).not.toContain('CARD-TITLE-MARK')
    expect(ps[0]).not.toContain('PART-ONE-MARK')
  }
}, 30_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  p = makeBuildProject({ makefile: MAKEFILE, ticket: ticketOf(['done.txt is there.'], ['loop']), log: simpleLog() })
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 42, impact: 'the token is written to the log', fix: 'redact the token before the log call' }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3', '--cap', '2'])
  const lines = runRecord(p)
  // The first pass fails at the review step.
  expect(lines[0].grade.pass).toBe(true)
  expect(lines[0].review.pass).toBe(false)
  expect(lines[0].green).toBe(false)
  expect(r.stdout).toContain('pass 1: red at the review')
  // A second pass starts.
  expect(prompts(p, 'builder')).toHaveLength(2)
  // The second prompt holds the HIGH finding with its file, line, impact and fix.
  const failure = lastFailure(prompts(p, 'builder')[1]!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('src/auth.ts:42')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('redact the token before the log call')
  // The second pass runs the checks, the grader and all five reviewers again.
  expect(lines).toHaveLength(2)
  expect(lines[1].checks.length).toBeGreaterThan(0)
  expect(lines[1].grade).toBeDefined()
  expect(lines[1].review).toBeDefined()
  const all = roles(p)
  expect(all.filter((x) => x === 'grader')).toHaveLength(2)
  for (const rv of REVIEWERS) expect(all.filter((x) => x === rv)).toHaveLength(2)
}, 30_000)

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = makeBuildProject({ makefile: MAKEFILE, ticket: ticketOf(['done.txt is there.'], ['loop']), log: simpleLog() })
  const medium = { severity: 'MEDIUM', file: 'src/a.ts', line: 7, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'src/b.ts', line: 9, impact: 'no newline at the end', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(LINES), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  // The first pass goes green and no second pass starts.
  expect(r.code).toBe(0)
  expect(prompts(p, 'builder')).toHaveLength(1)
  const lines = runRecord(p)
  expect(lines).toHaveLength(1)
  expect(lines[0].green).toBe(true)
  // The run record holds the MEDIUM and the LOW finding with severity, file, line, impact and fix.
  expect(lines[0].ticket).toBe(3)
  expect(lines[0].review.findings).toContainEqual(expect.objectContaining(medium))
  expect(lines[0].review.findings).toContainEqual(expect.objectContaining(low))
  // The ticket leaves building.
  expect(boardTicket(p, 3)?.column).not.toBe('building')
}, 30_000)
