/** Held-out steps 85.x (overseer), 86.x (held-out set and G2), 87.x (merge loop), 88.x (scheduling). */
import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

const werk = () => join(p.dir, '.werk')
const board = () => join(werk(), 'board.jsonl')
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()

const ticketOf = (number: number, fields: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...fields,
})

function appendBoard(...events: NewBoardEvent[]) {
  for (const e of events) appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
}

/** A project with a Makefile check, a decided subtree root/loop, and the tickets planned in ready. */
function project(makefile: string, tickets: TicketFields[], files: Record<string, string> = {}) {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  for (const [f, c] of Object.entries(files)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '.'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(werk(), 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk(), 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  appendBoard(...tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
}

const GREEN_MAKEFILE = 'check:\n\t@true\n'
const result = (object: unknown = {}): FakeStep => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
const reply = (object: unknown): FakeReply => ({ steps: [result(object)] })
const writes = (path: string, content = `${path}\n`, before: FakeStep[] = []): FakeReply => ({ steps: [...before, { edit: { path, content } }, result()] })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop', '#root'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const STEP = (n: number) => `Given the product is installed\nWhen the user opens feature ${n}\nThen the user sees STEP-MARK-${n}`
const author = (n = 1): FakeReply => reply({ steps: Array.from({ length: n }, (_, i) => ({ text: STEP(i + 1) })) })
/** A binder that binds each named step id to a command. */
const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
const allGreen = (tickets: number[]) => binder(Object.fromEntries(tickets.map((n) => [`${n}.1`, 'true'])))

const events = () => readLog<BoardEvent>(board())
const columnOf = (number: number, upTo = events()) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === number))?.name
const movesOf = (number: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === number ? [e.payload.to] : []))
const moveAt = (number: number, to: string) => events().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === number && e.payload.to === to)
const prefixes = () => events().map((_, i, all) => all.slice(0, i + 1))
const runRecord = () => {
  const runs = join(werk(), 'runs')
  return readdirSync(runs)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(runs, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
}
const promptsOf = (role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => {
    const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
    return roles[i] === role && user ? [user.message.content] : []
  })
}
const launchesOf = (role: string) => p.agentRoles().filter((r) => r === role).length
async function until(what: string, ok: () => boolean, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(25)) if (ok()) return
  throw new Error(`timed out waiting for ${what}`)
}
function startWerk(args: string[]) {
  const child = Bun.spawn([process.execPath, MAIN, ...args], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  return Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([code, stdout, stderr]) => ({ code, stdout, stderr }))
}

// ---------------------------------------------------------------- 85: the overseer

const toolUse = (id: string, command: string): FakeStep => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, isError = false): FakeStep => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'make: *** [check] Error 1' : 'ok', is_error: isError }] } },
})
const DONE_MAKEFILE = 'check:\n\t@test -f done.txt\n'

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  project(DONE_MAKEFILE, [ticketOf(3)])
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch done.txt' } } }, { edit: { path: 'done.txt', content: 'done\n' } }, result()] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking], 'heldout-author': author() } })
  const r = p.werk(['build', '3'])
  const record = runRecord()
  expect(record[0].overseer).toEqual([expect.objectContaining({ act: 'answered', requestId: 'ask-1' })])
  const builder = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builder]).toContainEqual(expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }))
  expect(record[0].agentExit).toBe(0)
  expect(record).toHaveLength(1)
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  project(DONE_MAKEFILE, [ticketOf(3)])
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  const normal: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result()] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, normal], 'heldout-author': author() } })
  // "a few milliseconds"
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const record = runRecord()
  expect(record[0].agentCancelled).toBe('silence')
  expect(record.map((l) => l.pass)).toEqual([1, 2])
  expect(record[1].agentCancelled).toBeNull()
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(git('log', '--format=%s', '-1', branch)).toBe('werk build 3: pass 2')
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  project(DONE_MAKEFILE, [ticketOf(3)])
  const loopSteps: FakeStep[] = []
  for (let i = 0; i < 20; i++) loopSteps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true), { sleep: 100 })
  const looping: FakeReply = { steps: [...loopSteps, { sleep: 20_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier, 'heldout-author': author() } })
  p.werk(['build', '3', '--cap', '1', '--loop-every', '10'])
  const acts = runRecord()[0].overseer.map((a: { act: string; reason?: string }) => (a.reason ? `${a.act}:${a.reason}` : a.act))
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warned = acts.indexOf('warned')
  const cancelled = acts.findIndex((a: string) => a.startsWith('cancelled'))
  expect(cancelled).toBeGreaterThan(warned)
  expect(acts[cancelled]).toBe('cancelled:loop')
  expect(acts.slice(0, warned).some((a: string) => a.startsWith('cancelled'))).toBe(false)
  const builder = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builder]!.filter((m) => JSON.stringify(m).includes('werk overseer: you repeat'))).toHaveLength(1)
}, 60_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  project(DONE_MAKEFILE, [ticketOf(3)])
  // Silence limit of a few ms; the tool call runs for many times that.
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1500 }, toolResult('t1'), { edit: { path: 'done.txt', content: 'done\n' } }, result()] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool], 'heldout-author': author() } })
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const record = runRecord()
  expect(record.filter((l) => l.agentCancelled === 'silence')).toEqual([])
  expect(record).toHaveLength(1)
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

// ---------------------------------------------------------------- 86: the held-out set

const FEATURE_MAKEFILE = 'check:\n\t@echo red; exit 1\n'
function commitFeature(text: string) {
  writeFileSync(join(p.dir, 'feature.txt'), `${text}\n`)
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', `feature: ${text}`])
}
const HELD_TEST = 'grep -q works feature.txt # HELD-TEST-CODE\n'
const featureBinder: FakeReply = {
  steps: [{ edit: { path: '.werk-heldout/3.1.sh', content: HELD_TEST } }, ...reply({ steps: [{ id: '3.1', cmd: 'sh .werk-heldout/3.1.sh' }, { id: '3.2', cmd: 'true' }] }).steps],
}
const store = () => join(werk(), 'heldout', 'root')

/** Ticket 3 builds one red pass so its author writes the steps, then is marked done (planned and merged). */
function heldoutProject(tickets = [3]) {
  project(FEATURE_MAKEFILE, tickets.map((n) => ticketOf(n)), { 'feature.txt': 'works\n' })
  p.scriptAgent({ steps: [], roles: { builder: [writes('work.txt')], 'heldout-author': author(2), 'heldout-binder': featureBinder } })
  expect(p.werk(['build', '3', '--cap', '1']).code).toBe(1)
  appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'done' } })
}

test('86.1 the builder never sees the held-out steps', async () => {
  project(FEATURE_MAKEFILE, [ticketOf(3)], { 'feature.txt': 'works\n' })
  const go = join(p.dir, '..', 'go-builder')
  p.scriptAgent({
    steps: [],
    roles: { builder: [writes('work.txt', 'x\n', [{ waitFor: go }])], 'heldout-author': author(2), 'heldout-binder': featureBinder },
  })
  const build = startWerk(['build', '3', '--cap', '1'])
  // While the builder works, the step author has started too.
  await until('the builder', () => launchesOf('builder') === 1)
  await until('the step author', () => launchesOf('heldout-author') === 1, 5_000)
  writeFileSync(go, '')
  const r = await build
  appendBoard({ type: 'ticket.moved', payload: { number: 3, to: 'done' } })
  // A binder turns the steps into tests.
  p.werk(['heldout', 'root'])
  expect(launchesOf('heldout-binder')).toBe(1)
  // The steps and the tests are outside the builder's worktree.
  expect(readFileSync(join(store(), 'steps-3.json'), 'utf8')).toContain('STEP-MARK-1')
  expect(readFileSync(join(store(), 'tests', '3.1.sh'), 'utf8')).toBe(HELD_TEST)
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)![0]
  expect(p.run(['git', 'grep', '-q', 'STEP-MARK', branch]).code).toBe(1)
  expect(promptsOf('builder').length).toBeGreaterThan(0)
  for (const prompt of promptsOf('builder')) expect(prompt).not.toContain('STEP-MARK')
}, 60_000)

test('86.2 a held-out run on a broken tree reports the red step', () => {
  heldoutProject()
  commitFeature('broken')
  const r = p.werk(['heldout', 'root'])
  expect(r.stdout).toContain('red 3.1')
  expect(r.stdout).toContain('green 3.2')
  expect(r.code).not.toBe(0)
}, 60_000)

test('86.3 the builder gets the failed step text, not the test', () => {
  heldoutProject([3, 4])
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  p.werk(['build', '4', '--cap', '1'])
  const prompt = promptsOf('builder').at(-1)!
  expect(prompt).toContain(STEP(1))
  expect(prompt).not.toContain('HELD-TEST-CODE')
  expect(prompt).not.toContain('grep -q works')
  expect(prompt).not.toContain('STEP-MARK-2')
}, 60_000)

test('86.4 the gate refuses G2 while a held-out step is red', () => {
  heldoutProject()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  const gate = p.werk(['gate', 'root'])
  expect(gate.code).not.toBe(0)
  expect(gate.stdout + gate.stderr).toContain('3.1')
  expect(events().filter((e) => e.type === 'gate.opened')).toEqual([])
}, 60_000)

test('86.5 G2 opens after the red step turns green', () => {
  heldoutProject()
  commitFeature('broken')
  expect(p.werk(['heldout', 'root']).code).toBe(1)
  expect(p.werk(['gate', 'root']).code).toBe(1)
  commitFeature('works')
  const again = p.werk(['heldout', 'root'])
  expect(again.code).toBe(0)
  expect(again.stdout).toContain('every held-out step is green')
  const gate = p.werk(['gate', 'root'])
  expect(gate.code).toBe(0)
  expect(events().filter((e) => e.type === 'gate.opened')).toEqual([
    expect.objectContaining({ payload: { gate: 'G2', root: 'root', commit: git('rev-parse', 'main') } }),
  ])
}, 60_000)

// ---------------------------------------------------------------- 87: the merge loop

const branches = () => git('branch', '--format=%(refname:short)').split('\n')

test('87.1 two green tickets merge onto the main line one after the other', () => {
  project(GREEN_MAKEFILE, [ticketOf(1), ticketOf(2)])
  const before = branches()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2]) } })
  const r = p.werk(['run', 'root'])
  expect(movesOf(1)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(2)).toEqual(['building', 'merging', 'done'])
  const merges = git('log', '--first-parent', '--format=%s', 'main').split('\n').filter((s) => s.startsWith('werk: merge'))
  expect(merges.map((s) => s.split(' (')[0])).toEqual(['werk: merge ticket 2', 'werk: merge ticket 1'])
  const ticketBranches = events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.branch ? [e.payload.branch] : []))
  expect(branches().toSorted()).toEqual([...before, ...ticketBranches].toSorted())
  expect(foldBoard(events()).columns.flatMap((c) => c.tickets).every((t) => t.followUps.length === 0)).toBe(true)
  expect(r.code).toBe(0)
}, 90_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  project(GREEN_MAKEFILE, [ticketOf(1, { touches: ['notes'] })], { 'notes.txt': 'notes\n' })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket one\n')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2]) } })
  p.werk(['run', 'root'])
  expect(columnOf(1)).toBe('done')
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('ticket one\n')

  writeFileSync(join(p.dir, 'notes.txt'), 'my own edit\n')
  const tip = git('rev-parse', 'main')
  appendBoard({ type: 'ticket.planned', payload: ticketOf(2, { touches: ['notes'] }) })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket two\n')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2]) } })
  p.werk(['run', 'root'])
  expect(movesOf(2)).toContain('merging')
  expect(columnOf(2)).not.toBe('done')
  expect(git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 90_000)

test('87.5 G2 opens after the last merge with all held-out steps green and opens again after a later merge', () => {
  project(GREEN_MAKEFILE, [ticketOf(1, { touches: ['same'] }), ticketOf(2, { touches: ['same'] })])
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2]) } })
  p.werk(['run', 'root'])
  const all = events()
  const firstDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'done')
  const secondDone = all.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'done')
  expect(firstDone).toBeGreaterThan(-1)
  expect(all.slice(0, secondDone).filter((e) => e.type === 'gate.opened')).toEqual([])
  const tip1 = git('rev-parse', 'main')
  expect(all.filter((e) => e.type === 'gate.opened').map((e) => (e as { payload: { commit: string } }).payload.commit)).toEqual([tip1])


  appendBoard({ type: 'ticket.planned', payload: ticketOf(3) })
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author(), 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true', '3.1': 'true' }) },
  })
  p.werk(['run', 'root'])
  const tip2 = git('rev-parse', 'main')
  expect(tip2).not.toBe(tip1)
  expect(events().filter((e) => e.type === 'gate.opened').map((e) => (e as { payload: { commit: string } }).payload.commit)).toEqual([tip1, tip2])
  // Checked last. The person approves G2: werk names no verb or control for that.
  const help = p.werk(['help']).stdout
  expect(help).toMatch(/approve/i)
}, 120_000)

// ---------------------------------------------------------------- 88: scheduling

test('88.1 nothing builds before the person starts the run', async () => {
  project(GREEN_MAKEFILE, [ticketOf(1), ticketOf(2), ticketOf(3)])
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2, 3]) },
  })
  // The person opens the board and waits.
  await Bun.sleep(2_000)
  for (const n of [1, 2, 3]) expect(columnOf(n)).toBe('ready')
  expect(foldBoard(events()).columns.find((c) => c.name === 'building')!.tickets).toEqual([])
  const run = startWerk(['run', 'root'])
  await until('the tickets in building', () => events().some((e) => e.type === 'ticket.moved' && e.payload.to === 'building'))
  await run
  for (const n of [1, 2, 3]) expect(movesOf(n)[0]).toBe('building')
}, 90_000)

const GO = () => join(p.dir, '..', 'go')
const held = (path: string): FakeReply => writes(path, `${path}\n`, [{ waitFor: GO() }])

test('88.2 four unblocked tickets with distinct modules build three at a time', async () => {
  project(GREEN_MAKEFILE, [1, 2, 3, 4].map((n) => ticketOf(n)))
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [held('t1.txt'), held('t2.txt'), held('t3.txt'), writes('t4.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2, 3, 4]) },
  })
  const run = startWerk(['run', 'root', '--poll-every', '50'])
  await until('three builders', () => launchesOf('builder') === 3)
  const building = foldBoard(events()).columns.find((c) => c.name === 'building')!.tickets.map((t) => t.number)
  expect(building.toSorted()).toEqual([1, 2, 3])
  expect(columnOf(4)).toBe('ready')
  writeFileSync(GO(), '')
  const r = await run
  const fourth = moveAt(4, 'building')
  const doneBefore = [1, 2, 3].filter((n) => moveAt(n, 'done') > -1 && moveAt(n, 'done') < fourth)
  expect(doneBefore.length).toBeGreaterThan(0)
  const base = /building 4 Ticket 4 on werk-build\/\S+, from main at (\w+)/.exec(r.stdout)?.[1]
  expect(base).toBeDefined()
  const merged = git('log', '--format=%s', base!)
  for (const n of doneBefore) expect(merged).toContain(`werk: merge ticket ${n} `)
}, 120_000)

test('88.3 two tickets that touch a common module never build at the same time', async () => {
  project(GREEN_MAKEFILE, [ticketOf(1, { touches: ['decision log'] }), ticketOf(2, { touches: ['decision log'] }), ticketOf(3, { touches: ['map view'] })])
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [held('t1.txt'), held('t3.txt'), writes('t2.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2, 3]) },
  })
  const run = startWerk(['run', 'root', '--poll-every', '50'])
  await until('two builders', () => launchesOf('builder') === 2)
  const building = foldBoard(events()).columns.find((c) => c.name === 'building')!.tickets.map((t) => t.number)
  expect(building).toContain(3)
  expect(building.filter((n) => n === 1 || n === 2)).toHaveLength(1)
  const first = building.find((n) => n !== 3)!
  const other = first === 1 ? 2 : 1
  expect(columnOf(other)).toBe('ready')
  writeFileSync(GO(), '')
  await run
  expect(moveAt(other, 'building')).toBeGreaterThan(moveAt(first, 'done'))
  for (const prefix of prefixes()) expect(columnOf(1, prefix) === 'building' && columnOf(2, prefix) === 'building').toBe(false)
}, 120_000)

test('88.4 a ticket waits until its blocker is merged', async () => {
  project(GREEN_MAKEFILE, [ticketOf(1), ticketOf(2, { blockedBy: [1] })])
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2]) } })
  await startWerk(['run', 'root'])
  expect(moveAt(1, 'building')).toBeGreaterThan(-1)
  for (const prefix of prefixes()) {
    const one = columnOf(1, prefix)
    if (one === 'building' || one === 'merging') expect(columnOf(2, prefix)).not.toBe('building')
  }
  expect(moveAt(2, 'building')).toBeGreaterThan(moveAt(1, 'done'))
}, 120_000)

test('88.5 the merge queue merges one ticket at a time while three build', async () => {
  project(GREEN_MAKEFILE, [1, 2, 3].map((n) => ticketOf(n)))
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t1.txt'), writes('t2.txt'), writes('t3.txt')], 'heldout-author': author(), 'heldout-binder': allGreen([1, 2, 3]) } })
  await startWerk(['run', 'root'])
  for (const prefix of prefixes()) {
    const merging = foldBoard(prefix).columns.find((c) => c.name === 'merging')!.tickets
    expect(merging.length).toBeLessThanOrEqual(1)
  }
  for (const n of [1, 2, 3]) expect(columnOf(n)).toBe('done')
}, 120_000)

void existsSync
