/** Held-out steps 87.3 and 87.5: the merge loop on the command line. */
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { binder, judges, project, reply, ticketOf, writes } from './common.ts'

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const green = (n: number[]) => binder(Object.fromEntries(n.map((t) => [`${t}.1`, 'true'])))

test('87.3 a merge moves a clean checkout of the main line and stops at a checkout with a blocking local change', () => {
  const ctx = project([1], { makefile: 'check:\n\t@true\n' })
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket one\n')], 'heldout-author': author, 'heldout-binder': green([1]) } })
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  expect(readFileSync(join(ctx.p.dir, 'notes.txt'), 'utf8')).toBe('ticket one\n')

  writeFileSync(join(ctx.p.dir, 'notes.txt'), 'my uncommitted edit\n')
  const tip = ctx.git('rev-parse', 'main')
  ctx.appendBoard({ type: 'ticket.planned', payload: ticketOf(2) })
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket two\n')], 'heldout-author': author, 'heldout-binder': green([1, 2]) } })
  const r = ctx.p.werk(['run', 'root'])
  expect(r.code).not.toBe(0)
  expect(ctx.movesOf(2)).toContain('merging')
  expect(ctx.columnOf(2)).not.toBe('done')
  expect(ctx.git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(ctx.p.dir, 'notes.txt'), 'utf8')).toBe('my uncommitted edit\n')
}, 90_000)

test('87.5 G2 opens after the last merge with all held-out steps green and opens again after a later merge', () => {
  const ctx = project([1, 2], { makefile: 'check:\n\t@true\n' })
  ctx.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author, 'heldout-binder': [green([1]), green([1, 2])] },
  })
  const r = ctx.p.werk(['run', 'root', '--parallel', '1'])
  expect(r.code).toBe(0)
  const all = ctx.events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const secondDone = all.findLastIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(firstDone).toBeLessThan(secondDone)
  // G2 is not open after the first merge.
  const firstGate = all.findIndex((e) => e.type === 'gate.opened')
  expect(firstGate).toBeGreaterThan(secondDone)
  expect(ctx.gates()).toEqual([ctx.git('rev-parse', 'main')])

  // The person approves G2: werk has to offer a way to do it.
  const help = ctx.p.werk(['help']).stdout
  const approve = /approve/i.test(help)

  const first = ctx.git('rev-parse', 'main')
  ctx.appendBoard({ type: 'ticket.planned', payload: ticketOf(3) })
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author, 'heldout-binder': green([1, 2, 3]) } })
  expect(ctx.p.werk(['run', 'root']).code).toBe(0)
  expect(ctx.gates()).toEqual([first, ctx.git('rev-parse', 'main')])
  expect(first).not.toBe(ctx.git('rev-parse', 'main'))
  expect(approve, 'no verb or control to approve G2 in werk help').toBe(true)
}, 120_000)
