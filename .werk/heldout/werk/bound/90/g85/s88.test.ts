/** Held-out step 88.5: the merge queue merges one ticket at a time while three build. */
import { afterEach, expect, test } from 'bun:test'
import { foldBoard } from '../../src/board/fold.ts'
import type { Project } from '../../src/test/harness.ts'
import { boardEvents, columnOf, judges, project, reply, ticketOf, writes } from './common.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  p = project('check:\n\t@true\n', [ticketOf(1), ticketOf(2), ticketOf(3)])
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('a.txt'), writes('b.txt'), writes('c.txt')], 'heldout-author': reply({ steps: [] }) },
  })
  p.werk(['run', 'root'])
  const events = boardEvents(p)
  // All three built at the same time: each started before any of them reached merging.
  const firstMerging = events.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'merging')
  const startedBefore = events.slice(0, firstMerging).filter((e) => e.type === 'ticket.moved' && e.payload.to === 'building').length
  expect(startedBefore).toBe(3)
  for (let i = 1; i <= events.length; i++) {
    const merging = foldBoard(events.slice(0, i)).columns.find((c) => c.name === 'merging')!.tickets.length
    expect(merging).toBeLessThanOrEqual(1)
  }
  for (const n of [1, 2, 3]) expect(columnOf(p, n)).toBe('done')
}, 90_000)
