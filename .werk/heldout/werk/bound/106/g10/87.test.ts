/** Held-out steps 87.3 and 87.5: the merge onto the main line and the G2 gate after merges. */
import { test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { author, binder, expect, judges, setup, ticketOf, writes } from './helpers.ts'

const GREEN_CHECK = 'check:\n\t@true\n'

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  const c = setup(GREEN_CHECK, [ticketOf(1)])
  c.p.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [writes('notes.txt', 'ticket one\n'), writes('notes.txt', 'ticket two\n')],
      'heldout-author': author,
      'heldout-binder': [binder({ '1.1': 'true' }), binder({ '1.1': 'true', '2.1': 'true' })],
    },
  })
  const first = c.p.werk(['run', 'root'])
  expect(first.code).toBe(0)
  expect(c.columnOf(1)).toBe('done')
  // The checked-out folder shows the ticket's change with no action from the person.
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('ticket one\n')

  // The person edits the same file and does not commit.
  writeFileSync(join(c.p.dir, 'notes.txt'), 'my own edit\n')
  const tip = c.git('rev-parse', 'main')
  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(2) })
  const second = c.p.werk(['run', 'root'])
  // The second ticket reached merging with green checks.
  expect(c.movesOf(2)).toContain('merging')
  expect(second.stdout).toContain('pass 1: green')
  // The merge stops, and the ticket does not reach done.
  expect(second.code).not.toBe(0)
  expect(c.columnOf(2)).not.toBe('done')
  expect(c.git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 60_000)

test('87.5 G2 opens after the last merge with all held-out steps green, and opens again after a later merge', () => {
  const c = setup(GREEN_CHECK, [ticketOf(1), ticketOf(2)])
  c.p.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [writes('t1.txt'), writes('t2.txt'), writes('t3.txt')],
      'heldout-author': author,
      'heldout-binder': [binder({ '1.1': 'true' }), binder({ '1.1': 'true', '2.1': 'true' }), binder({ '1.1': 'true', '2.1': 'true', '3.1': 'true' })],
    },
  })
  // One build at a time, so one ticket merges first.
  const r = c.p.werk(['run', 'root', '--parallel', '1'])
  expect(r.code).toBe(0)
  const events = c.events()
  const firstDone = events.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const secondDone = events.findIndex((e, i) => i > firstDone && e.type === 'ticket.moved' && e.payload.to === 'done')
  // After the first merge, G2 is not open for the subtree.
  expect(events.slice(firstDone, secondDone).some((e) => e.type === 'gate.opened')).toBe(false)
  // After the second merge, every held-out step is green and G2 opens for the tip.
  const lastRan = events.findLast((e) => e.type === 'heldout.ran')
  expect(lastRan?.type === 'heldout.ran' && lastRan.payload.steps.every((s) => s.result === 'green')).toBe(true)
  const tip1 = c.git('rev-parse', 'main')
  expect(c.gates()).toEqual([tip1])

  // The person approves G2. werk has to offer a way to do it.
  const help = c.p.werk(['help']).stdout
  const approve = /approve/i.test(help)

  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(3) })
  const later = c.p.werk(['run', 'root'])
  expect(later.code).toBe(0)
  const tip2 = c.git('rev-parse', 'main')
  expect(tip2).not.toBe(tip1)
  expect(c.gates()).toEqual([tip1, tip2])

  expect({ approveControlInHelp: approve }).toEqual({ approveControlInHelp: true })
}, 90_000)
