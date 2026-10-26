/** Feature 84: the grader and the five reviewers. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { accepted, linked, proposed } from '../../src/test/map-events.ts'
import { boardTicket, buildProject, finishing, grading, judges, lastFailure, prompts, REVIEWERS, reviewing, runRecord, TICKET } from './build-helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', 'ac-2', '#store']
const GAP = 'the diff writes the card in place, the card forbids it'

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = buildProject()
  const failing = grading(LINES, (id) => (id === '#store' ? 2 : 4), (id) => (id === '#store' ? `${GAP} (done.txt:1)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing], grader: [failing, grading(LINES, () => 4)] } })
  const r = p.werk(['build', String(TICKET)])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = p.agentRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((role) => role?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(lastFailure(second)).toContain(GAP)
  expect(lastFailure(second)).toContain('done.txt:1')
})

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  p = buildProject({
    map: [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', parent: 'root', title: 'The cited card' }),
      proposed('second', { status: 'decided', title: 'The second decided card' }),
      proposed('third', { status: 'open', title: 'The third open card' }),
      accepted('cited'),
      accepted('second'),
      accepted('third'),
      linked('cited', 'second', 'depends_on'),
      linked('second', 'third', 'depends_on'),
    ],
    ticket: {
      cites: ['cited'],
      brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- one is met.\n- two is met.\n- three is met.',
    },
  })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#cited', '#second']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  p.werk(['build', String(TICKET)])
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const lines = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  expect(lines.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lines).toContain('#cited (contradiction)')
  expect(lines).toContain('#second (contradiction)')
  expect(lines).not.toContain('#third')
  expect(lines.match(/\(contradiction\)/g)).toHaveLength(2)
  expect(grader!).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  p = buildProject()
  const unbuilt = grading(LINES, (id) => (id === '#store' ? 3 : 4), (id) => (id === '#store' ? 'not built yet: the second part of the card' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', String(TICKET)])
  expect(r.stdout).not.toContain('red at the grader')
  const roles = p.agentRoles().filter((x) => x?.startsWith('reviewer-'))
  expect(roles.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const reviewer of REVIEWERS) {
    const [prompt] = prompts(p, reviewer)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Store cards in an append-only log')
    expect(prompt).not.toContain('Never write a card in place')
    expect(prompt).not.toContain('Make done.txt.')
  }
})

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  p = buildProject()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'drop the token from the log line' }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', String(TICKET)])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]
  expect(second).toBeDefined()
  const failure = lastFailure(second!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('drop the token from the log line')
  const record = runRecord(p)
  expect(record).toHaveLength(2)
  expect(record[1].checks.length).toBeGreaterThan(0)
  expect(record[1].grade).toBeDefined()
  expect(prompts(p, 'grader')).toHaveLength(2)
  for (const reviewer of REVIEWERS) expect(prompts(p, reviewer)).toHaveLength(2)
})

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = buildProject()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(LINES), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', String(TICKET)])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(prompts(p)).toHaveLength(1)
  const [line] = runRecord(p)
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  const column = boardTicket(p)?.column
  console.log('84.5 column after green:', column)
  expect(column).not.toBe('building')
})
