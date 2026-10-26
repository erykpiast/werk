import { afterEach, expect, test } from 'bun:test'
import { MAIN, builder, launchesOf, project, script, startRun, ticketOf, until, type Env } from './util.ts'

let e: Env | undefined
let cleanup: (() => void)[] = []
afterEach(() => {
  for (const c of cleanup) c()
  cleanup = []
  e?.p.run(['git', 'worktree', 'prune'])
  e?.p.cleanup()
  e = undefined
})

/** Reads the address `werk serve` prints. */
async function serve(env: Env) {
  const child = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: env.p.dir, env: env.p.env, stdout: 'pipe', stderr: 'pipe' })
  cleanup.push(() => child.kill())
  const reader = child.stdout.getReader()
  let out = ''
  for (const end = Date.now() + 20_000; Date.now() < end; ) {
    const { value, done } = await reader.read()
    if (done) break
    out += new TextDecoder().decode(value)
    const m = out.match(/http:\/\/\S+\//)
    if (m) return m[0]
  }
  throw new Error(`werk serve printed no address: ${out}`)
}

// 88.1
// Scenario: Nothing builds before the person starts the run
// Given a plan run with three unblocked tickets on the board in ready
// When the person opens the board and waits
// Then every ticket stays in ready
// And no ticket shows in building
// When the person starts the merge loop on the plan run
// Then the tickets move to building without any other action from the person
test('88.1', async () => {
  e = project([ticketOf(1), ticketOf(2), ticketOf(3)])
  const env = e
  script(env, [builder('b1.txt', env.gate('go')), builder('b2.txt', env.gate('go')), builder('b3.txt', env.gate('go'))], [1, 2, 3])
  // The person opens the board: the server runs, and the page reads /api/board.
  const url = await serve(env)
  const first = (await (await fetch(`${url}api/board`)).json()) as { columns: { name: string; tickets: { number: number }[] }[] }
  expect(first.columns.find((c) => c.name === 'ready')!.tickets.map((t) => t.number)).toEqual([1, 2, 3])
  // The person waits; the test polls the board fold for 4 s.
  for (const end = Date.now() + 4000; Date.now() < end; await Bun.sleep(100)) {
    expect(env.inColumn('ready')).toEqual([1, 2, 3])
    expect(env.inColumn('building')).toEqual([])
  }
  expect(launchesOf(env, 'builder')).toHaveLength(0)
  expect(env.events().filter((x) => x.type !== 'ticket.planned')).toEqual([])

  // The person starts the merge loop, and does nothing more.
  const run = startRun(env, ['--actor', 'you'])
  await until('three tickets in building', () => env.inColumn('building').length === 3, 30_000)
  expect(env.inColumn('building').sort()).toEqual([1, 2, 3])
  expect(env.inColumn('ready')).toEqual([])
  env.open('go')
  const r = await run.done
  expect(r.code).toBe(0)
  expect(env.inColumn('done').sort()).toEqual([1, 2, 3])
}, 120_000)

// 88.2
// Scenario: Four unblocked tickets with distinct modules build three at a time
// Given a plan run with four unblocked tickets whose touches lines name four different modules
// When the person starts the merge loop on the plan run
// Then three tickets show in building at the same time
// And the fourth ticket stays in ready
// When one of the three building tickets merges and shows in done
// Then the fourth ticket moves to building
// And the fourth ticket's build contains the change of the merged ticket
test('88.2', async () => {
  e = project([ticketOf(1), ticketOf(2), ticketOf(3), ticketOf(4)])
  const env = e
  // The nth builder launch writes bn.txt; launches 1-3 wait on their own gate, launch 4 waits on g4.
  script(env, [builder('b1.txt', env.gate('g1')), builder('b2.txt', env.gate('g2')), builder('b3.txt', env.gate('g3')), builder('b4.txt', env.gate('g4'))], [1, 2, 3, 4])
  const run = startRun(env)
  await until('three in building', () => env.inColumn('building').length === 3 && launchesOf(env, 'builder').length === 3, 30_000)
  const three = env.inColumn('building')
  expect(three).toEqual([1, 2, 3])
  expect(env.inColumn('ready')).toEqual([4])
  // Hold a moment: the fourth stays in ready while three build.
  for (const end = Date.now() + 1500; Date.now() < end; await Bun.sleep(100)) expect(env.inColumn('ready')).toEqual([4])

  env.open('g1')
  await until('one ticket done', () => env.inColumn('done').length === 1, 60_000)
  const mergedTicket = env.inColumn('done')[0]!
  await until('ticket 4 in building', () => env.columnOf(4) === 'building', 60_000)
  expect(env.inColumn('done')).toEqual([mergedTicket])
  // The fourth build's worktree: read the branch base that the run printed for ticket 4 after its builder started.
  await until('the fourth builder', () => launchesOf(env, 'builder').length === 4, 30_000)
  env.open('g4')
  env.open('g2')
  env.open('g3')
  const r = await run.done
  expect(r.code).toBe(0)
  const m = /building 4 Ticket 4 on (werk-build\/\S+), from main at (\w+)/.exec(r.stdout)
  expect(m).not.toBeNull()
  // The merged ticket's change is the file b1.txt (the first builder launch was released first).
  expect(env.git('show', `${m![2]}:b1.txt`)).toBe('b1.txt')
  expect(env.git('ls-tree', '--name-only', m![1]!).split('\n')).toContain('b1.txt')
}, 180_000)

// 88.3
// Scenario: Two tickets that touch a common module never build at the same time
// Given a plan run with two unblocked tickets whose touches lines both name the module "decision log"
// And a third unblocked ticket whose touches line names only "map view"
// When the person starts the merge loop on the plan run
// Then one of the two "decision log" tickets and the "map view" ticket show in building
// And the other "decision log" ticket stays in ready
// When the first "decision log" ticket merges and shows in done
// Then the other "decision log" ticket moves to building
// And at no time during the run do both "decision log" tickets show in building
test('88.3', async () => {
  e = project([ticketOf(1, { touches: ['decision log'] }), ticketOf(2, { touches: ['decision log'] }), ticketOf(3, { touches: ['map view'] })])
  const env = e
  script(env, [builder('b1.txt', env.gate('g1')), builder('b2.txt', env.gate('g2')), builder('b3.txt', env.gate('g3'))], [1, 2, 3])
  const run = startRun(env)
  let bothSeen = false
  const watch = setInterval(() => {
    const b = env.inColumn('building')
    if (b.includes(1) && b.includes(2)) bothSeen = true
  }, 50)
  try {
    await until('two in building', () => env.inColumn('building').length === 2 && launchesOf(env, 'builder').length === 2, 30_000)
    const building = env.inColumn('building')
    expect(building).toContain(3)
    const firstDl = building.find((n) => n !== 3)!
    expect([1, 2]).toContain(firstDl)
    const otherDl = firstDl === 1 ? 2 : 1
    for (const end = Date.now() + 1500; Date.now() < end; await Bun.sleep(100)) expect(env.inColumn('ready')).toEqual([otherDl])
    // Release the first two builder launches (the decision log one and the map view one).
    env.open('g1')
    env.open('g2')
    await until('first decision log done', () => env.columnOf(firstDl) === 'done', 60_000)
    await until('other decision log in building', () => env.columnOf(otherDl) === 'building', 60_000)
    env.open('g3')
    const r = await run.done
    expect(r.code).toBe(0)
  } finally {
    clearInterval(watch)
  }
  expect(bothSeen).toBe(false)
  // Every state of the board log: never both decision log tickets in building.
  const both = env.history().filter((h) => {
    const b = env.inColumn('building', h)
    return b.includes(1) && b.includes(2)
  })
  expect(both).toHaveLength(0)
}, 180_000)

// 88.4
// Scenario: A ticket waits until its blocker is merged
// Given a plan run with ticket 1 that has no blocker
// And ticket 2 whose blocked_by line names ticket 1
// And the two tickets touch different modules
// When the person starts the merge loop on the plan run
// Then ticket 1 shows in building
// And ticket 2 does not show in building while ticket 1 is in building or merging
// When ticket 1 shows in done
// Then ticket 2 moves to building
test('88.4', async () => {
  e = project([ticketOf(1), ticketOf(2, { blockedBy: [1] })])
  const env = e
  script(env, [builder('b1.txt', env.gate('g1')), builder('b2.txt', env.gate('g2'))], [1, 2])
  const run = startRun(env)
  await until('ticket 1 in building', () => env.columnOf(1) === 'building', 30_000)
  for (const end = Date.now() + 1500; Date.now() < end; await Bun.sleep(100)) expect(env.columnOf(2)).not.toBe('building')
  env.open('g1')
  await until('ticket 1 done', () => env.columnOf(1) === 'done', 60_000)
  await until('ticket 2 in building', () => env.columnOf(2) === 'building', 60_000)
  env.open('g2')
  const r = await run.done
  expect(r.code).toBe(0)
  const bad = env.history().filter((h) => ['building', 'merging'].includes(env.columnOf(1, h)!) && env.columnOf(2, h) === 'building')
  expect(bad).toHaveLength(0)
}, 120_000)

// 88.5
// Scenario: The merge queue merges one ticket at a time while three build
// Given a plan run with three unblocked tickets whose touches lines name three different modules
// When the person starts the merge loop on the plan run
// And all three tickets finish their builds
// Then at most one ticket shows in merging at any time
// And all three tickets end in done
test('88.5', async () => {
  e = project([ticketOf(1), ticketOf(2), ticketOf(3)])
  const env = e
  script(env, [builder('b1.txt', env.gate('go')), builder('b2.txt', env.gate('go')), builder('b3.txt', env.gate('go'))], [1, 2, 3])
  const run = startRun(env)
  let maxMerging = 0
  const watch = setInterval(() => (maxMerging = Math.max(maxMerging, env.inColumn('merging').length)), 20)
  try {
    await until('three builders', () => launchesOf(env, 'builder').length === 3, 30_000)
    // All three builds finish at once.
    env.open('go')
    const r = await run.done
    expect(r.code).toBe(0)
  } finally {
    clearInterval(watch)
  }
  expect(maxMerging).toBeLessThanOrEqual(1)
  const most = Math.max(...env.history().map((h) => env.inColumn('merging', h).length))
  expect(most).toBeLessThanOrEqual(1)
  expect(env.inColumn('done').sort()).toEqual([1, 2, 3])
}, 120_000)
