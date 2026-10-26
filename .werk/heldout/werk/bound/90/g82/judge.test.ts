/** Held-out steps 84.1 to 84.5: the grader and the five reviewers in a build. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { accepted, linked, proposed } from '../../src/test/map-events.ts'
import {
  AREAS,
  boardTicket,
  buildProject,
  buildRoles,
  finishing,
  grading,
  judges,
  prompts,
  REVIEWERS,
  reviewing,
  runRecord,
} from './build-helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const TWO_AC = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.'
const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = buildProject({ ticket: { brief: TWO_AC } })
  const ids = ['ac-1', 'ac-2', '#loop']
  const gap = 'src/store.ts:42 — the diff writes the card in place, the card forbids it'
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(ids),
      builder: [finishing],
      grader: [grading(ids, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? gap : 'none')), grading(ids, () => 4)],
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  // No reviewer runs for the first pass.
  expect(roles.slice(0, secondBuilder).some((r) => r?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(lastFailure(second)).toContain('the diff writes the card in place, the card forbids it')
  expect(lastFailure(second)).toContain('src/store.ts:42')
})

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', title: 'Cited card A' }),
    proposed('second', { status: 'decided', title: 'Uncited decided card B' }),
    proposed('third', { status: 'open', title: 'Open card C' }),
    accepted('loop'),
    accepted('second'),
    accepted('third'),
    linked('loop', 'second', 'depends_on'),
    linked('second', 'third', 'depends_on'),
  ]
  const brief = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- First criterion.\n- Second criterion.\n- Third criterion.'
  p = buildProject({ map, ticket: { brief } })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#loop', '#second']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  p.werk(['build', '3'])
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const delivery = grader!.split('\n').filter((l) => /\(delivery\)/.test(l))
  expect(delivery).toHaveLength(3)
  expect(grader).toContain('First criterion.')
  expect(grader).toContain('Second criterion.')
  expect(grader).toContain('Third criterion.')
  const contradiction = grader!.split('\n').filter((l) => /\(contradiction\)/.test(l))
  expect(contradiction).toHaveLength(2)
  expect(contradiction.some((l) => l.includes('#loop'))).toBe(true)
  expect(contradiction.some((l) => l.includes('#second'))).toBe(true)
  expect(grader).not.toContain('#third')
  expect(grader).not.toContain('Open card C')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', title: 'Two parts', body: 'Part one: done.txt. Part two: a retry cap.' }),
    accepted('loop'),
  ]
  p = buildProject({ map })
  const ids = ['ac-1', '#loop']
  const unbuilt = grading(ids, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'not built yet: part two, the retry cap' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((r) => r?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  const titles = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, role] of REVIEWERS.entries()) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain(`${titles[i]} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Part two: a retry cap')
    expect(prompt).not.toContain('Make done.txt.')
  }
})

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  p = buildProject()
  const ids = ['ac-1', '#loop']
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token before logging' }
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]
  expect(second).toBeDefined()
  const failure = lastFailure(second!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('redact the token before logging')
  const roles = buildRoles(p)
  const after = roles.slice(roles.indexOf('builder', 1))
  expect(after).toContain('grader')
  expect(after.filter((r) => r?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  const [, line2] = runRecord(p)
  expect(line2.checks.length).toBeGreaterThan(0)
  expect(line2.grade).toBeDefined()
  expect(line2.review).toBeDefined()
  void AREAS
})

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = buildProject()
  const ids = ['ac-1', '#loop']
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(ids), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  const lines = runRecord(p)
  expect(lines).toHaveLength(1)
  expect(lines[0].review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  // The ticket leaves building.
  expect(boardTicket(p)?.column).not.toBe('building')
})
