/** Held-out steps 88.1 to 88.5: what builds when, in the merge loop. */
import { expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldBoard } from '../../src/board/fold.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { binder, judges, project, reply, startWerk, until, writes, type Ctx } from './common.ts'

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const green = (n: number[]) => binder(Object.fromEntries(n.map((t) => [`${t}.1`, 'true'])))
const gated = (gate: string, path: string): FakeReply => ({ steps: [{ waitFor: gate }, ...writes(path).steps] })

/** The columns of every ticket after each event of the board log. */
const states = (ctx: Ctx) => {
  const all = ctx.events()
  return all.map((_, i) => {
    const cols: Record<string, number[]> = {}
    for (const c of foldBoard(all.slice(0, i + 1)).columns) cols[c.name] = c.tickets.map((t) => t.number)
    return cols
  })
}
const now = (ctx: Ctx) => states(ctx).at(-1) ?? {}
const at = (ctx: Ctx, n: number, to: string) => ctx.events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)

test('88.1 nothing builds before the person starts the run', async () => {
  const ctx = project([1, 2, 3], { makefile: 'check:\n\t@true\n' })
  const gate = join(ctx.p.dir, '..', 'gate')
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: gated(gate, 'x.txt'), 'heldout-author': author, 'heldout-binder': green([1, 2, 3]) } })
  // The person opens the board and waits.
  await Bun.sleep(3000)
  expect(now(ctx).ready).toEqual([1, 2, 3])
  expect(now(ctx).building ?? []).toEqual([])
  expect(ctx.p.agentRoles()).not.toContain('builder')
  const run = startWerk(ctx, ['run', 'root', '--poll-every', '50'])
  await until('a ticket in building', () => (now(ctx).building ?? []).length > 0)
  run.kill()
  await run.done
}, 60_000)

test('88.2 four unblocked tickets with distinct modules build three at a time', async () => {
  const ctx = project([1, 2, 3, 4], { makefile: 'check:\n\t@true\n' })
  const gate = join(ctx.p.dir, '..', 'gate')
  ctx.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [gated(gate, 'a.txt'), gated(gate, 'b.txt'), gated(gate, 'c.txt'), writes('d.txt')], 'heldout-author': author, 'heldout-binder': green([1, 2, 3, 4]) },
  })
  const run = startWerk(ctx, ['run', 'root', '--poll-every', '50'])
  await until('three builders', () => ctx.p.agentRoles().filter((r) => r === 'builder').length === 3)
  await Bun.sleep(1000)
  expect((now(ctx).building ?? []).length).toBe(3)
  expect(now(ctx).ready).toHaveLength(1)
  const fourth = now(ctx).ready![0]!
  writeFileSync(gate, '')
  const r = await run.done
  expect(r.code).toBe(0)
  const firstDone = ctx.events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(at(ctx, fourth, 'building')).toBeGreaterThan(firstDone)
  // The fourth build starts from a main line that holds the merge of the first done ticket.
  const doneN = (ctx.events()[firstDone]!.payload as { number: number }).number
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on werk-build/\\S+, from main at (\\w+)`).exec(r.stdout)?.[1]
  expect(base).toBeDefined()
  expect(ctx.git('log', '--format=%s', base!).split('\n').some((s) => s.startsWith(`werk: merge ticket ${doneN} `))).toBe(true)
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', async () => {
  const ctx = project([1, 2, 3], { makefile: 'check:\n\t@true\n', fields: { 1: { touches: ['decision log'] }, 2: { touches: ['decision log'] }, 3: { touches: ['map view'] } } })
  const gate = join(ctx.p.dir, '..', 'gate')
  ctx.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [gated(gate, 'a.txt'), gated(gate, 'b.txt'), writes('c.txt')], 'heldout-author': author, 'heldout-binder': green([1, 2, 3]) },
  })
  const run = startWerk(ctx, ['run', 'root', '--poll-every', '50'])
  await until('two builders', () => ctx.p.agentRoles().filter((r) => r === 'builder').length === 2)
  await Bun.sleep(1000)
  const building = now(ctx).building ?? []
  expect(building).toContain(3)
  expect(building).toHaveLength(2)
  const firstDl = building.find((n) => n !== 3)!
  const otherDl = firstDl === 1 ? 2 : 1
  expect(now(ctx).ready).toEqual([otherDl])
  writeFileSync(gate, '')
  const r = await run.done
  expect(r.code).toBe(0)
  expect(at(ctx, otherDl, 'building')).toBeGreaterThan(at(ctx, firstDl, 'done'))
  for (const s of states(ctx)) expect((s.building ?? []).filter((n) => n === 1 || n === 2).length).toBeLessThanOrEqual(1)
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  const ctx = project([1, 2], { makefile: 'check:\n\t@true\n', fields: { 2: { blockedBy: [1] } } })
  ctx.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('a.txt'), writes('b.txt')], 'heldout-author': author, 'heldout-binder': green([1, 2]) } })
  const r = ctx.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(at(ctx, 1, 'building')).toBeGreaterThanOrEqual(0)
  for (const s of states(ctx)) {
    const oneActive = (s.building ?? []).includes(1) || (s.merging ?? []).includes(1)
    if (oneActive) expect(s.building ?? []).not.toContain(2)
  }
  expect(at(ctx, 2, 'building')).toBeGreaterThan(at(ctx, 1, 'done'))
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', async () => {
  const ctx = project([1, 2, 3], { makefile: 'check:\n\t@true\n' })
  const gate = join(ctx.p.dir, '..', 'gate')
  ctx.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [gated(gate, 'a.txt'), gated(gate, 'b.txt'), gated(gate, 'c.txt')], 'heldout-author': author, 'heldout-binder': green([1, 2, 3]) },
  })
  const run = startWerk(ctx, ['run', 'root', '--poll-every', '50'])
  await until('three builders', () => ctx.p.agentRoles().filter((r) => r === 'builder').length === 3)
  writeFileSync(gate, '')
  const r = await run.done
  expect(r.code).toBe(0)
  for (const s of states(ctx)) expect((s.merging ?? []).length).toBeLessThanOrEqual(1)
  expect(now(ctx).done?.toSorted()).toEqual([1, 2, 3])
  expect(existsSync(gate)).toBe(true)
}, 90_000)
