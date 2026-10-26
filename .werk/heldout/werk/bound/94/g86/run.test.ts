import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { appendBoard, binder, columnOf, events, git, judges, movesOf, reply, setup, ticketOf, tickets, writes } from './common.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees RUN-STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const GREEN = 'check:\n\t@true\n'
const script = (builder: FakeReply[], binders: FakeReply[]) =>
  p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': binders } })
const merges = () => git(p, 'log', '--first-parent', '--format=%s', 'main').split('\n').filter((s) => s.startsWith('werk: merge'))

test('87.1 two green tickets merge onto the main line one after the other', () => {
  p = setup(GREEN, { 'notes.txt': 'notes\n' }, [ticketOf(3), ticketOf(4)])
  const branchesBefore = git(p, 'branch', '--format=%(refname:short)').split('\n')
  script([writes('t3.txt'), writes('t4.txt')], [binder({ '3.1': 'true' }), binder({ '3.1': 'true', '4.1': 'true' })])
  const r = p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(movesOf(p, 3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(p, 4)).toEqual(['building', 'merging', 'done'])
  // The ticket that reached done first merged first onto the main line (newest first in git log).
  const doneOrder = events(p).flatMap((e) => (e.type === 'ticket.moved' && e.payload.to === 'done' ? [e.payload.number] : []))
  const mergeOrder = merges().map((s) => Number(/ticket (\d+)/.exec(s)![1])).reverse()
  expect(mergeOrder).toEqual(doneOrder)
  expect(mergeOrder).toHaveLength(2)
  const branches = git(p, 'branch', '--format=%(refname:short)').split('\n')
  expect(branches.filter((b) => !branchesBefore.includes(b) && !b.startsWith('werk-build/'))).toEqual([])
  expect(branches.filter((b) => b.startsWith('werk-build/'))).toHaveLength(2)
  for (const t of tickets(p)) expect(t.followUps).toEqual([])
}, 60_000)

// Red only when a.txt and b.txt are both there on a detached tree: the merge queue's tree.
const PAIR_RED = 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "PAIR-RED-MARK"; exit 1; fi\n'

test('87.2 a ticket red on the merged tree goes back to building and the main line stays', () => {
  p = setup(PAIR_RED, {}, [ticketOf(3)])
  script([writes('a.txt')], [binder({ '3.1': 'true' })])
  expect(p.werk(['run', 'root']).code).toBe(0)
  appendBoard(p, { type: 'ticket.planned', payload: ticketOf(4) })
  const tip = git(p, 'rev-parse', 'main')
  script([writes('b.txt')], [binder({ '3.1': 'true', '4.1': 'true' })])
  const r = p.werk(['run', 'root', '--cap', '1'])
  console.log(r.stdout, r.stderr)
  expect(movesOf(p, 4)).toEqual(['building', 'merging', 'building'])
  expect(columnOf(p, 4)).toBe('building')
  expect(git(p, 'rev-parse', 'main')).toBe(tip)
  // The drawer reads the board fold: does the ticket carry the failed check and its output?
  const t4 = tickets(p).find((t) => t.number === 4)!
  expect(JSON.stringify(t4)).toContain('PAIR-RED-MARK')
}, 60_000)

test('87.3 a merge moves a clean checkout and stops at a blocking local change', () => {
  p = setup(GREEN, { 'notes.txt': 'notes\n' }, [ticketOf(3)])
  script([writes('notes.txt', 'ticket three\n')], [binder({ '3.1': 'true' })])
  expect(p.werk(['run', 'root']).code).toBe(0)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('ticket three\n')

  writeFileSync(join(p.dir, 'notes.txt'), 'my local edit\n')
  appendBoard(p, { type: 'ticket.planned', payload: ticketOf(4) })
  const tip = git(p, 'rev-parse', 'main')
  script([writes('notes.txt', 'ticket four\n')], [binder({ '3.1': 'true', '4.1': 'true' })])
  const r = p.werk(['run', 'root'])
  expect(r.code).not.toBe(0)
  expect(movesOf(p, 4)).toContain('merging')
  expect(columnOf(p, 4)).not.toBe('done')
  expect(git(p, 'rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('my local edit\n')
}, 60_000)

test('87.4 a red held-out step after a merge files a follow-up and a badge (board fold part)', () => {
  p = setup(GREEN, {}, [ticketOf(3)])
  script([writes('t3.txt'), writes('fix.txt')], [binder({ '3.1': 'false' }), binder({ '3.1': 'true', '4.1': 'true' })])
  p.werk(['run', 'root'])
  const all = events(p)
  const filed = all.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThan(-1)
  const then = tickets(p, all.slice(0, filed + 1))
  expect(then.find((t) => t.number === 3)).toMatchObject({ column: 'done', followUps: [4] })
  const follow = then.find((t) => t.number === 4)!
  expect(follow.column).toBe('ready')
  expect(follow.brief).toContain(STEP)
  expect(merges().some((s) => s.startsWith('werk: merge ticket 3'))).toBe(true)
}, 60_000)

test('87.5a G2 is closed after the first merge and opens after the last merge', () => {
  p = setup(GREEN, {}, [ticketOf(3), ticketOf(4)])
  script([writes('t3.txt'), writes('t4.txt')], [binder({ '3.1': 'true' }), binder({ '3.1': 'true', '4.1': 'true' })])
  expect(p.werk(['run', 'root', '--parallel', '1']).code).toBe(0)
  const gates = events(p).flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
  expect(gates).toEqual([git(p, 'rev-parse', 'main')])
  expect(gates).not.toContain(git(p, 'rev-parse', 'main~1'))
}, 60_000)

test('87.5b the person can approve G2', () => {
  p = setup(GREEN, {}, [])
  const help = p.werk(['help']).stdout
  expect(help).toMatch(/approve/)
})

test('87.5c a later merge with every step green opens G2 again for the new tip', () => {
  p = setup(GREEN, {}, [ticketOf(3), ticketOf(4)])
  script([writes('t3.txt'), writes('t4.txt')], [binder({ '3.1': 'true' }), binder({ '3.1': 'true', '4.1': 'true' })])
  expect(p.werk(['run', 'root', '--parallel', '1']).code).toBe(0)
  const first = git(p, 'rev-parse', 'main')
  appendBoard(p, { type: 'ticket.planned', payload: ticketOf(5) })
  script([writes('t5.txt')], [binder({ '3.1': 'true', '4.1': 'true', '5.1': 'true' })])
  expect(p.werk(['run', 'root']).code).toBe(0)
  const gates = events(p).flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
  expect(gates).toEqual([first, git(p, 'rev-parse', 'main')])
}, 90_000)
