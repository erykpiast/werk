/** Held-out group 88: nothing builds before the run, parallel builds, module overlap, blockers, one merge at a time. */
import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Board } from '../src/board/fold.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { STEP, greenBinder, judges, reply, setup, ticketOf, writes, type Ctx } from './s86-lib.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
let c: Ctx | undefined
afterEach(() => {
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const script = (builder: FakeReply[], binders: FakeReply[]) =>
  c!.p.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': reply({ steps: [{ text: STEP('MARK-88') }] }), 'heldout-binder': binders } })
const columnsAt = (state: ReturnType<Ctx['states']>[number]) => new Map(state.map((t) => [t.number, t.column]))
const moveIndex = (n: number, to: string) => c!.events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)
const pass = (path: string): FakeReply => writes(path, `${path}\n`, [{ sleep: 300 }])

test('88.1 nothing builds before the person starts the run', async () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [1, 2, 3].map((n) => ticketOf(n)))
  script([pass('t1.txt'), pass('t2.txt'), pass('t3.txt')], [greenBinder([1, 2, 3])])

  // The person opens the board and waits.
  const server = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: c.p.dir, env: c.p.env, stdout: 'pipe', stderr: 'pipe' })
  try {
    const reader = server.stdout.getReader()
    let out = ''
    let url: string | undefined
    const until = Date.now() + 20_000
    while (!url && Date.now() < until) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
      url = /http:\/\/\S+\//.exec(out)?.[0]
    }
    expect(url).toBeDefined()
    const look = async () => ((await (await fetch(`${url}api/board`)).json()) as Board)
    for (const wait of [0, 3000]) {
      await Bun.sleep(wait)
      const board = await look()
      const col = (name: string) => board.columns.find((col) => col.name === name)!.tickets.map((t) => t.number)
      expect(col('ready').toSorted()).toEqual([1, 2, 3])
      expect(col('building')).toEqual([])
    }
  } finally {
    server.kill()
    await server.exited
  }
  expect(c.events().filter((e) => e.type === 'ticket.moved')).toEqual([])
  expect(c.p.agentRoles()).toEqual([])

  // The person starts the merge loop; the tickets move to building with no other action.
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  for (const n of [1, 2, 3]) expect(moveIndex(n, 'building')).toBeGreaterThan(-1)
}, 60_000)

test('88.2 four unblocked tickets with distinct modules build three at a time', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [1, 2, 3, 4].map((n) => ticketOf(n, { touches: [`mod-${n}`] })))
  script([pass('t1.txt'), pass('t2.txt'), pass('t3.txt'), pass('t4.txt')], [greenBinder([1, 2, 3, 4])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  const states = c.states().map(columnsAt)
  // A moment with three in building at once, and the fourth in ready.
  const three = states.findIndex((s) => [...s.values()].filter((col) => col === 'building').length === 3)
  expect(three).toBeGreaterThan(-1)
  const fourth = [...states[three]!].find(([, col]) => col === 'ready')?.[0]
  expect(fourth).toBeDefined()
  // At no time do four build at once.
  for (const s of states) expect([...s.values()].filter((col) => col === 'building').length).toBeLessThanOrEqual(3)
  // The fourth starts only after one of the three merged and shows in done.
  const firstDone = c.events().findIndex((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(moveIndex(fourth!, 'building')).toBeGreaterThan(firstDone)
  const merged = (c.events()[firstDone] as { payload: { number: number } }).payload.number
  // The fourth ticket's build contains the merged ticket's change.
  const base = new RegExp(`building ${fourth} Ticket ${fourth} on (werk-build/\\S+), from main at (\\w+)`).exec(r.stdout)
  expect(base).not.toBeNull()
  const branch = base![1]!
  expect(c.git('log', '--format=%s', branch).split('\n').some((s) => s.startsWith(`werk: merge ticket ${merged} `))).toBe(true)
}, 90_000)

test('88.3 two tickets that touch a common module never build at the same time', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [
    ticketOf(1, { touches: ['decision log'] }),
    ticketOf(2, { touches: ['decision log'] }),
    ticketOf(3, { touches: ['map view'] }),
  ])
  script([pass('t1.txt'), pass('t2.txt'), pass('t3.txt')], [greenBinder([1, 2, 3])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  const states = c.states().map(columnsAt)
  // One "decision log" ticket and the "map view" ticket build together, the other waits in ready.
  const together = states.findIndex(
    (s) => s.get(3) === 'building' && [1, 2].filter((n) => s.get(n) === 'building').length === 1 && [1, 2].some((n) => s.get(n) === 'ready'),
  )
  expect(together).toBeGreaterThan(-1)
  const firstDl = [1, 2].find((n) => states[together]!.get(n) === 'building')!
  const other = firstDl === 1 ? 2 : 1
  expect(moveIndex(other, 'building')).toBeGreaterThan(moveIndex(firstDl, 'done'))
  for (const s of states) expect(s.get(1) === 'building' && s.get(2) === 'building').toBe(false)
  expect(c.ticket(other)!.column).toBe('done')
}, 90_000)

test('88.4 a ticket waits until its blocker is merged', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(1, { touches: ['alpha'] }), ticketOf(2, { touches: ['beta'], blockedBy: [1] })])
  script([pass('t1.txt'), pass('t2.txt')], [greenBinder([1, 2])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  const states = c.states().map(columnsAt)
  expect(states.some((s) => s.get(1) === 'building')).toBe(true)
  for (const s of states) if (s.get(1) === 'building' || s.get(1) === 'merging') expect(s.get(2)).not.toBe('building')
  expect(moveIndex(1, 'done')).toBeGreaterThan(-1)
  expect(moveIndex(2, 'building')).toBeGreaterThan(moveIndex(1, 'done'))
}, 90_000)

test('88.5 the merge queue merges one ticket at a time while three build', () => {
  c = setup('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [1, 2, 3].map((n) => ticketOf(n, { touches: [`mod-${n}`] })))
  script([pass('t1.txt'), pass('t2.txt'), pass('t3.txt')], [greenBinder([1, 2, 3])])
  const r = c.p.werk(['run', 'root'])
  expect(r.stderr).toBe('')
  const states = c.states().map(columnsAt)
  expect(states.some((s) => [...s.values()].filter((col) => col === 'building').length === 3)).toBe(true)
  for (const s of states) expect([...s.values()].filter((col) => col === 'merging').length).toBeLessThanOrEqual(1)
  for (const n of [1, 2, 3]) expect(c.ticket(n)!.column).toBe('done')
}, 90_000)
