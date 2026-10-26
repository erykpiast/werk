/** Held-out steps 87.1, 87.3 and 87.5: the merge loop at the command line. 87.2 and 87.4 are browser specs. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldBoard } from '../../src/board/fold.ts'
import type { Project } from '../../src/test/harness.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { appendBoard, boardEvents, columnOf, git, judges, movesOf, project, reply, ticketOf, writes } from './common.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const MAKEFILE = 'check:\n\t@true\n'
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const binder = (ids: string[]): FakeReply => reply({ steps: ids.map((id) => ({ id, cmd: 'true' })) })
const mainLine = () => git(p, 'log', '--first-parent', '--format=%s', 'main').split('\n')

test('87.1 two green tickets merge onto the main line one after the other', () => {
  p = project(MAKEFILE, [ticketOf(3), ticketOf(4)])
  const branchesBefore = git(p, 'branch', '--format=%(refname:short)').split('\n')
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': [binder(['3.1']), binder(['3.1', '4.1'])] },
  })
  const r = p.werk(['run', 'root', '--parallel', '1'])
  expect(movesOf(p, 3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(p, 4)).toEqual(['building', 'merging', 'done'])
  const line = mainLine()
  const i3 = line.findIndex((s) => s.startsWith('werk: merge ticket 3 '))
  const i4 = line.findIndex((s) => s.startsWith('werk: merge ticket 4 '))
  expect(i3).toBeGreaterThanOrEqual(0)
  expect(i4).toBeGreaterThanOrEqual(0)
  // Newest first: the first ticket's merge is older.
  expect(i4).toBeLessThan(i3)
  const branches = git(p, 'branch', '--format=%(refname:short)').split('\n')
  const ticketBranches = branches.filter((b) => b.startsWith('werk-build/'))
  expect(ticketBranches).toHaveLength(2)
  expect(branches.filter((b) => !b.startsWith('werk-build/')).toSorted()).toEqual(branchesBefore.toSorted())
  const tickets = foldBoard(boardEvents(p)).columns.flatMap((c) => c.tickets)
  for (const t of tickets) expect(t.followUps).toEqual([])
  expect(r.code).toBe(0)
}, 90_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  p = project(MAKEFILE, [ticketOf(3)], { 'notes.txt': 'notes\n' })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'from ticket 3\n')], 'heldout-author': author, 'heldout-binder': [binder(['3.1'])] } })
  p.werk(['run', 'root'])
  expect(columnOf(p, 3)).toBe('done')
  // The checked-out folder shows the ticket's change with no action from the person.
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('from ticket 3\n')

  // The person edits that file and does not commit.
  writeFileSync(join(p.dir, 'notes.txt'), 'my own edit\n')
  const tip = git(p, 'rev-parse', 'main')
  appendBoard(p, { type: 'ticket.planned', payload: ticketOf(4) })
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('notes.txt', 'from ticket 4\n')], 'heldout-author': author, 'heldout-binder': [binder(['3.1', '4.1'])] },
  })
  const r = p.werk(['run', 'root'])
  expect(movesOf(p, 4)).toContain('merging')
  expect(columnOf(p, 4)).not.toBe('done')
  expect(git(p, 'rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
  expect(r.code).not.toBe(0)
}, 90_000)

test('87.5 G2 opens after the last merge with all held-out steps green, and opens again after a later merge', () => {
  p = project(MAKEFILE, [ticketOf(3), ticketOf(4)])
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': [binder(['3.1']), binder(['3.1', '4.1'])] },
  })
  p.werk(['run', 'root', '--parallel', '1'])
  const events = boardEvents(p)
  const ran = events.flatMap((e, i) => (e.type === 'heldout.ran' ? [i] : []))
  expect(ran).toHaveLength(2)
  // Between the first merge's held-out run and the second build, G2 did not open.
  expect(events.slice(0, ran[1]!).some((e) => e.type === 'gate.opened')).toBe(false)
  const tip1 = git(p, 'rev-parse', 'main')
  expect(events.filter((e) => e.type === 'gate.opened').map((e) => (e.payload as { commit: string }).commit)).toEqual([tip1])
  for (const s of (events[ran[1]!]!.payload as { steps: { result: string }[] }).steps) expect(s.result).toBe('green')

  // The person approves G2: the step needs an approve action. It is checked last, below.
  const help = p.werk(['help']).stdout

  appendBoard(p, { type: 'ticket.planned', payload: ticketOf(5) })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t5.txt')], 'heldout-author': author, 'heldout-binder': [binder(['3.1', '4.1', '5.1'])] } })
  expect(p.werk(['run', 'root']).code).toBe(0)
  const tip2 = git(p, 'rev-parse', 'main')
  expect(boardEvents(p).filter((e) => e.type === 'gate.opened').map((e) => (e.payload as { commit: string }).commit)).toEqual([tip1, tip2])
  expect(help).toMatch(/approve/i)
}, 90_000)
