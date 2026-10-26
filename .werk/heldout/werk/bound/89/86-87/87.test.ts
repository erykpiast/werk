/**
 * Held-out tests for scenario group 87 that need no browser: 87.3 and 87.5.
 * Reading: "the person starts the run" is `werk run root`; "the board shows" is the board fold of
 * .werk/board.jsonl (src/board/fold.ts); "G2 opens/is open" is a gate.opened event for the commit.
 */
import { afterEach, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { binderOf, judges, project, readText, ticketOf, writes, type Ctx } from './util.ts'
import { reply } from './util.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })

/*
 * 87.3
 * Scenario: A merge moves a clean checkout of the main line and stops at a checkout with a blocking local change
 * Given a project whose main line is checked out in a folder with no local changes
 * And a ready ticket that changes a file in that folder
 * When the person starts the run and the ticket merges
 * Then the checked-out folder shows the ticket's change without any action from the person
 * When the person edits that same file in the checked-out folder without committing
 * And a second ticket that changes the same file reaches merging with green checks
 * Then the merge stops and the board shows the second ticket did not reach done
 * And the main line tip is the same commit as before
 * And the person's uncommitted edit is still in the file
 */
test('87.3 a merge moves a clean checkout and stops at a blocking local change', () => {
  c = project({ makefile: 'check:\n\t@true\n', files: { 'notes.txt': 'notes\n' }, tickets: [ticketOf(3)] })
  const ctx = c
  const { p } = ctx
  expect(p.run(['git', 'status', '--porcelain', '--untracked-files=no']).stdout.trim()).toBe('')
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('notes.txt', 'ticket three\n'), writes('notes.txt', 'ticket four\n')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': 'true', '4.1': 'true' })] },
  })
  const first = p.werk(['run', 'root'])
  expect(first.code).toBe(0)
  expect(ctx.columnOf(3)).toBe('done')
  // The checked-out folder follows the merge with no action from the person.
  expect(readText(join(p.dir, 'notes.txt'))).toBe('ticket three\n')

  // The person edits the same file and does not commit.
  writeFileSync(join(p.dir, 'notes.txt'), 'my local edit\n')
  ctx.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  const tip = ctx.git('rev-parse', 'main')

  const second = p.werk(['run', 'root'])
  expect(ctx.movesOf(4)).toContain('merging')
  expect(second.code).not.toBe(0)
  expect(second.stderr + second.stdout).toMatch(/merge of ticket 4 stopped/)
  expect(ctx.columnOf(4)).not.toBe('done')
  expect(ctx.git('rev-parse', 'main')).toBe(tip)
  expect(readText(join(p.dir, 'notes.txt'))).toBe('my local edit\n')
}, 180_000)

/*
 * 87.5
 * Scenario: G2 opens after the last merge with all held-out steps green and opens again after a later merge
 * Given a project whose subtree has two ready tickets and a held-out set that passes once both are merged
 * When the person starts the run and the first ticket merges
 * Then G2 is not open for the subtree
 * When the second ticket merges and every held-out step is green
 * Then G2 opens for the current tip of the main line
 * When the person approves G2 and a new ticket of the same subtree later merges with every held-out step green
 * Then G2 opens again for the new tip of the main line
 */
test('87.5 G2 opens after the last merge and again after a later merge', () => {
  c = project({ makefile: 'check:\n\t@true\n', tickets: [ticketOf(3), ticketOf(4)] })
  const ctx = c
  const { p } = ctx
  // The set passes once both are merged: each step checks that both tickets' files are on the tip.
  const both = 'test -f t3.txt && test -f t4.txt'
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [writes('t3.txt'), writes('t4.txt')],
      'heldout-author': author,
      'heldout-binder': [binderOf({ '3.1': 'test -f t3.txt' }), binderOf({ '3.1': both, '4.1': both })],
    },
  })
  const r = p.werk(['run', 'root', '--parallel', '1'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)

  // After the first merge, before the second ticket is done: no G2.
  const events = ctx.events()
  const firstDone = events.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const secondDone = events.findIndex((e, i) => i > firstDone && e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(firstDone).toBeGreaterThanOrEqual(0)
  expect(secondDone).toBeGreaterThan(firstDone)
  expect(events.slice(0, secondDone).some((e) => e.type === 'gate.opened')).toBe(false)

  // After the second merge, with every step green: G2 opens for the current tip.
  const lastRun = events.findLast((e) => e.type === 'heldout.ran') as { payload: { steps: { result: string }[] } }
  expect(lastRun.payload.steps.every((s) => s.result === 'green')).toBe(true)
  const tip1 = ctx.git('rev-parse', 'main')
  expect(ctx.gates()).toEqual([tip1])

  // A new ticket of the same subtree merges later with every step green.
  ctx.appendBoard({ type: 'ticket.planned', payload: ticketOf(5) })
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t5.txt')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': both, '4.1': both, '5.1': 'test -f t5.txt' })] },
  })
  const again = p.werk(['run', 'root'])
  expect(again.stderr).toBe('')
  expect(again.code).toBe(0)
  const tip2 = ctx.git('rev-parse', 'main')
  expect(tip2).not.toBe(tip1)
  expect(ctx.gates()).toEqual([tip1, tip2])

  // "The person approves G2": the product must offer a way to approve an open G2.
  // No verb, flag or board event for an approval was found; this assertion records it.
  const help = p.werk(['help']).stdout + p.werk(['gate', '--help']).stderr
  expect(help).toMatch(/approve/i)
}, 240_000)
