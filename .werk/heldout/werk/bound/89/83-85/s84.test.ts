import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import {
  accepted,
  boardTicket,
  buildRoles,
  finishing,
  grading,
  judges,
  lastFailure,
  linked,
  project,
  prompts,
  proposed,
  REVIEWERS,
  reviewing,
  runRecord,
} from './util.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const twoCriteria = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.'

// 84.1
// Scenario: A grader score of 2 fails the pass and the gap reaches the next pass
// Given a ticket that cites one decided card and has two acceptance criteria
// And the checks for the ticket pass
// And the grader scores the contradiction line of that card 2, with the gap "the diff writes the card in place, the card forbids it" and the file and line that show it
// When the person starts the build of the ticket
// Then the first pass fails at the grader step
// And no reviewer runs for the first pass
// And a second pass starts
// And the prompt of the second pass holds the gap "the diff writes the card in place, the card forbids it" with its file and line
test('84.1', () => {
  p = project({ fields: { brief: twoCriteria } })
  const ids = ['ac-1', 'ac-2', '#loop']
  const GAP = 'the diff writes the card in place, the card forbids it'
  const failing = grading(
    ids,
    (id) => (id === '#loop' ? 2 : 4),
    (id) => (id === '#loop' ? `${GAP} (src/cards.ts:42)` : 'none'),
  )
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: [failing, grading(ids, () => 4)] } })
  const r = p.werk(['build', '3'])
  console.log('84.1 stdout:\n' + r.stdout + '\nroles: ' + JSON.stringify(buildRoles(p)))
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).filter((x) => x.startsWith('reviewer-'))).toEqual([])
  const [first] = runRecord(p)
  expect(first.review).toBeUndefined()
  const second = prompts(p)[1]!
  const failure = lastFailure(second)
  console.log('84.1 second prompt failure: ' + JSON.stringify(failure))
  expect(failure).toContain(GAP)
  expect(failure).toContain('src/cards.ts:42')
}, 120_000)

// 84.2
// Scenario: The grader judges every decided card in the depends_on closure, cited or not
// Given a ticket with three acceptance criteria that cites one decided card
// And the cited card depends on a second decided card that the ticket does not cite
// And the second card depends on a third card that is still open
// When the person starts the build of the ticket and the checks pass
// Then the grader receives three delivery lines, one per acceptance criterion
// And the grader receives one contradiction line for the cited card and one for the uncited decided card
// And the grader receives no line for the open card
// And the grader's brief states that a part of a card the diff does not build yet passes its contradiction line
test('84.2', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('cited', { status: 'decided', parent: 'root', title: 'The cited card' }),
    proposed('uncited', { status: 'decided', title: 'The uncited decided card' }),
    proposed('opencard', { status: 'open', title: 'The still open card' }),
    accepted('cited'),
    accepted('uncited'),
    accepted('opencard'),
    linked('cited', 'uncited', 'depends_on'),
    linked('uncited', 'opencard', 'depends_on'),
  ]
  const brief = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- first criterion.\n- second criterion.\n- third criterion.'
  p = project({ fields: { brief, cites: ['cited'] }, map })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#cited', '#uncited']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  console.log('84.2 stdout:\n' + r.stdout)
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const section = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('\n## ', grader!.indexOf('## Lines') + 3))
  console.log('84.2 lines section:\n' + section)
  const bullets = section.split('\n').filter((l) => l.startsWith('- '))
  expect(bullets.filter((l) => l.includes('(delivery)'))).toEqual([
    '- ac-1 (delivery): first criterion.',
    '- ac-2 (delivery): second criterion.',
    '- ac-3 (delivery): third criterion.',
  ])
  expect(bullets.filter((l) => l.includes('(contradiction)'))).toEqual([
    '- #cited (contradiction): The cited card',
    '- #uncited (contradiction): The uncited decided card',
  ])
  expect(grader).not.toContain('opencard')
  expect(grader).not.toContain('The still open card')
  expect(grader).toMatch(/part of a card that the diff does not build yet passes its contradiction line/i)
}, 120_000)

// 84.3
// Scenario: An unbuilt part of a card passes its line and the pass goes on to the review
// Given a ticket that cites a decided card with two parts, and the ticket builds only the first part
// And the checks for the ticket pass
// And the grader scores every line 3 or more, and marks the second part of the card as not built yet with score 3
// When the person starts the build of the ticket
// Then the pass does not fail at the grader step
// And five reviewers start for the pass, one each for design, maintainability, tests, security and dependencies, and performance
// And each reviewer receives the diff of the ticket only
test('84.3', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('loop', {
      status: 'decided',
      parent: 'root',
      title: 'The two part card',
      body: 'Part one: the loop writes done.txt. Part two: the loop has a retry cap.',
    }),
    accepted('loop'),
  ]
  p = project({ map })
  const ids = ['ac-1', '#loop']
  const unbuilt = grading(
    ids,
    (id) => (id === '#loop' ? 3 : 4),
    (id) => (id === '#loop' ? 'not built yet: part two, the retry cap, belongs to another ticket' : 'none'),
  )
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3'])
  console.log('84.3 stdout:\n' + r.stdout + '\nroles: ' + JSON.stringify(buildRoles(p)))
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  const areas = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, area] of areas.entries()) {
    const ps = prompts(p, REVIEWERS[i])
    expect(ps).toHaveLength(1)
    const prompt = ps[0]!
    expect(prompt.toLowerCase()).toContain(area)
    expect(prompt).toContain('+done')
    expect(prompt).toContain('done.txt')
    // The diff only: no card text, no ticket brief, no main-line file such as the Makefile.
    expect(prompt).not.toContain('The two part card')
    expect(prompt).not.toContain('Part two')
    expect(prompt).not.toContain('Make done.txt.')
    expect(prompt).not.toContain('Makefile')
  }
}, 120_000)

// 84.4
// Scenario: A HIGH review finding fails the pass and goes into the next prompt
// Given a ticket whose checks pass and whose grader scores every line 3 or more
// And the security and dependencies reviewer reports one HIGH finding with a file, a line, the impact "the token is written to the log" and a fix
// And the other four reviewers report no finding
// When the person starts the build of the ticket
// Then the first pass fails at the review step
// And a second pass starts
// And the prompt of the second pass holds the HIGH finding with its file, line, impact and fix
// And the second pass runs the checks, the grader and all five reviewers again
test('84.4', () => {
  p = project()
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 17, impact: 'the token is written to the log', fix: 'drop the token from the log line' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  console.log('84.4 stdout:\n' + r.stdout + '\nroles: ' + JSON.stringify(buildRoles(p)))
  expect(r.stdout).toContain('pass 1: red at the review')
  expect(prompts(p)).toHaveLength(2)
  const failure = lastFailure(prompts(p)[1]!)
  console.log('84.4 failure: ' + JSON.stringify(failure))
  expect(failure).toContain('HIGH')
  expect(failure).toContain('src/auth.ts')
  expect(failure).toContain('17')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('drop the token from the log line')
  const roles = buildRoles(p)
  const after = roles.slice(roles.indexOf('builder', 1) + 1)
  expect(after.filter((x) => x === 'grader')).toHaveLength(1)
  expect(after.filter((x) => x.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  expect(lines[1].checks.length).toBeGreaterThan(0)
}, 120_000)

// 84.5
// Scenario: Only MEDIUM and LOW findings let the pass go green and the run record keeps them
// Given a ticket whose checks pass and whose grader scores every line 3 or more
// And the maintainability reviewer reports one MEDIUM finding and the tests reviewer reports one LOW finding
// And no reviewer reports a CRITICAL or HIGH finding
// When the person starts the build of the ticket
// Then the first pass goes green and no second pass starts
// And the ticket leaves building
// And the run record of the ticket holds the MEDIUM finding and the LOW finding with their severity, file, line, impact and fix
test('84.5', () => {
  p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline at the end', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  console.log('84.5 stdout:\n' + r.stdout)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  const lines = runRecord(p)
  expect(lines).toHaveLength(1)
  expect(lines[0].ticket).toBe(3)
  expect(lines[0].review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  const board = boardTicket(p)
  console.log('84.5 board after build: ' + JSON.stringify(board))
  expect(board?.column).not.toBe('building')
}, 120_000)
