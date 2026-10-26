import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readLog } from '../../src/map/log.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { BoardEvent } from '../../src/board/events.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, finishing, grading, isHeldout, linked, project, prompts, proposed, REVIEWERS, reviewing, runRecord } from './setup.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const buildRoles = () => p.agentRoles().filter((r) => !isHeldout(r))
const LINES = ['ac-1', 'ac-2', '#loop']
const judges = () => ({ grader: grading(LINES, () => 4), ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])) })

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  p = project()
  const gap = 'the diff writes the card in place, the card forbids it'
  const failing = grading(LINES, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? `${gap} (src/log.ts:12)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: [failing, grading(LINES, () => 4)] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  // No reviewer between the first grader and the second builder.
  expect(roles.slice(0, secondBuilder).some((x) => x?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(second).toContain(gap)
  expect(second).toContain('src/log.ts:12')
})

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  p = project(
    { brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- crit one.\n- crit two.\n- crit three.' },
    [
      proposed('root', { status: 'decided' }),
      proposed('loop', { status: 'decided', parent: 'root', title: 'Cited decided card' }),
      proposed('second', { status: 'decided', parent: 'root', title: 'Uncited decided card' }),
      proposed('third', { status: 'open', parent: 'root', title: 'Open third card' }),
      accepted('loop'),
      accepted('second'),
      accepted('third'),
      linked('loop', 'second', 'depends_on'),
      linked('second', 'third', 'depends_on'),
    ],
  )
  const ids = ['ac-1', 'ac-2', 'ac-3', '#loop', '#second']
  p.scriptAgent({ steps: [], roles: { ...judges(), grader: grading(ids, () => 4), builder: [finishing] } })
  p.werk(['build', '3'])
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  expect((grader!.match(/\(delivery\)/g) ?? []).length).toBe(3)
  expect(grader).toContain('- #loop (contradiction): Cited decided card')
  expect(grader).toContain('- #second (contradiction): Uncited decided card')
  expect(grader).not.toContain('#third (contradiction)')
  expect((grader!.match(/\(contradiction\):/g) ?? []).length).toBe(2)
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  p = project()
  const unbuilt = grading(LINES, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'second part not built yet' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  expect(buildRoles().filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  for (const role of REVIEWERS) {
    const [prompt] = prompts(p, role)
    expect(prompt).toContain('+done')
    // The diff only: no ticket brief and no card text.
    expect(prompt).not.toContain('Make done.txt.')
    expect(prompt).not.toContain('Never write a card in place')
  }
  const areas = REVIEWERS.map((r) => prompts(p, r)[0]!)
  expect(areas[0]).toContain('design reviewer')
  expect(areas[1]).toContain('maintainability reviewer')
  expect(areas[2]).toContain('tests reviewer')
  expect(areas[3]).toContain('security and dependencies reviewer')
  expect(areas[4]).toContain('performance reviewer')
})

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  p = project()
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 42, impact: 'the token is written to the log', fix: 'redact the token' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]!
  expect(second).toContain('HIGH')
  expect(second).toContain('src/auth.ts:42')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token')
  const lines = runRecord(p)
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect(lines[1].checks.length).toBeGreaterThan(0)
  expect(prompts(p, 'grader')).toHaveLength(2)
  for (const role of REVIEWERS) expect(prompts(p, role)).toHaveLength(2)
})

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(prompts(p)).toHaveLength(1)
  const board = foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
  const column = board.columns.find((c) => c.tickets.some((t) => t.number === 3))?.name
  expect(column).not.toBe('building')
  const [line] = runRecord(p)
  expect(line.review.findings).toEqual([
    { area: 'maintainability', ...medium },
    { area: 'tests', ...low },
  ])
})
