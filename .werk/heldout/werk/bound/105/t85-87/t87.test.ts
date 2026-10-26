/** Held-out steps 87.1, 87.3 and 87.5: the merge loop, from the command line. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { judges, project, reply, resultStep, ticketOf, writes, type Ctx } from './common.ts'

let c: Ctx
afterEach(() => c?.p.run(['git', 'worktree', 'prune']))

const GREEN = 'check:\n\t@true\n'
const author = reply({ steps: [{ text: 'Given the product is installed\nWhen the user opens it\nThen the user sees it' }] })
const binder = (ids: number[]) => reply({ steps: ids.map((n) => ({ id: `${n}.1`, cmd: 'true' })) })
const script = (builder: FakeReply[], binders: FakeReply[]) =>
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': binders } })
const merges = () => c.git('log', '--first-parent', '--format=%s', 'main').split('\n').filter((s) => s.startsWith('werk: merge'))
const gates = () => c.events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))

test('87.1 two green tickets merge onto the main line one after the other', () => {
  c = project(GREEN, [ticketOf(3), ticketOf(4)])
  const branchesBefore = c.git('branch', '--format=%(refname:short)').split('\n')
  script([writes('t3.txt'), writes('t4.txt')], [binder([3]), binder([3, 4])])
  const r = c.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(c.movesOf(3)).toEqual(['building', 'merging', 'done'])
  expect(c.movesOf(4)).toEqual(['building', 'merging', 'done'])
  // One merge after the other: two merge commits in a row on the main line, in the order the board saw them reach done.
  const order = merges().toReversed().map((s) => Number(/ticket (\d+)/.exec(s)![1]))
  expect(order).toHaveLength(2)
  const doneOrder = c.events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.to === 'done' ? [e.payload.number] : []))
  expect(order).toEqual(doneOrder)
  expect(c.git('rev-parse', 'main^1')).toBe(c.git('log', '--first-parent', '--format=%H', '-n', '1', '--grep', `ticket ${order[0]}`, 'main'))
  const branches = c.git('branch', '--format=%(refname:short)').split('\n')
  expect(branches.filter((b) => !branchesBefore.includes(b) && !b.startsWith('werk-build/'))).toEqual([])
  expect(branches.filter((b) => b.startsWith('werk-build/'))).toHaveLength(2)
  expect(foldBoard(c.events()).columns.flatMap((col) => col.tickets).every((t) => t.followUps.length === 0)).toBe(true)
}, 60_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', async () => {
  c = project(GREEN, [ticketOf(3), ticketOf(4)], { 'notes.txt': 'notes\n' })
  const tip0 = c.git('rev-parse', 'main')
  const go = join(c.p.dir, '..', 'go-ticket-4')
  const second: FakeReply = { steps: [{ waitFor: go }, { edit: { path: 'notes.txt', content: 'ticket four\n' } }, resultStep] }
  script([writes('notes.txt', 'ticket three\n'), second], [binder([3]), binder([3, 4])])
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'run', 'root', '--parallel', '1'], {
    cwd: c.p.dir,
    env: c.p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // The person watches the folder until the first merge lands.
  for (const end = Date.now() + 30_000; Date.now() < end && readFileSync(join(c.p.dir, 'notes.txt'), 'utf8') !== 'ticket three\n'; ) await Bun.sleep(100)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('ticket three\n')
  expect(c.git('rev-parse', 'main')).not.toBe(tip0)
  const tip1 = c.git('rev-parse', 'main')

  writeFileSync(join(c.p.dir, 'notes.txt'), 'my own edit\n')
  writeFileSync(go, '')
  const [code, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(c.movesOf(4)).toContain('merging')
  expect(c.columnOf(4)).not.toBe('done')
  expect(c.git('rev-parse', 'main')).toBe(tip1)
  expect(readFileSync(join(c.p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
  expect(code).not.toBe(0)
  expect(stderr).toContain('stopped')
}, 90_000)

test('87.5 G2 opens after the last merge with all held-out steps green and opens again after a later merge', async () => {
  c = project(GREEN, [ticketOf(3), ticketOf(4)])
  script([writes('t3.txt'), writes('t4.txt')], [binder([3]), binder([3, 4])])
  const r = c.p.werk(['run', 'root', '--parallel', '1'])
  expect(r.code).toBe(0)
  const firstMerge = c.git('rev-parse', 'main~1')
  // After the first merge G2 was not open; after the second, it opened for the tip.
  expect(gates()).not.toContain(firstMerge)
  expect(gates()).toEqual([c.git('rev-parse', 'main')])

  c.appendBoard({ type: 'ticket.planned', payload: ticketOf(5) })
  script([writes('t5.txt')], [binder([3, 4, 5])])
  expect(c.p.werk(['run', 'root']).code).toBe(0)
  expect(gates()).toHaveLength(2)
  expect(gates()[1]).toBe(c.git('rev-parse', 'main'))

  // The person approves G2: werk needs a verb or a control for that.
  expect(c.p.werk(['help']).stdout).toMatch(/approve/i)
}, 90_000)
