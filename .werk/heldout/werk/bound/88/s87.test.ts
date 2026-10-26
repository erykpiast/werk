/** Held-out group 87: the merge queue onto the main line, follow-ups, and G2 after merges. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STEP, binder, greenBinder, judges, reply, setup, ticketOf, writes, type Ctx } from './s86-lib.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'

let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const script = (builder: FakeReply[], binders: FakeReply[]) =>
  c!.p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': reply({ steps: [{ text: STEP('MARK-87') }] }), 'heldout-binder': binders } })
const movesOf = (n: number) => c!.events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
const doneOrder = () => c!.events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.to === 'done' ? [e.payload.number] : []))
const mainMerges = () =>
  c!
    .git('log', '--first-parent', '--format=%s', 'main')
    .split('\n')
    .filter((s) => s.startsWith('werk: merge ticket'))
    .map((s) => Number(/ticket (\d+)/.exec(s)![1]))
    .reverse()

test('87.1 two green tickets merge onto the main line one after the other', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3, { touches: ['subtree'] }), ticketOf(4, { touches: ['subtree'] })])
  // Both touch the same module of one subtree, so the second builds on top of the first.
  script([writes('t3.txt'), writes('t4.txt')], [greenBinder([3]), greenBinder([3, 4])])
  const branchesBefore = c.git('branch', '--format=%(refname:short)').split('\n')
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  expect(movesOf(3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(4)).toEqual(['building', 'merging', 'done'])
  // The main line shows the first ticket's merge before the second.
  expect(mainMerges()).toEqual(doneOrder())
  expect(mainMerges()).toHaveLength(2)
  const branches = c.git('branch', '--format=%(refname:short)').split('\n')
  const added = branches.filter((b) => !branchesBefore.includes(b))
  expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  expect(added).toHaveLength(2)
  expect(branches.filter((b) => !b.startsWith('werk-build/'))).toEqual(['main'])
  // No card showed a held-out badge at any time.
  for (const state of c.states()) for (const t of state) expect(t.followUps).toEqual([])
}, 60_000)

test('87.2 a ticket red on the merged tree goes back to building and the main line stays', () => {
  // Each ticket alone is green; both together are red.
  const makefile = 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ]; then echo "MARK-BOTH-RED: a.txt and b.txt clash"; exit 1; fi\n'
  c = setup(makefile, { 'notes.txt': 'notes\n' }, [ticketOf(3), ticketOf(4)])
  script([writes('a.txt'), writes('b.txt')], [greenBinder([3, 4])])
  const r = c.p.werk(['run', 'root', '--cap', '1'])
  expect(r.code).toBe(1)
  const [first] = doneOrder()
  expect(first).toBeDefined()
  const second = first === 3 ? 4 : 3
  expect(movesOf(second)).toEqual(['building', 'merging', 'building'])
  expect(c.ticket(second)!.column).toBe('building')

  // The tip of main before the second ticket reached merging: the last held-out run before it.
  const all = c.events()
  const reached = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === second && e.payload.to === 'merging')
  const ranBefore = all.slice(0, reached).findLast((e) => e.type === 'heldout.ran')
  expect(ranBefore).toBeDefined()
  expect(c.git('rev-parse', 'main')).toBe((ranBefore as { payload: { commit: string } }).payload.commit)
  expect(mainMerges()).toEqual([first])

  // The drawer reads the board ticket: it must show the failed check and its output.
  const shown = JSON.stringify(c.ticket(second))
  expect(shown).toContain('make check')
  expect(shown).toContain('MARK-BOTH-RED')
}, 60_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3)])
  script([writes('notes.txt', 'ticket three\n')], [greenBinder([3])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('ticket three\n')

  // The person edits the same file without a commit; a second ticket changes that file.
  writeFileSync(join(c.p.dir, 'notes.txt'), 'my own edit\n')
  const tip = c.git('rev-parse', 'main')
  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  script([writes('notes.txt', 'ticket four\n')], [greenBinder([3, 4])])
  const r2 = c.p.werk(['run', 'root'])
  expect(r2.code).not.toBe(0)
  expect(movesOf(4)).toContain('merging')
  expect(c.ticket(4)!.column).not.toBe('done')
  expect(c.git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 60_000)

test('87.4 a red held-out step after a merge files a follow-up and shows a badge on the done ticket', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3)])
  // The step of ticket 3 is red on the main line once 3 merges; the follow-up's merge makes it green.
  script([writes('t3.txt'), writes('fix.txt')], [binder({ '3.1': 'false' }), binder({ '3.1': 'true', '4.1': 'true' })])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  expect(mainMerges()[0]).toBe(3)

  const all = c.events()
  const filed = all.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThan(-1)
  const then = all.slice(0, filed + 1)
  expect(c.ticket(3, then)).toMatchObject({ column: 'done', followUps: [4] })
  const follow = c.ticket(4, then)!
  expect(follow.column).toBe('ready')
  expect(follow.brief).toContain(STEP('MARK-87'))
  expect(follow.brief).toContain('3.1')
}, 60_000)

test('87.5 G2 opens after the last merge with every step green, and again after a later merge', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3, { touches: ['same'] }), ticketOf(4, { touches: ['same'] })])
  script([writes('t3.txt'), writes('t4.txt')], [greenBinder([3]), greenBinder([3, 4])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  const all = c.events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  const secondDone = all.findIndex((e, i) => i > firstDone && e.type === 'ticket.moved' && e.payload.to === 'done')
  // G2 is not open between the first and the second merge.
  expect(all.slice(firstDone, secondDone).filter((e) => e.type === 'gate.opened')).toHaveLength(0)
  const tip1 = c.git('rev-parse', 'main')
  const gates = () => c!.events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
  expect(gates()).toEqual([tip1])

  // The person approves G2: werk has no verb or board action for it.
  const help = c.p.werk(['help']).stdout
  const approve = /approve/i.test(help)

  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(5, { touches: ['same'] }) })
  script([writes('t5.txt')], [greenBinder([3, 4, 5])])
  const r2 = c.p.werk(['run', 'root'])
  expect(r2.stderr).toBe('')
  expect(r2.code).toBe(0)
  const tip2 = c.git('rev-parse', 'main')
  expect(tip2).not.toBe(tip1)
  expect(gates()).toEqual([tip1, tip2])
  expect(approve).toBe(true)
}, 90_000)
