import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { accepted, AREAS, boardTicket, finishing, grading, judges, linked, project, prompts, proposed, REVIEWERS, reviewing, runRecord } from './helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const twoAc = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.'
const passing = { ticket: { checks: ['true'] } }

test('84.1 A grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = project({ ticket: { ...passing.ticket, brief: twoAc } })
  const lines = ['ac-1', 'ac-2', '#loop']
  const gap = 'the diff writes the card in place, the card forbids it — src/store.ts:42'
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(lines),
      grader: [grading(lines, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? gap : 'none')), grading(lines)],
      builder: [finishing],
    },
  })
  const r = p.werk(['build', '3'])
  console.log(r.stdout)
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = p.agentRoles()
  const secondBuilder = roles.indexOf('builder', roles.indexOf('builder') + 1)
  expect(secondBuilder).toBeGreaterThan(-1)
  expect(roles.slice(0, secondBuilder).some((r) => r?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(second).toContain('the diff writes the card in place, the card forbids it')
  expect(second).toContain('src/store.ts:42')
})

test('84.2 The grader judges every decided card in the depends_on closure, cited or not', () => {
  const threeAc = '## What to build\n\nX.\n\n## Acceptance criteria\n\n- first criterion\n- second criterion\n- third criterion'
  p = project({
    ticket: { checks: ['true'], brief: threeAc, cites: ['cited'] },
    map: [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', title: 'The cited card' }),
      proposed('uncited', { status: 'decided', title: 'The uncited decided card' }),
      proposed('opencard', { status: 'open', title: 'The open card' }),
      accepted('cited'),
      accepted('uncited'),
      accepted('opencard'),
      linked('cited', 'uncited', 'depends_on'),
      linked('uncited', 'opencard', 'depends_on'),
    ],
  })
  const lines = ['ac-1', 'ac-2', 'ac-3', '#cited', '#uncited']
  p.scriptAgent({ steps: [], roles: { ...judges(lines), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  console.log(r.stdout, r.stderr)
  const grader = prompts(p, 'grader')[0]!
  const lineSection = grader.slice(grader.indexOf('## Lines'), grader.indexOf('## Ticket'))
  expect(lineSection.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lineSection.match(/\(contradiction\)/g)).toHaveLength(2)
  expect(lineSection).toContain('#cited (contradiction)')
  expect(lineSection).toContain('#uncited (contradiction)')
  expect(grader).not.toContain('#opencard')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 An unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const twoParts = { status: 'decided', body: 'Part one: write done.txt. Part two: write the CARDBODYMARK index.' }
  p = project({
    ticket: { checks: ['true'] },
    map: [proposed('root', { status: 'decided' }), proposed('loop', { ...twoParts, parent: 'root' }), accepted('loop')],
  })
  const lines = ['ac-1', '#loop']
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(lines),
      grader: grading(lines, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'part two is not built yet' : 'none')),
      builder: [finishing],
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const roles = p.agentRoles()
  expect(roles.filter((r) => r?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  for (const reviewer of REVIEWERS) {
    const prompt = prompts(p, reviewer)[0]!
    expect(prompt).toContain('done.txt')
    expect(prompt).toContain('```diff')
    expect(prompt).not.toContain('CARDBODYMARK')
    expect(prompt).not.toContain('Make done.txt.')
  }
})

test('84.4 A HIGH review finding fails the pass and goes into the next prompt', () => {
  p = project(passing)
  const lines = ['ac-1', '#loop']
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 17, impact: 'the token is written to the log', fix: 'drop the token from the log line' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(lines), 'reviewer-security': [reviewing([high]), reviewing()], builder: [finishing] },
  })
  const r = p.werk(['build', '3'])
  console.log(r.stdout)
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]
  expect(second).toBeDefined()
  expect(second).toContain('src/auth.ts')
  expect(second).toContain('17')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('drop the token from the log line')
  const roles = p.agentRoles()
  expect(roles.filter((r) => r === 'grader')).toHaveLength(2)
  for (const rv of REVIEWERS) expect(roles.filter((r) => r === rv)).toHaveLength(2)
  const rec = runRecord(p)
  expect(rec[1].checks.length).toBeGreaterThan(0)
  expect(rec[1].grade).toBeDefined()
  expect(rec[1].review).toBeDefined()
})

test('84.5 Only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = project(passing)
  const lines = ['ac-1', '#loop']
  const medium = { severity: 'MEDIUM', file: 'src/a.ts', line: 3, impact: 'duplicated code', fix: 'extract a function' }
  const low = { severity: 'LOW', file: 'src/a.test.ts', line: 9, impact: 'a weak assertion', fix: 'assert the value' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(lines), 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]), builder: [finishing] },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  const findings = runRecord(p)[0].review.findings
  expect(findings).toContainEqual({ area: 'maintainability', ...medium })
  expect(findings).toContainEqual({ area: 'tests', ...low })
  expect(AREAS).toContain('tests')
  expect(boardTicket(p)!.column).not.toBe('building')
})
