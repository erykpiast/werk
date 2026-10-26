import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendBoard, buildRefusal, foldBoard, readBoard } from './board.ts'
import { alive, boardRoutes, readFrom, runCommand } from './board-routes.ts'
import { elapsed, heldoutBadges, planLine, takeLogPush } from '../web/board.js'

const BOARD_TS = join(import.meta.dir, 'board.ts')

/**
 * Stands in for `bun src/cli.ts build <id>` until the pipeline lands: it opens a session with
 * a live log, writes a line, and ends the session as "stopped" on SIGTERM.
 */
const STUB = `
import { appendFileSync, writeFileSync } from 'node:fs'
import { appendBoard } from ${JSON.stringify(BOARD_TS)}
const id = process.argv[2]
const log = process.env.STUB_LOG
writeFileSync(log, '')
appendBoard('ticket.build.started', { id, loopRun: 'L1', log, pid: process.pid, group: process.env.WERK_BUILD_GROUP === '1' })
appendFileSync(log, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello from the stub' }] } }) + '\\n')
process.on('SIGTERM', () => {
  appendBoard('ticket.build.ended', { id, loopRun: 'L1', result: 'stopped' })
  process.exit(0)
})
setInterval(() => appendFileSync(log, JSON.stringify({ text: 'tick' }) + '\\n'), 50)
`

/** The archive signals nothing (#werk-board-control-archive-ends-build). A stub build does not
 *  read the board, so a test that archives to clean up also ends the stub itself. */
async function archiveAndStop(id: string) {
  await post('/api/ticket/archive', { id })
  const child = routes.children.get(id)
  if (child?.pid) process.kill(-child.pid, 'SIGTERM')
  await until(() => !routes.children.has(id))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return
    await sleep(25)
  }
  throw new Error('timed out')
}

let dir: string
const dirs: string[] = []
let boardPath: string
let server: Server
let base: string
let routes: ReturnType<typeof boardRoutes>
const pushed: Array<[string, any]> = []

beforeEach(async () => {
  server?.close()
  dir = mkdtempSync(join(tmpdir(), 'werk-board-test-'))
  dirs.push(dir)
  boardPath = join(dir, 'board.jsonl')
  const tickets = join(dir, 'tickets', 'r')
  mkdirSync(tickets, { recursive: true })
  writeFileSync(join(tickets, '01.md'), 'title: One\ncites: vi-board\n\nThe slice.\n\n## Checks\n\n- `true`\n')
  writeFileSync(join(tickets, '02.md'), 'title: Two\nblocked_by: 1\n\nx\n')
  writeFileSync(join(tickets, '03.md'), 'title: Three\n\nx\n')
  for (const [n, title, blockedBy] of [['01', 'One', []], ['02', 'Two', ['r/01']], ['03', 'Three', []]] as const) {
    appendBoard('ticket.planned', { id: `r/${n}`, run: 'r', file: join(tickets, `${n}.md`), title, blockedBy: [...blockedBy] }, { path: boardPath })
  }
  writeFileSync(join(dir, 'stub.ts'), STUB)
  pushed.length = 0
  process.env.STUB_LOG = join(dir, 'build.jsonl')
  routes = boardRoutes({
    boardPath,
    ticketsDir: join(dir, 'tickets'),
    cwd: dir,
    buildCommand: (id) => ['bun', join(dir, 'stub.ts'), id],
    push: (event, data) => pushed.push([event, data]),
  })
  server = createServer((req, res) => {
    if (!routes.handle(req, res)) res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as { port: number }).port}`
})

afterAll(() => {
  server?.close()
  for (const c of routes.children.values()) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }))
const board = () => foldBoard(readBoard(boardPath))

/** A second server over the same board and tickets, with its own (empty) map of children. */
const mount = () => mountWith({})
async function mountWith(o: Parameters<typeof boardRoutes>[0]) {
  const r = boardRoutes({ boardPath, ticketsDir: join(dir, 'tickets'), cwd: dir, buildCommand: (id) => ['bun', join(dir, 'stub.ts'), id], ...o })
  const s = createServer((req, res) => {
    if (!r.handle(req, res)) res.writeHead(404).end()
  })
  await new Promise<void>((ok) => s.listen(0, ok))
  const at = `http://localhost:${(s.address() as { port: number }).port}`
  return {
    routes: r,
    at,
    post: (path: string, body: unknown) =>
      fetch(at + path, { method: 'POST', body: JSON.stringify(body) }).then(async (res) => ({ status: res.status, body: (await res.json()) as any })),
    close: () => s.close(),
  }
}

describe('GET /api/board', () => {
  test('returns the columns and each ticket with its text', async () => {
    const data = (await (await fetch(base + '/api/board')).json()) as any
    expect(data.columns).toEqual({ blocked: ['r/02'], ready: ['r/01', 'r/03'], building: [], merging: [], done: [] })
    const one = data.tickets.find((t: any) => t.id === 'r/01')
    expect(one.text).toMatchObject({ title: 'One', cites: ['vi-board'], body: 'The slice.', checks: ['true'] })
    expect([one.canTrigger, one.canArchive]).toEqual([true, true])
    expect(data.runs).toEqual({})
  })

  test('returns each run\'s gate state', async () => {
    appendBoard('run.tier', { run: 'r', tier: 'feature' }, { path: boardPath })
    appendBoard('gate.waiting', { run: 'r', gate: 'G2', tip: 'abc123', reason: 'every ticket merged' }, { path: boardPath })
    const data = (await (await fetch(base + '/api/board')).json()) as any
    expect(data.runs.r).toEqual({ tier: 'feature', gates: { G2: { waiting: 'abc123', reason: 'every ticket merged' } } })
  })
})

describe('plans (#vi-board-plan)', () => {
  const line = (text: string) => JSON.stringify({ text }) + '\n'

  test('a running plan is listed with its state, and its log is both writers, spec first', async () => {
    writeFileSync(join(dir, 'spec.jsonl'), line('reading the cards'))
    writeFileSync(join(dir, 'tickets.jsonl'), line('writing 01'))
    appendBoard('plan.started', { run: 'r', pid: process.pid }, { path: boardPath })
    appendBoard('plan.step', { run: 'r', step: 'spec', log: 'spec.jsonl' }, { path: boardPath })
    appendBoard('plan.step', { run: 'r', step: 'tickets', log: join(dir, 'tickets.jsonl') }, { path: boardPath })
    const data = (await (await fetch(base + '/api/board')).json()) as any
    expect(data.plans).toHaveLength(1)
    expect(data.plans[0]).toMatchObject({ run: 'r', live: true, state: 'creating', step: 'tickets', tickets: ['r/01', 'r/02', 'r/03'] })
    const out = (await (await fetch(base + '/api/plan/log?run=r')).json()) as any
    expect(out.lines).toEqual([{ text: 'reading the cards', step: 'spec' }, { text: 'writing 01', step: 'tickets' }])
    expect(out.spec).toBe('')
  })

  test('the plan log carries the whole spec the plan wrote', async () => {
    mkdirSync(join(dir, '.werk', 'specs'), { recursive: true })
    writeFileSync(join(dir, '.werk', 'specs', 'r.md'), '# Spec\n\n1. A story.\n')
    appendBoard('plan.started', { run: 'r', pid: process.pid }, { path: boardPath })
    const out = (await (await fetch(base + '/api/plan/log?run=r')).json()) as any
    expect(out.spec).toBe('# Spec\n\n1. A story.\n')
  })

  test('a live plan whose process is gone shows as stopped', async () => {
    appendBoard('plan.started', { run: 'r', pid: 2 ** 22 + 12345 }, { path: boardPath })
    const data = (await (await fetch(base + '/api/board')).json()) as any
    expect(data.plans[0]).toMatchObject({ live: false, state: 'stopped', result: 'error' })
  })

  test('the tail pushes plan-log when a live plan log grows, and not when it does not', () => {
    const path = join(dir, 'spec.jsonl')
    writeFileSync(path, line('a'))
    appendBoard('plan.started', { run: 'r', pid: process.pid }, { path: boardPath })
    appendBoard('plan.step', { run: 'r', step: 'spec', log: path }, { path: boardPath })
    const planLogs = () => pushed.filter(([e]) => e === 'plan-log')
    routes.tail()
    expect(planLogs()).toEqual([['plan-log', { run: 'r' }]])
    routes.tail()
    expect(planLogs()).toHaveLength(1)
    appendFileSync(path, line('b'))
    routes.tail()
    expect(planLogs()).toHaveLength(2)
  })

  test('an unknown plan is a 404', async () => {
    expect((await fetch(base + '/api/plan/log?run=nope')).status).toBe(404)
  })

  test('the card line names the running step, the stop reason, or the done count', () => {
    expect(planLine({ state: 'creating', step: 'tickets' }, [])).toBe('ticket writer running')
    expect(planLine({ state: 'stopped', result: 'agent-error', failedStep: 'spec' }, [])).toBe('agent error in spec writer')
    expect(planLine({ state: 'building' }, [{ column: 'done' }, { column: 'ready' }, { column: 'ready', archived: true }])).toBe('1 of 2 tickets done')
  })
})

describe("the map's Build button (#werk-board-build-subtree)", () => {
  /** Stands in for plan-then-run: writes its argument, then waits for a signal. */
  const SUBTREE_STUB = `
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.SUBTREE_MARK, process.argv[2])
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`
  const scope: Record<string, string[]> = { ready: [], waits: ['kid', 'other'] }
  const withButton = () => {
    writeFileSync(join(dir, 'subtree.ts'), SUBTREE_STUB)
    process.env.SUBTREE_MARK = join(dir, 'mark')
    return mountWith({ blockers: (id) => scope[id], subtreeCommand: (id) => ['bun', join(dir, 'subtree.ts'), id] })
  }
  const target = () => appendBoard('project.target', { repo: dir }, { path: boardPath })

  test('a decided scope builds in a detached process that the plan card stops', async () => {
    target()
    const m = await withButton()
    const start = await m.post('/api/subtree/build', { id: 'ready' })
    expect(start).toMatchObject({ status: 200, body: { ok: true } })
    await until(() => existsSync(join(dir, 'mark')))
    expect(readFileSync(join(dir, 'mark'), 'utf8')).toBe('ready')
    const pid = start.body.pid as number
    expect(board().plans.get('ready')).toMatchObject({ buildPid: pid })
    // A second press while it runs is refused, and spawns nothing.
    expect(await m.post('/api/subtree/build', { id: 'ready' })).toMatchObject({ status: 409, body: { error: 'a run is in progress on #ready: see its plan card on the board' } })
    const stop = await m.post('/api/subtree/stop', { run: 'ready' })
    expect(stop).toMatchObject({ status: 200, body: { ok: true } })
    await until(() => !alive(pid))
    expect(board().plans.get('ready')?.buildPid).toBeUndefined()
    expect(readBoard(boardPath).filter((e) => e.type === 'build.ended')).toHaveLength(1)
    m.close()
  })

  test('the button is refused with the reason: open cards in the scope, an unknown card, no target', async () => {
    const m = await withButton()
    expect(await m.post('/api/subtree/build', { id: 'ready' })).toMatchObject({ status: 409, body: { error: 'no target repository is set' } })
    target()
    expect(await m.post('/api/subtree/build', { id: 'waits' })).toMatchObject({ status: 409, body: { error: 'open or proto cards in the scope: kid, other' } })
    expect(await m.post('/api/subtree/build', { id: 'nope' })).toMatchObject({ status: 409, body: { error: 'no card "nope" in the map' } })
    expect(await m.post('/api/subtree/stop', { run: 'ready' })).toMatchObject({ status: 409, body: { error: 'no build of ready is running' } })
    expect(existsSync(join(dir, 'mark'))).toBe(false)
    m.close()
  })

  test('the GET says whether the button may start, and why not', async () => {
    const m = await withButton()
    target()
    const view = async (id: string) => (await fetch(`${m.at}/api/subtree/build?id=${id}`)).json()
    expect(await view('ready')).toMatchObject({ id: 'ready', blockers: [], running: false, action: 'build', refusal: null, blockedBy: null, unfinished: [] })
    expect(await view('waits')).toMatchObject({ id: 'waits', blockers: ['kid', 'other'], running: false, refusal: 'open or proto cards in the scope: kid, other' })
    m.close()
  })

  test('a running plan or merge loop over the subtree also refuses the button', () => {
    const b = (events: Array<[string, any]>) => {
      for (const [type, payload] of events) appendBoard(type as any, payload, { path: boardPath })
      return board()
    }
    const yes = () => true
    const busy = 'a run is in progress on #s: see its plan card on the board'
    expect(buildRefusal(b([['project.target', { repo: dir }]]), 's', [], yes)).toBeUndefined()
    expect(buildRefusal(b([['plan.started', { run: 's', pid: 7 }]]), 's', [], yes)).toBe(busy)
    expect(buildRefusal(b([['plan.ended', { run: 's', result: 'ok' }], ['run.started', { run: 's', pid: 8 }]]), 's', [], yes)).toBe(busy)
    expect(buildRefusal(board(), 's', [], () => false)).toBeUndefined()
  })
})

describe('Build, Resume and Restart on a map card (#vi-board-plan-controls, #werk-board-restart, #st-run-start-guard)', () => {
  /** Stands in for plan-then-run and for the resumed merge loop: writes its argv, then waits. */
  const STUB = `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.SUBTREE_MARK, process.argv.slice(2).join(' ') + '\\n')
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`
  // The map: billing is the parent of r. Every card's scope is decided.
  const parents: Record<string, string[]> = { r: ['billing'], billing: [] }
  const mark = () => join(dir, 'mark')
  const withControls = () => {
    writeFileSync(join(dir, 'subtree.ts'), STUB)
    process.env.SUBTREE_MARK = mark()
    appendBoard('project.target', { repo: dir }, { path: boardPath })
    return mountWith({
      blockers: (id) => (id in parents ? [] : undefined),
      ancestors: (id) => parents[id] ?? [],
      subtreeCommand: (id) => ['bun', join(dir, 'subtree.ts'), 'build', id],
      resumeCommand: (id) => ['bun', join(dir, 'subtree.ts'), 'resume', id],
    })
  }
  const view = async (at: string, id: string) => (await fetch(`${at}/api/subtree/build?id=${id}`)).json() as Promise<any>
  const stopAll = (pids: number[]) => pids.forEach((p) => alive(p) && process.kill(-p, 'SIGTERM'))

  test('unfinished work turns Build into Resume and Restart; Build is refused', async () => {
    const m = await withControls()
    const v = await view(m.at, 'r')
    expect(v).toMatchObject({ action: 'resume', refusal: null, restartRefusal: null, blockedBy: null })
    expect(v.unfinished.map((t: any) => t.id)).toEqual(['r/01', 'r/02', 'r/03'])
    expect(v.restart[0]).toBe('a restart of #r ends the unfinished work:')
    expect(await m.post('/api/subtree/build', { id: 'r' })).toMatchObject({ status: 409, body: { error: '#r has unfinished work: resume it, or restart it' } })
    m.close()
  })

  test('Resume starts the merge loop again over the same tickets, and archives nothing', async () => {
    const m = await withControls()
    const r = await m.post('/api/subtree/resume', { id: 'r' })
    expect(r).toMatchObject({ status: 200, body: { ok: true } })
    await until(() => existsSync(mark()))
    expect(readFileSync(mark(), 'utf8')).toBe('resume r\n')
    expect(board().plans.get('r')?.buildPid).toBe(r.body.pid)
    expect([...board().tickets.values()].some((t) => t.archived)).toBe(false)
    // While it runs, every start on r is refused, and the view names the blocking run.
    expect(await view(m.at, 'r')).toMatchObject({ blockedBy: 'r', refusal: 'a run is in progress on #r: see its plan card on the board' })
    expect((await m.post('/api/subtree/resume', { id: 'r' })).status).toBe(409)
    expect((await m.post('/api/subtree/restart', { id: 'r', confirm: true })).status).toBe(409)
    stopAll([r.body.pid])
    m.close()
  })

  test('a run in progress on an ancestor disables every start below it, and names that run', async () => {
    const m = await withControls()
    appendBoard('run.started', { run: 'billing', pid: process.pid }, { path: boardPath })
    const busy = 'a run is in progress on #billing: see its plan card on the board'
    expect(await view(m.at, 'r')).toMatchObject({ action: 'resume', blockedBy: 'billing', refusal: busy, restartRefusal: busy })
    expect(await m.post('/api/subtree/resume', { id: 'r' })).toMatchObject({ status: 409, body: { error: busy } })
    expect(await m.post('/api/subtree/restart', { id: 'r', confirm: true })).toMatchObject({ status: 409, body: { error: busy } })
    expect(await m.post('/api/ticket/trigger', { id: 'r/01' })).toMatchObject({ status: 409, body: { error: busy } })
    expect(board().tickets.get('r/01')!.column).toBe('ready')
    // A run on r does not block its parent: a descendant is not covered.
    appendBoard('run.ended', { run: 'billing', end: 'done' }, { path: boardPath })
    appendBoard('run.started', { run: 'r', pid: process.pid }, { path: boardPath })
    expect((await view(m.at, 'billing')).blockedBy).toBeNull()
    expect(existsSync(mark())).toBe(false)
    m.close()
  })

  test('a restart without the confirmation changes nothing; with it, it archives the unfinished work and plans again', async () => {
    const m = await withControls()
    appendBoard('ticket.moved', { id: 'r/01', to: 'done' }, { path: boardPath })
    const before = readBoard(boardPath).length
    const asked = await m.post('/api/subtree/restart', { id: 'r' })
    expect(asked.status).toBe(409)
    expect(asked.body.error).toContain('archive r/02, r/03')
    expect(readBoard(boardPath).length).toBe(before)
    const r = await m.post('/api/subtree/restart', { id: 'r', confirm: true })
    expect(r).toMatchObject({ status: 200, body: { ok: true, archived: ['r/02', 'r/03'] } })
    expect(['r/01', 'r/02', 'r/03'].map((id) => board().tickets.get(id)!.archived)).toEqual([false, true, true])
    await until(() => existsSync(mark()))
    expect(readFileSync(mark(), 'utf8')).toBe('build r\n')
    stopAll([r.body.pid])
    m.close()
  })
})

describe('POST /api/ticket/reorder', () => {
  test('appends the new ready order', async () => {
    expect((await post('/api/ticket/reorder', { ids: ['r/03', 'r/01'] })).status).toBe(200)
    const e = readBoard(boardPath).at(-1)!
    expect([e.type, e.actor, e.payload]).toEqual(['ticket.reordered', 'you', { ids: ['r/03', 'r/01'] }])
  })

  test('refuses an order that is not exactly the ready column', async () => {
    const r = await post('/api/ticket/reorder', { ids: ['r/03', 'r/02'] })
    expect(r.status).toBe(409)
    expect(readBoard(boardPath).length).toBe(3)
  })
})

describe('POST /api/ticket/archive', () => {
  test('archives a ready or blocked ticket', async () => {
    expect((await post('/api/ticket/archive', { id: 'r/02' })).status).toBe(200)
    expect(board().tickets.get('r/02')?.archived).toBe(true)
  })

  test('refuses a merging ticket and an unknown id', async () => {
    appendBoard('ticket.moved', { id: 'r/01', to: 'merging' }, { path: boardPath })
    expect((await post('/api/ticket/archive', { id: 'r/01' })).status).toBe(409)
    expect((await post('/api/ticket/archive', { id: 'r/99' })).status).toBe(404)
  })

  test('there is no stop route: a build ends only by archiving its ticket (#werk-board-control)', async () => {
    appendBoard('ticket.moved', { id: 'r/03', to: 'building' }, { path: boardPath })
    expect((await post('/api/ticket/stop', { id: 'r/03' })).status).toBe(404)
    expect(board().tickets.get('r/03')!.column).toBe('building')
  })
})

describe('trigger, and archive as the stop', () => {
  test('a trigger moves to building and spawns the build; the log streams; archive kills it and keeps it out of the columns', async () => {
    const r = await post('/api/ticket/trigger', { id: 'r/01' })
    expect(r.status).toBe(200)
    expect(board().tickets.get('r/01')?.column).toBe('building')
    expect(routes.children.has('r/01')).toBe(true)
    await until(() => !!board().tickets.get('r/01')?.live)

    const backfill = (await (await fetch(`${base}/api/ticket/log?id=r/01`)).json()) as any
    expect(backfill.lines[0]).toEqual({ text: 'hello from the stub' })

    routes.tail()
    await sleep(150)
    routes.tail()
    const logs = pushed.filter(([e]) => e === 'ticket-log')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0][1]).toMatchObject({ id: 'r/01' })
    expect(logs[0][1].lines.map((l: { text: string }) => l.text)).toContain('tick')

    // #werk-board-control-archive-ends-build: the archive writes the board and signals nothing.
    // The stub does not read the board, so it keeps running; a real builder loop ends itself.
    const pid = routes.children.get('r/01')!.pid!
    const s = await post('/api/ticket/archive', { id: 'r/01' })
    expect(s.body).toEqual({ ok: true })
    await sleep(200)
    expect(board().tickets.get('r/01')).toMatchObject({ column: 'building', archived: true, live: true })
    expect(alive(pid)).toBe(true)
    process.kill(-pid, 'SIGTERM')
    await until(() => board().tickets.get('r/01')?.lastEnd === 'stopped')
    await until(() => !routes.children.has('r/01'))
  })

  test('inside a live run, a trigger and an archive only write the board; once the run ends, a trigger starts one', async () => {
    // The test runner itself is a live process: it stands in for the holding `werk run`.
    appendBoard('run.started', { run: 'r', pid: process.pid }, { path: boardPath })
    const t = await post('/api/ticket/trigger', { id: 'r/01' })
    expect(t.body).toEqual({ ok: true, run: process.pid })
    expect(board().tickets.get('r/01')?.column).toBe('building')
    const s = await post('/api/ticket/archive', { id: 'r/01' })
    expect(s.body).toEqual({ ok: true })
    expect(board().tickets.get('r/01')?.archived).toBe(true)
    expect(routes.children.size).toBe(0)

    appendBoard('run.ended', { run: 'r', end: 'gate' }, { path: boardPath })
    await post('/api/ticket/trigger', { id: 'r/03' })
    expect(routes.children.has('r/03')).toBe(true)
    await until(() => !!board().tickets.get('r/03')?.live)
    await post('/api/ticket/archive', { id: 'r/03' })
    // The archive signals nothing; the stub stands for a build that has not read the board yet.
    await sleep(150)
    expect(routes.children.has('r/03')).toBe(true)
    process.kill(-routes.children.get('r/03')!.pid!, 'SIGTERM')
    await until(() => !routes.children.has('r/03'))
  })

  test('refuses to trigger a ticket that is already building, and spawns nothing', async () => {
    appendBoard('ticket.moved', { id: 'r/03', to: 'building' }, { path: boardPath })
    const r = await post('/api/ticket/trigger', { id: 'r/03' })
    expect([r.status, r.body.error]).toEqual([409, 'building → building is not a person\'s move'])
    expect(routes.children.size).toBe(0)
  })

  test('refuses to trigger a ticket with an open blocker', async () => {
    appendBoard('ticket.moved', { id: 'r/02', to: 'ready', reason: 'x' }, { path: boardPath })
    const r = await post('/api/ticket/trigger', { id: 'r/02' })
    expect([r.status, r.body.error]).toEqual([409, 'blocked by r/01'])
    expect(routes.children.size).toBe(0)
  })

  test('after a server restart, an archive still signals nothing: the build ends itself', async () => {
    await post('/api/ticket/trigger', { id: 'r/01' })
    await until(() => !!board().tickets.get('r/01')?.live)
    const pid = board().tickets.get('r/01')!.pid!
    // A second server over the same board: its in-memory map of children is empty.
    const restarted = await mount()
    const s = await restarted.post('/api/ticket/archive', { id: 'r/01' })
    expect(s.body).toEqual({ ok: true })
    await sleep(200)
    expect(alive(pid)).toBe(true)
    process.kill(-pid, 'SIGTERM')
    await until(() => !alive(pid))
    restarted.close()
  })

  test('a recorded pid that is no longer alive is not signalled; the ticket is still archived', async () => {
    const dead = Bun.spawn(['true'])
    await dead.exited
    appendBoard('ticket.moved', { id: 'r/03', to: 'building' }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/03', loopRun: 'L9', pid: dead.pid, group: true }, { path: boardPath })
    const s = await post('/api/ticket/archive', { id: 'r/03' })
    expect(s.body).toEqual({ ok: true })
    expect(board().tickets.get('r/03')!.archived).toBe(true)
  })

  test('a session with no end whose process is gone does not show as live, before any reap (#vi-board-session-file)', async () => {
    const dead = Bun.spawn(['true'])
    await dead.exited
    appendBoard('run.started', { run: 'r', pid: dead.pid }, { path: boardPath })
    for (const id of ['r/01', 'r/03']) appendBoard('ticket.moved', { id, to: 'building' }, { path: boardPath })
    // r/03 names its own dead process; r/01 runs under the dead merge loop.
    appendBoard('ticket.build.started', { id: 'r/03', loopRun: 'L9', pid: dead.pid, group: true }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/01', loopRun: 'L8' }, { path: boardPath })
    const data = (await (await fetch(base + '/api/board')).json()) as any
    const of = (id: string) => data.tickets.find((t: any) => t.id === id)
    expect([of('r/01').live, of('r/03').live, of('r/03').running]).toEqual([false, false, false])
    // The board log alone still says both run: nothing wrote an end.
    expect([board().tickets.get('r/01')!.live, board().tickets.get('r/03')!.live]).toEqual([true, true])
  })

  test('a session with no end whose process is alive shows as live (#vi-board-session-file)', async () => {
    appendBoard('ticket.moved', { id: 'r/03', to: 'building' }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/03', loopRun: 'L9', pid: process.pid, group: false }, { path: boardPath })
    const data = (await (await fetch(base + '/api/board')).json()) as any
    expect(data.tickets.find((t: any) => t.id === 'r/03')).toMatchObject({ live: true, running: true })
  })

  test('a build that dies without ending its session is ended as died and started again (#st-build-died)', async () => {
    // The first build dies after its start; the one the server starts again lives.
    const marker = join(dir, 'died-once')
    writeFileSync(join(dir, 'stub.ts'), STUB.replace("process.on('SIGTERM'", `if (!require('node:fs').existsSync(${JSON.stringify(marker)})) { writeFileSync(${JSON.stringify(marker)}, ''); process.exit(3) }\nprocess.on('SIGTERM'`))
    await post('/api/ticket/trigger', { id: 'r/03' })
    const starts = () => readBoard(boardPath).filter((e) => e.type === 'ticket.build.started')
    await until(() => starts().length === 2 && !!board().tickets.get('r/03')?.live)
    const ended = readBoard(boardPath).filter((e) => e.type === 'ticket.build.ended')
    expect(ended.map((e) => (e.payload as { result: string }).result)).toEqual(['died'])
    // The pass that died counts against the cap, and the ticket never left building.
    expect(board().tickets.get('r/03')).toMatchObject({ passes: 1, column: 'building' })
    await archiveAndStop('r/03')
  })

  test('at server start, a dead build is ended as died and started again; a live one is left alone (#st-build-died)', async () => {
    const dead = Bun.spawn(['true'])
    await dead.exited
    for (const id of ['r/01', 'r/03']) appendBoard('ticket.moved', { id, to: 'building' }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/03', loopRun: 'L9', pid: dead.pid, group: true }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/01', loopRun: 'L8', pid: process.pid, group: false }, { path: boardPath })
    const stop = routes.start()
    expect(board().tickets.get('r/03')).toMatchObject({ lastEnd: 'died', live: false, column: 'building' })
    expect(board().tickets.get('r/01')).toMatchObject({ live: true, pid: process.pid })
    expect(routes.children.has('r/03')).toBe(true)
    await until(() => board().tickets.get('r/03')?.loopRun === 'L1')
    // A second look finds nothing new to end.
    routes.reap()
    expect(readBoard(boardPath).filter((e) => e.type === 'ticket.build.ended')).toHaveLength(1)
    stop()
    await archiveAndStop('r/03')
  })

  test('a build under a merge loop that died is found by the run process, and the run starts once (#st-build-died)', async () => {
    const dead = Bun.spawn(['true'])
    await dead.exited
    appendBoard('run.started', { run: 'r', pid: dead.pid }, { path: boardPath })
    for (const id of ['r/01', 'r/03']) {
      appendBoard('ticket.moved', { id, to: 'building' }, { path: boardPath })
      appendBoard('ticket.build.started', { id, loopRun: `L-${id}` }, { path: boardPath })
    }
    routes.reap()
    expect(['r/01', 'r/03'].map((id) => board().tickets.get(id)!.lastEnd)).toEqual(['died', 'died'])
    expect([...routes.children.keys()]).toEqual(['r/01'])
    await until(() => !!board().tickets.get('r/01')?.live)
    await archiveAndStop('r/01')
  })

  test('a build that refuses the ticket sends it back to ready with what it said', async () => {
    writeFileSync(join(dir, 'stub.ts'), "console.error('building r/03, cap 5...')\nconsole.log('{}')\nconsole.error('werk: no ticket file at r/03.md')\nprocess.exit(1)\n")
    await post('/api/ticket/trigger', { id: 'r/03' })
    await until(() => board().tickets.get('r/03')?.column === 'ready')
    const e = readBoard(boardPath).at(-1)!
    expect([e.type, e.actor]).toEqual(['ticket.moved', 'agent'])
    expect(e.payload).toEqual({ id: 'r/03', to: 'ready', reason: 'the build refused: building r/03, cap 5... / werk: no ticket file at r/03.md' })
    expect(board().tickets.get('r/03')).toMatchObject({ live: false, reason: expect.stringContaining('no ticket file') })
    // A new trigger starts a new attempt: the old refusal no longer shows.
    writeFileSync(join(dir, 'stub.ts'), STUB)
    await post('/api/ticket/trigger', { id: 'r/03' })
    expect(board().tickets.get('r/03')!.reason).toBeUndefined()
    await until(() => !!board().tickets.get('r/03')?.live)
    await archiveAndStop('r/03')
  })

  test('a silent refusal says how the build exited, from stdout when stderr is empty', async () => {
    writeFileSync(join(dir, 'stub.ts'), 'process.exit(2)\n')
    await post('/api/ticket/trigger', { id: 'r/03' })
    await until(() => board().tickets.get('r/03')?.column === 'ready')
    expect(board().tickets.get('r/03')!.reason).toBe('the build exited with 2 before it started')
    writeFileSync(join(dir, 'stub.ts'), "console.log('only stdout')\nprocess.exit(1)\n")
    await post('/api/ticket/trigger', { id: 'r/03' })
    await until(() => board().tickets.get('r/03')?.reason === 'the build refused: only stdout')
  })

  test('a build that cannot be spawned is ended and sent back to ready', async () => {
    const r2 = await mountWith({ buildCommand: () => [join(dir, 'no-such-binary')] })
    await r2.post('/api/ticket/trigger', { id: 'r/03' })
    await until(() => board().tickets.get('r/03')?.column === 'ready')
    const t = board().tickets.get('r/03')!
    expect(t.lastEnd).toBe('error')
    expect(t.reason).toStartWith('the build did not start: ')
    // One move back, not one per child event.
    expect(readBoard(boardPath).filter((e) => e.type === 'ticket.moved' && (e.payload as { to: string }).to === 'ready')).toHaveLength(1)
    r2.close()
  })
})

describe('the live log: backfill and push meet at a byte offset', () => {
  const line = (text: string) => JSON.stringify({ text }) + '\n'
  function liveLog() {
    const path = join(dir, 'live.jsonl')
    writeFileSync(path, '')
    appendBoard('ticket.moved', { id: 'r/03', to: 'building' }, { path: boardPath })
    appendBoard('ticket.build.started', { id: 'r/03', loopRun: 'L1', log: path }, { path: boardPath })
    return path
  }
  const logs = () => pushed.filter(([e]) => e === 'ticket-log').map(([, d]) => d)
  const backfill = async () => (await (await fetch(`${base}/api/ticket/log?id=r/03`)).json()) as any

  test('a line both the backfill and the push carry is taken once, and the next one is taken', async () => {
    const path = liveLog()
    appendFileSync(path, line('a'))
    routes.tail() // the tail first sees the file: it starts after "a", and pushes nothing
    expect(logs()).toEqual([])
    appendFileSync(path, line('é b'))
    // The drawer opens now: its backfill already holds "é b".
    const back = await backfill()
    expect(back).toMatchObject({ lines: [{ text: 'a' }, { text: 'é b' }], offset: statSync(path).size })
    routes.tail()
    const first = logs()[0]
    expect(first).toEqual({ id: 'r/03', from: Buffer.byteLength(line('a')), reset: false, lines: [{ text: 'é b', end: statSync(path).size }] })
    // The seam: the pushed line is at or below the backfill's offset, so it is dropped.
    expect(takeLogPush(back.offset, first)).toEqual({ reload: false, lines: [], offset: back.offset })
    appendFileSync(path, line('c'))
    routes.tail()
    expect(takeLogPush(back.offset, logs()[1])).toEqual({ reload: false, lines: [{ text: 'c' }], offset: statSync(path).size })
  })

  test('a line that carries a time keeps it, in the backfill and in the push', async () => {
    const path = liveLog()
    const at = '2026-10-19T02:13:03.159Z'
    const msg = (text: string) => JSON.stringify({ type: 'assistant', timestamp: at, message: { content: text } }) + '\n'
    appendFileSync(path, msg('one'))
    routes.tail()
    expect((await backfill()).lines).toEqual([{ text: 'one', at }])
    appendFileSync(path, msg('two') + line('no time'))
    routes.tail()
    const push = logs().at(-1)
    expect(takeLogPush(push.from, push).lines).toEqual([{ text: 'two', at }, { text: 'no time' }])
  })

  test('a push that starts past what the preview holds is a gap: the preview fetches again', () => {
    expect(takeLogPush(10, { from: 20, lines: [{ text: 'x', end: 30 }] })).toEqual({ reload: true, lines: [], offset: 10 })
    expect(takeLogPush(10, { from: 0, reset: true, lines: [] })).toMatchObject({ reload: true })
    expect(takeLogPush(10, { from: 5, lines: [{ text: 'old', end: 10 }, { text: 'new', end: 18 }] })).toEqual({ reload: false, lines: [{ text: 'new' }], offset: 18 })
  })

  test('the drawer counter reads seconds, then minutes, hours, days', () => {
    const t0 = Date.parse('2026-10-19T10:00:00Z')
    const at = (s: number) => elapsed('2026-10-19T10:00:00Z', t0 + s * 1000)
    expect([at(-5), at(4), at(724), at(3 * 3600 + 7 * 60), at(2 * 86400 + 5 * 3600)]).toEqual(['0s', '4s', '12m 04s', '3h 07m', '2d 5h'])
  })

  test('a done ticket shows a grey not-run badge apart from the red held-out badge (#st-heldout-notrun)', () => {
    const done = { column: 'done', heldOutRed: false, heldOutNotRun: ['01.1 x: timed out'] }
    expect(heldoutBadges(done)).toContain('class="tb tb-notrun"')
    expect(heldoutBadges(done)).not.toContain('tb-heldout')
    const both = heldoutBadges({ column: 'done', heldOutRed: true, followUp: 'r/09', heldOutNotRun: ['01.1 x: y'] })
    expect(both).toContain('tb-heldout')
    expect(both).toContain('tb-notrun')
    expect(heldoutBadges({ column: 'done', heldOutRed: true, heldOutNotRun: [] })).not.toContain('tb-notrun')
    // Only a done ticket carries either.
    expect(heldoutBadges({ ...done, column: 'ready' })).toBe('')
  })

  test("the trigger's merge loop names no repository: the run reads the project's target (#st-build-target)", () => {
    appendBoard('project.target', { repo: '/target' }, { path: boardPath })
    expect(runCommand(foldBoard(readBoard(boardPath)), 'r/01').slice(2)).toEqual(['run', 'r'])
  })

  test('a half-written last line waits for its newline', () => {
    const path = join(dir, 'half.jsonl')
    writeFileSync(path, 'one\ntw')
    expect(readFrom(path, 0)).toEqual({ lines: [{ raw: 'one', end: 4 }], offset: 4, reset: false })
    expect(readFrom(path, 4)).toEqual({ lines: [], offset: 4, reset: false })
    appendFileSync(path, 'o\n')
    expect(readFrom(path, 4)).toEqual({ lines: [{ raw: 'two', end: 8 }], offset: 8, reset: false })
  })

  test('a truncated log starts again from zero, and the push says so', async () => {
    const path = liveLog()
    appendFileSync(path, line('a') + line('b'))
    routes.tail()
    writeFileSync(path, line('z'))
    expect(readFrom(path, 100)).toEqual({ lines: [{ raw: line('z').trim(), end: line('z').length }], offset: line('z').length, reset: true })
    routes.tail()
    expect(logs()).toEqual([{ id: 'r/03', from: 0, reset: true, lines: [{ text: 'z', end: line('z').length }] }])
    expect((await backfill()).offset).toBe(line('z').length)
  })
})

test('an id that is not "<run>/<number>" is refused before any lookup or file read', async () => {
  for (const id of ['../x/01', 'r/../../etc/passwd', '../../etc/passwd', 'nope', '', 7, null]) {
    const r = await post('/api/ticket/trigger', { id })
    expect([r.status, r.body.ok]).toEqual([400, false])
    expect(r.body.error).toStartWith('not a ticket id')
  }
  expect((await fetch(`${base}/api/ticket/log?id=${encodeURIComponent('../r/01')}`)).status).toBe(400)
  expect(readBoard(boardPath)).toHaveLength(3)
})

test('a POST body that is not JSON is a 400 with a JSON error, and writes nothing', async () => {
  const r = await fetch(base + '/api/ticket/trigger', { method: 'POST', body: '{"id": r/01' })
  expect(r.status).toBe(400)
  expect(r.headers.get('content-type')).toContain('application/json')
  expect(await r.json()).toMatchObject({ ok: false, error: expect.any(String) })
  expect(readBoard(boardPath)).toHaveLength(3)
})

test('a burst of changes to board.jsonl or the tickets folder pushes one `board` event', async () => {
  const stop = routes.start()
  try {
    await sleep(100) // fs.watch is armed
    pushed.length = 0
    appendBoard('ticket.reordered', { ids: ['r/03', 'r/01'] }, { path: boardPath })
    appendBoard('ticket.reordered', { ids: ['r/01', 'r/03'] }, { path: boardPath })
    writeFileSync(join(dir, 'tickets', 'r', '03.md'), 'title: Three again\n\nx\n')
    await until(() => pushed.some(([e]) => e === 'board'))
    await sleep(200)
    expect(pushed.filter(([e]) => e === 'board')).toEqual([['board', 1]])
    // A file beside board.jsonl that is not it pushes nothing.
    pushed.length = 0
    writeFileSync(join(dir, 'other.jsonl'), 'x\n')
    await sleep(250)
    expect(pushed.filter(([e]) => e === 'board')).toEqual([])
  } finally {
    stop()
  }
})

test('an append to board.jsonl pushes `board` from the poll alone, with no watcher', async () => {
  routes.poll() // the first call only records the file
  pushed.length = 0
  routes.poll()
  await sleep(120)
  expect(pushed.filter(([e]) => e === 'board')).toEqual([])
  appendBoard('ticket.reordered', { ids: ['r/03', 'r/01'] }, { path: boardPath })
  routes.poll()
  await until(() => pushed.some(([e]) => e === 'board'))
  expect(pushed.filter(([e]) => e === 'board')).toEqual([['board', 1]])
})

test('an unknown ticket route is a 404', async () => {
  expect((await post('/api/ticket/nope', {})).status).toBe(404)
})
