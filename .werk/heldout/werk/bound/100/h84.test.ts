/** Held-out steps 84.x: the grader and the five reviewers. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../src/test/harness.ts'
import { accepted, linked, proposed } from '../src/test/map-events.ts'
import {
  boardTicket,
  buildRoles,
  finishing,
  grading,
  judges,
  lastFailure,
  project,
  prompts,
  REVIEWERS,
  reviewing,
  runRecord,
} from './h8-build.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

/** The roles of the build in launch order, with each group of reviewers sorted. */
const launched = () => {
  const roles = buildRoles(p).map((r) => r ?? '')
  const out: string[] = []
  for (let i = 0; i < roles.length; ) {
    if (!roles[i]!.startsWith('reviewer-')) out.push(roles[i++]!)
    else {
      const group: string[] = []
      while (i < roles.length && roles[i]!.startsWith('reviewer-')) group.push(roles[i++]!)
      out.push(...group.toSorted((a, b) => REVIEWERS.indexOf(a) - REVIEWERS.indexOf(b)))
    }
  }
  return out
}

const TWO_AC = '## What to build\n\nWrite done.txt.\n\n## Acceptance criteria\n\n- done.txt is in the tree.\n- done.txt ends with a newline.'

// Scenario: A grader score of 2 fails the pass and the gap reaches the next pass
test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = project({ ticket: { brief: TWO_AC } })
  const gap = 'done.txt:1 the diff writes the card in place, the card forbids it'
  const ids = ['ac-1', 'ac-2', '#core']
  const failing = grading(ids, (id) => (id === '#core' ? 2 : 4), (id) => (id === '#core' ? gap : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: [failing, grading(ids, () => 4)] } })
  const r = p.werk(['build', '7'])
  // Then the first pass fails at the grader step
  expect(r.stdout).toContain('pass 1: red at the grader')
  // And no reviewer runs for the first pass; And a second pass starts
  const roles = launched()
  expect(roles.slice(0, 3)).toEqual(['builder', 'grader', 'builder'])
  // And the prompt of the second pass holds the gap with its file and line
  const second = prompts(p)[1]!
  expect(lastFailure(second)).toContain('the diff writes the card in place, the card forbids it')
  expect(lastFailure(second)).toContain('done.txt:1')
})

// Scenario: The grader judges every decided card in the depends_on closure, cited or not
test('84.2 the grader judges every decided card in the depends_on closure', () => {
  p = project({
    ticket: {
      cites: ['cited'],
      brief: '## What to build\n\nWrite done.txt.\n\n## Acceptance criteria\n\n- first criterion here.\n- second criterion here.\n- third criterion here.',
    },
    map: [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', parent: 'root', title: 'The cited card' }),
      proposed('uncited', { status: 'decided', title: 'The uncited decided card' }),
      proposed('open', { status: 'open', title: 'The open card' }),
      accepted('cited'),
      accepted('uncited'),
      accepted('open'),
      linked('cited', 'uncited', 'depends_on'),
      linked('uncited', 'open', 'depends_on'),
    ],
  })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#cited', '#uncited', '#open']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  const r = p.werk(['build', '7'])
  expect(r.stdout).not.toContain('red at make check')
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const lineSection = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  const delivery = lineSection.split('\n').filter((l) => l.includes('(delivery)'))
  const contradiction = lineSection.split('\n').filter((l) => l.includes('(contradiction)'))
  expect(delivery).toHaveLength(3)
  expect(contradiction).toHaveLength(2)
  expect(contradiction.some((l) => l.includes('The cited card'))).toBe(true)
  expect(contradiction.some((l) => l.includes('The uncited decided card'))).toBe(true)
  expect(lineSection).not.toContain('The open card')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

// Scenario: An unbuilt part of a card passes its line and the pass goes on to the review
test('84.3 an unbuilt card part passes its line and the review runs', () => {
  p = project({
    map: [
      proposed('root', { status: 'decided' }),
      proposed('core', { status: 'decided', parent: 'root', title: 'The two-part card', body: 'Part one: write done.txt. Part two: CARD-PART-TWO sign it.' }),
      accepted('core'),
    ],
  })
  const ids = ['ac-1', '#core']
  const grade = grading(ids, (id) => (id === '#core' ? 3 : 4), (id) => (id === '#core' ? 'not built yet: part two belongs to another ticket' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: grade } })
  const r = p.werk(['build', '7'])
  expect(r.stdout).not.toContain('red at the grader')
  expect(launched()).toEqual(['builder', 'grader', ...REVIEWERS])
  const areas = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, role] of REVIEWERS.entries()) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain(`${areas[i]} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('CARD-PART-TWO')
    expect(prompt).not.toContain('The two-part card')
    expect(prompt).not.toContain('Write done.txt.')
  }
})

// Scenario: A HIGH review finding fails the pass and goes into the next prompt
test('84.4 a HIGH finding fails the pass and reaches the next prompt', () => {
  p = project()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'drop the token from the log line' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '7'])
  expect(r.stdout).toContain('pass 1: red at the review')
  expect(prompts(p)).toHaveLength(2)
  const failure = lastFailure(prompts(p)[1]!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('drop the token from the log line')
  expect(launched()).toEqual(['builder', 'grader', ...REVIEWERS, 'builder', 'grader', ...REVIEWERS])
  const second = runRecord(p)[1]
  expect(second.checks.length).toBeGreaterThan(0)
  expect(second.grade).toBeDefined()
  expect(second.review).toBeDefined()
})

// Scenario: Only MEDIUM and LOW findings let the pass go green and the run record keeps them
test('84.5 MEDIUM and LOW findings let the pass go green and stay in the run record', () => {
  p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no trailing comment', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(prompts(p)).toHaveLength(1)
  const [line] = runRecord(p)
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  // And the ticket leaves building
  expect(boardTicket(p)?.column).not.toBe('building')
})
