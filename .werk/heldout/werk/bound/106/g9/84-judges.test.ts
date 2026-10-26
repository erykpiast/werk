/** Held-out steps 84.1 to 84.5: the grader and the five reviewers of a pass. */
import { expect, test } from 'bun:test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { accepted, linked, proposed } from '../../src/test/map-events.ts'
import { boardTicket, buildProject, buildRoles, finishing, grading, judgeReply, judges, prompts, REVIEWERS, reviewing, runRecord } from './lib.ts'

const twoAc = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt says done.'
const GAP = 'the diff writes the card in place, the card forbids it'

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  const p = buildProject({ ticket: { brief: twoAc } })
  const ids = ['ac-1', 'ac-2', '#loop']
  const failing = grading(ids, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? `${GAP} (src/store.ts:42)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: [failing, grading(ids)] } })
  const r = p.werk(['build', '3'])
  const roles = buildRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  // Between the first and the second builder: the grader only, no reviewer.
  expect(roles.slice(1, secondBuilder)).toEqual(['grader'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const second = prompts(p)[1]!
  expect(second).toContain(GAP)
  expect(second).toContain('src/store.ts:42')
}, 30_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const brief = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- criterion one.\n- criterion two.\n- criterion three.'
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('cited', { status: 'decided', parent: 'root', title: 'The cited card' }),
    proposed('second', { status: 'decided', title: 'The uncited decided card' }),
    proposed('third', { status: 'open', title: 'The open card' }),
    accepted('cited'),
    accepted('second'),
    accepted('third'),
    linked('cited', 'second', 'depends_on'),
    linked('second', 'third', 'depends_on'),
  ]
  const p = buildProject({ map, ticket: { brief, cites: ['cited'] } })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#cited', '#second']
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  p.werk(['build', '3'])
  const grader = prompts(p, 'grader')[0]!
  const lines = grader.split('\n').filter((l) => /^- \S+ \((delivery|contradiction)\)/.test(l))
  expect(lines.filter((l) => l.includes('(delivery)'))).toHaveLength(3)
  const contradiction = lines.filter((l) => l.includes('(contradiction)'))
  expect(contradiction).toHaveLength(2)
  expect(contradiction.some((l) => l.startsWith('- #cited '))).toBe(true)
  expect(contradiction.some((l) => l.startsWith('- #second '))).toBe(true)
  expect(lines.some((l) => l.includes('#third') || l.includes('The open card'))).toBe(false)
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 30_000)

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const map = [
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', body: 'Part one: write done.txt.\n\nPart two: write later.txt.' }),
    accepted('loop'),
  ]
  const p = buildProject({ map })
  const ids = ['ac-1', '#loop']
  const unbuilt = grading(ids, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'not built yet: part two' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  const titles = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, role] of REVIEWERS.entries()) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain(`You are the ${titles[i]} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Part two: write later.txt')
    expect(prompt).not.toContain('Make done.txt.')
  }
}, 30_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  const p = buildProject()
  const ids = ['ac-1', '#loop']
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 17, impact: 'the token is written to the log', fix: 'redact the token before the log call' }
  p.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]
  expect(second).toBeDefined()
  expect(second).toContain('HIGH')
  expect(second).toContain('src/auth.ts:17')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token before the log call')
  const roles = buildRoles(p)
  const after = roles.slice(roles.indexOf('builder', 1) + 1)
  expect(after[0]).toBe('grader')
  expect(after.filter((x) => x.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  expect(runRecord(p)[1].checks.length).toBeGreaterThan(0)
}, 30_000)

const reply = (object: unknown): FakeReply => judgeReply(object)

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  const p = buildProject({ ticket: { stories: [] } })
  const ids = ['ac-1', '#loop']
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(ids),
      builder: [finishing],
      'reviewer-maintainability': reviewing([medium]),
      'reviewer-tests': reviewing([low]),
      'heldout-author': reply({ steps: [{ text: 'Given a\nWhen b\nThen c' }] }),
      'heldout-binder': reply({ steps: [{ id: '3.1', cmd: 'true' }] }),
    },
  })
  // The person starts the build through the run of the subtree, as the board's start control does.
  const r = p.werk(['run', 'root'])
  expect(r.stdout).toContain('pass 1: green')
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  expect(boardTicket(p)?.column).not.toBe('building')
  const [line] = runRecord(p)
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
}, 60_000)
