import { afterEach, expect, test } from 'bun:test'
import type { TicketFields } from '../src/board/events.ts'
import type { Project } from '../src/test/harness.ts'
import { accepted, linked, proposed } from '../src/test/map-events.ts'
import {
  boardTicket, buildRoles, finishing, grading, lastFailure, makeBuildProject, prompts, quietReviewers, REVIEWERS, reviewing, runRecord,
} from './build-kit.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const ticketWith = (acs: string[], cites: string[]): TicketFields => ({
  number: 3,
  title: 'Write the log line',
  cites,
  blockedBy: [],
  stories: [1],
  touches: ['log'],
  checks: ['make check'],
  brief: `## What to build\n\nWrite done.txt.\n\n## Acceptance criteria\n\n${acs.map((a) => `- ${a}`).join('\n')}`,
  root: 'root',
})

const oneCard = () => [
  proposed('root', { status: 'decided' }),
  proposed('append', { status: 'decided', parent: 'root', title: 'Append only, never write in place', body: 'Part one: append. Part two: rotate files.' }),
  accepted('append'),
]

test('84.1 A grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = makeBuildProject(ticketWith(['done.txt exists.', 'done.txt holds done.'], ['append']), oneCard())
  const ids = ['ac-1', 'ac-2', '#append']
  const gap = 'the diff writes the card in place, the card forbids it (done.txt:1)'
  p.scriptAgent({
    steps: [],
    roles: {
      ...quietReviewers(),
      builder: [finishing],
      grader: [grading(ids, (id) => (id === '#append' ? 2 : 4), (id) => (id === '#append' ? gap : 'none')), grading(ids, () => 4)],
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  // No reviewer runs between the first grader and the second builder.
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder)).toEqual(['builder', 'grader'])
  const second = prompts(p, 'builder')[1]!
  expect(lastFailure(second)).toContain('the diff writes the card in place, the card forbids it')
  expect(lastFailure(second)).toContain('done.txt:1')
}, 30_000)

test('84.2 The grader judges every decided card in the depends_on closure, cited or not', () => {
  p = makeBuildProject(ticketWith(['First criterion.', 'Second criterion.', 'Third criterion.'], ['cited']), [
    proposed('root', { status: 'decided' }),
    proposed('cited', { status: 'decided', parent: 'root', title: 'The cited card' }),
    proposed('uncited', { status: 'decided', title: 'The uncited decided card' }),
    proposed('openone', { status: 'open', title: 'The open card' }),
    accepted('cited'),
    accepted('uncited'),
    accepted('openone'),
    linked('cited', 'uncited', 'depends_on'),
    linked('uncited', 'openone', 'depends_on'),
  ])
  p.scriptAgent({ steps: [], roles: { ...quietReviewers(), builder: [finishing], grader: grading(['ac-1', 'ac-2', 'ac-3', '#cited', '#uncited'], () => 4) } })
  p.werk(['build', '3'])
  const grader = prompts(p, 'grader')[0]!
  const lines = grader.slice(grader.indexOf('## Lines'), grader.indexOf('## Ticket'))
  expect(lines.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lines).toContain('- #cited (contradiction): The cited card')
  expect(lines).toContain('- #uncited (contradiction): The uncited decided card')
  expect(lines.match(/\(contradiction\)/g)).toHaveLength(2)
  expect(grader).not.toContain('openone')
  expect(grader).not.toContain('The open card')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 30_000)

test('84.3 An unbuilt part of a card passes its line and the pass goes on to the review', () => {
  p = makeBuildProject(ticketWith(['done.txt exists.'], ['append']), oneCard())
  const ids = ['ac-1', '#append']
  p.scriptAgent({
    steps: [],
    roles: {
      ...quietReviewers(),
      builder: [finishing],
      grader: grading(ids, (id) => (id === '#append' ? 3 : 4), (id) => (id === '#append' ? 'not built yet: part two, rotate files' : 'none')),
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual([...REVIEWERS].toSorted())
  for (const role of REVIEWERS) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Append only, never write in place')
    expect(prompt).not.toContain('rotate files')
    expect(prompt).not.toContain('Write done.txt.')
    expect(prompt).not.toContain('done.txt exists.')
  }
}, 30_000)

test('84.4 A HIGH review finding fails the pass and goes into the next prompt', () => {
  p = makeBuildProject(ticketWith(['done.txt exists.'], ['append']), oneCard())
  const ids = ['ac-1', '#append']
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token before the write' }
  p.scriptAgent({
    steps: [],
    roles: { ...quietReviewers(), builder: [finishing], grader: grading(ids, () => 4), 'reviewer-security': [reviewing([high]), reviewing()] },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const builders = prompts(p, 'builder')
  expect(builders.length).toBeGreaterThanOrEqual(2)
  const failure = lastFailure(builders[1]!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('redact the token before the write')
  const roles = buildRoles(p)
  const after = roles.slice(roles.indexOf('builder', 1) + 1)
  expect(after.filter((x) => x === 'grader')).toHaveLength(1)
  expect(after.filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual([...REVIEWERS].toSorted())
  expect(runRecord(p)[1].checks).toMatchObject([{ cmd: 'make check' }])
}, 30_000)

test('84.5 Only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = makeBuildProject(ticketWith(['done.txt exists.'], ['append']), oneCard())
  const ids = ['ac-1', '#append']
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no trailing comment', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: {
      ...quietReviewers(),
      builder: [finishing],
      grader: grading(ids, () => 4),
      'reviewer-maintainability': reviewing([medium]),
      'reviewer-tests': reviewing([low]),
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(prompts(p, 'builder')).toHaveLength(1)
  const [line] = runRecord(p)
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  // The ticket leaves building.
  expect(boardTicket(p, 3)?.column).not.toBe('building')
}, 30_000)
