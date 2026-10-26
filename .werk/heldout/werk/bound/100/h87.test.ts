/** Held-out steps 87.1, 87.3, 87.5 (87.2 and 87.4 are the browser spec h87.spec.ts): the merge loop. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldBoard } from '../src/board/fold.ts'
import { binder, greenBinder, setup, ticketOf, writes, type Ctx } from './hrun-common.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c = undefined
})

// 87.1 Scenario: Two green tickets merge onto the main line one after the other
// Given a project whose main line has a plan with two ready tickets for one subtree
// And both tickets pass their checks alone and together
// When the person starts the run
// Then the board shows each ticket move through building, merging, and done
// And the main line history shows the first ticket's merge before the second ticket's merge
// And the repository has no new branch besides the main line and the ticket branches
// And no ticket card on the board shows a held-out badge
test('87.1 two green tickets merge onto the main line one after the other', () => {
  c = setup([3, 4])
  c.script([writes('t3.txt'), writes('t4.txt')], greenBinder([3, 4]))
  const branchesBefore = c.git('branch', '--format=%(refname:short)').split('\n')
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(c.movesOf(3)).toEqual(['building', 'merging', 'done'])
  expect(c.movesOf(4)).toEqual(['building', 'merging', 'done'])
  const firstDone = (c.events().find((e) => e.type === 'ticket.moved' && e.payload.to === 'done')!.payload as { number: number }).number
  const second = firstDone === 3 ? 4 : 3
  const merges = c.mainLine().filter((s) => s.startsWith('werk: merge')).map((s) => s.split(' (')[0])
  // Newest first: the second merge on top of the first.
  expect(merges).toEqual([`werk: merge ticket ${second}`, `werk: merge ticket ${firstDone}`])
  const branches = c.git('branch', '--format=%(refname:short)').split('\n')
  const added = branches.filter((b) => !branchesBefore.includes(b))
  expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  expect(added).toHaveLength(2)
  const tickets = foldBoard(c.events()).columns.flatMap((col) => col.tickets)
  expect(tickets.every((t) => t.followUps.length === 0)).toBe(true)
}, 90_000)

// 87.3 Scenario: A merge moves a clean checkout of the main line and stops at a checkout with a blocking local change
test('87.3 a merge moves a clean checkout and stops at a blocking local change', () => {
  c = setup([3])
  c.script([writes('notes.txt', 'ticket three\n'), writes('notes.txt', 'ticket four\n')], greenBinder([3, 4]))
  expect(c.p.run(['git', 'status', '--porcelain']).stdout.replace(/.*\.werk.*\n?/g, '')).toBe('')
  const r1 = c.p.werk(['run', 'root'])
  expect(r1.code).toBe(0)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('ticket three\n')

  // The person edits the same file without a commit; a second ticket that changes it reaches merging.
  writeFileSync(join(c.p.dir, 'notes.txt'), 'my own edit\n')
  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  const tip = c.git('rev-parse', 'main')
  const r2 = c.p.werk(['run', 'root'])
  expect(c.movesOf(4)).toContain('merging')
  expect(c.movesOf(4)).not.toContain('done')
  expect(r2.code).not.toBe(0)
  expect(c.git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 90_000)

// 87.5 Scenario: G2 opens after the last merge with all held-out steps green and opens again after a later merge
test('87.5 G2 opens after the last merge and again after a later merge', () => {
  c = setup([3, 4])
  // The held-out set passes once both are merged: step 3.1 needs t4.txt on the main line.
  c.script(
    [writes('t3.txt'), writes('t4.txt')],
    [binder({ '3.1': 'true' }), binder({ '3.1': 'true', '4.1': 'true' })],
  )
  const r = c.p.werk(['run', 'root', '--parallel', '1'])
  expect(r.code).toBe(0)
  const all = c.events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const secondDone = all.findIndex((e, i) => i > firstDone && e.type === 'ticket.moved' && e.payload.to === 'done')
  // After the first merge and its held-out run, G2 is not open.
  expect(all.slice(0, secondDone).some((e) => e.type === 'gate.opened')).toBe(false)
  const tip1 = c.git('rev-parse', 'main')
  expect(c.gates()).toEqual([tip1])

  // The person approves G2. werk has no verb or route for an approval; the test looks for one.
  const help = c.p.werk(['help']).stdout
  const approve = /^\s+approve\b/m.test(help) ? c.p.werk(['approve', 'root']) : undefined

  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(5) })
  c.script([writes('t5.txt')], greenBinder([3, 4, 5]))
  const r2 = c.p.werk(['run', 'root'])
  expect(r2.code).toBe(0)
  const tip2 = c.git('rev-parse', 'main')
  expect(tip2).not.toBe(tip1)
  expect(c.gates()).toEqual([tip1, tip2])
  expect(approve, 'no way for the person to approve G2').toBeDefined()
  expect(approve!.code).toBe(0)
}, 120_000)
