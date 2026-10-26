/** Held-out steps 82.x (plan) and 83.x (build), run against the werk CLI with the fake agent. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard, type Board } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { Event } from '../src/map/events.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
const PLAN = '.werk/plans/auth'

let p: Project
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).toReversed()) await c()
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

// ---------- shared helpers ----------

const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = (): Board => foldBoard(boardLog())
const columnOf = (b: Board, title: string) => b.columns.find((c) => c.tickets.some((t) => t.title === title))?.name
const allTitles = (b: Board) => b.columns.flatMap((c) => c.tickets.map((t) => t.title))

/** Starts `werk serve --port 0` in the project and gives its base URL. */
async function serve(): Promise<string> {
  const proc = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  cleanups.push(async () => {
    proc.kill('SIGKILL')
    await proc.exited
  })
  let out = ''
  for await (const chunk of proc.stdout) {
    out += new TextDecoder().decode(chunk)
    const m = out.match(/http:\/\/\S+\//)
    if (m) return m[0]
  }
  throw new Error(`werk serve printed no address: ${out}`)
}

// ---------- plan (82.x) ----------

/** A map with the decided subtree under "auth": auth-session and auth-token are decided children. */
function planProject(extra: Parameters<typeof logOf> = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    accepted('auth'),
    proposed('auth-session', { status: 'decided', parent: 'auth', title: 'A session lasts a day' }),
    accepted('auth-session'),
    proposed('auth-token', { status: 'decided', parent: 'auth', title: 'Tokens are opaque' }),
    accepted('auth-token'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

const SPEC = [
  '# Spec: log in and out',
  '',
  '## User Stories',
  '',
  '1. As a person, I want to log in, so that I see my work.',
  '2. As a person, I want to log out, so that nobody else uses my session.',
  '',
].join('\n')

type T = { title: string; cites: string; blockedBy?: string; stories?: string | null; touches?: string; noAcceptance?: boolean }
function ticketText(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? ''}`]),
    `touches: ${t.touches ?? 'auth module'}`,
    '',
    '## What to build',
    '',
    `Build ${t.title}.`,
    '',
    '## Acceptance criteria',
    '',
    ...(t.noAcceptance ? ['Nothing listed.'] : [`- [ ] ${t.title} works.`]),
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

const LOGIN: T = { title: 'login', cites: 'auth, auth-session', stories: '1' }
const LOGOUT: T = { title: 'logout', cites: 'auth, auth-token', stories: '2' }

type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

function writers(tickets: Record<string, string>, answers: { spec?: unknown[]; tickets?: unknown[] } = {}) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': {
        steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))],
      },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
}

test('82.1 a plan over a decided subtree records a feature run, writes a spec and tickets, and puts the answers on the map as proposals', async () => {
  planProject()
  const ttl: Answer = { slug: 'token-ttl', title: 'A token lives one hour', why: 'How long does a token live?', body: 'One hour, then a refresh.' }
  const split: Answer = { slug: 'split-login', title: 'Login and logout are two tickets', why: 'Is logout its own ticket?', body: 'Yes, two tickets.' }
  writers({ '01-login.md': ticketText(LOGIN), '02-logout.md': ticketText(LOGOUT) }, { spec: [ttl], tickets: [split] })
  const r = p.werk(['plan', 'auth'])

  // Then the first event of the run in the log is a tier event with the tier "feature"
  const [first] = boardLog()
  expect(first).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature', root: 'auth' } })

  // And the board shows the two tickets (through the server's /api/board)
  const url = await serve()
  const apiBoard = (await (await fetch(`${url}api/board`)).json()) as Board
  expect(allTitles(apiBoard).toSorted()).toEqual(['login', 'logout'])

  // And the map shows ghost cards that refine "#auth", with the agent as the one who decides
  for (const a of [ttl, split]) {
    const show = p.werk(['show', `auth-${a.slug}`])
    expect(show.code).toBe(0)
    const lines = show.stdout.split('\n')
    expect(lines).toContain('state: ghost (proposed, not accepted)')
    expect(lines).toContain('parent: #auth')
    // werk's who field: "you" is the person, "me" is the agent (answers.ts: "with the agent as the one who decides").
    expect(lines).toContain('who: me')
    // And each ghost shows the title, the why and the body from its record
    expect(lines[0]).toBe(`#auth-${a.slug}  ${a.title}`)
    expect(lines).toContain(`why: ${a.why}`)
    expect(lines).toContain(a.body)
  }

  // And the person can accept each ghost one at a time with the ✓ button (POST /api/accept/<id>)
  const ac1 = await fetch(`${url}api/accept/auth-token-ttl`, { method: 'POST' })
  expect(ac1.status).toBe(200)
  expect(p.werk(['show', 'auth-token-ttl']).stdout).toContain('state: real')
  expect(p.werk(['show', 'auth-split-login']).stdout).toContain('state: ghost (proposed, not accepted)')
  const ac2 = await fetch(`${url}api/accept/auth-split-login`, { method: 'POST' })
  expect(ac2.status).toBe(200)
  expect(p.werk(['show', 'auth-split-login']).stdout).toContain('state: real')
  expect(r.code).toBe(0)
}, 60_000)

test('82.2 a plan stops with an error when an answer record has an id that is already in the map', () => {
  planProject([proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'Token lifetime' }), accepted('auth-token-ttl')])
  const ttl: Answer = { slug: 'token-ttl', title: 'A token lives one hour', why: 'How long does a token live?', body: 'One hour.' }
  writers({ '01-login.md': ticketText(LOGIN), '02-logout.md': ticketText(LOGOUT) }, { spec: [ttl] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  planProject()
  writers({ '01-login.md': ticketText({ ...LOGIN, stories: null }), '02-logout.md': ticketText(LOGOUT) })
  const r = p.werk(['plan', 'auth'])
  const out = r.stdout + r.stderr
  const b = board()
  expect(allTitles(b)).toContain('logout')
  expect(allTitles(b)).not.toContain('login')
  expect(out.split('\n').some((l) => l.includes('login') && l.includes('stories') && /missing/.test(l))).toBe(true)
  expect(out.split('\n').some((l) => l.includes('#auth-session') && /no ticket cites/.test(l))).toBe(true)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  planProject()
  writers({
    '01-a.md': ticketText({ title: 'a', cites: 'auth, auth-session', stories: '1', noAcceptance: true }),
    '02-b.md': ticketText({ title: 'b', cites: 'auth, auth-token', stories: '2' }),
    '03-c.md': ticketText({ title: 'c', cites: 'auth', stories: '1', blockedBy: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  expect(r.stdout).toContain('01-a.md: acceptance')
  const b = board()
  expect(allTitles(b)).not.toContain('a')
  expect(columnOf(b, 'c')).toBe('blocked')
  expect(columnOf(b, 'b')).toBe('ready')
})

test('82.5 a second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  planProject()
  writers({ '01-login.md': ticketText(LOGIN), '02-logout.md': ticketText(LOGOUT) })
  p.werk(['plan', 'auth'])
  const open = (b: Board) => b.columns.filter((c) => c.name === 'ready' || c.name === 'blocked').flatMap((c) => c.tickets.map((t) => t.title))
  expect(open(board()).toSorted()).toEqual(['login', 'logout'])

  // The ticket writer now returns only "login" (logout's story is not in the spec any more).
  writers({ '01-login.md': ticketText({ ...LOGIN }) })
  p.werk(['plan', 'auth'])
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .* no longer needs it/)
  expect(open(board())).toEqual(['login'])

  const r = p.werk(['ticket', 'restore', '2', '--actor', 'you'])
  expect(r.code).toBe(0)
  expect(open(board()).toSorted()).toEqual(['login', 'logout'])
})

// ---------- build (83.x) ----------

/** The check passes when done.txt is there, and otherwise prints `noise` characters and a mark, and fails. */
const makefile = (noise: number) =>
  [
    'check:',
    `\t@test -f done.txt || { head -c ${noise} /dev/zero | tr "\\\\0" x; echo; echo "done.txt is missing END-MARK"; exit 1; }`,
    '',
  ].join('\n')

const TICKET: TicketFields = {
  number: 1,
  title: 'The thing is done',
  cites: [],
  blockedBy: [],
  stories: [],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

function buildProject(noise = 200): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile(noise))
  writeFileSync(join(p.dir, 'notes.txt'), 'committed notes\n')
  p.run(['git', 'add', 'Makefile', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), accepted('root'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const events: NewBoardEvent[] = [{ type: 'ticket.planned', payload: TICKET }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    events.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. One.\n')
  // .werk is not part of the work under build.
  writeFileSync(join(p.dir, '.git', 'info', 'exclude'), '.werk/\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const working = (n: number): FakeReply => ({ steps: [{ edit: { path: 'work.txt', content: `pass ${n}\n` } }, result(0.1)] })
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
/** The grader passes every line, and the five reviewers find nothing, so they do not change a step outcome. */
const judges = (): Record<string, FakeReply> => ({
  grader: judgeReply({ lines: [{ id: 'ac-1', score: 5, gap: 'none' }] }),
  ...Object.fromEntries(
    ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, judgeReply({ findings: [] })]),
  ),
})

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const files = readdirSync(runs).filter((f) => f.endsWith('.jsonl'))
  expect(files).toHaveLength(1)
  return readFileSync(join(runs, files[0]!), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content
const builderPrompts = () => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === 'builder' ? [promptOf(lines)] : []))
}

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working(1), finishing] } })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--reverse', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[0]).toMatch(/pass 1$/)
  expect(subjects[1]).toMatch(/pass 2$/)
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks) && l.checks.length > 0).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.at).toBe('string')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
}, 60_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  buildProject(20_000)
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working(1), finishing] } })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  const prompts = builderPrompts()
  expect(prompts).toHaveLength(2)
  const failure = prompts[1]!.split('## Last failure\n\n')[1]!
  expect(failure).toContain('make check')
  expect(failure).toContain('done.txt is missing END-MARK')
  expect(failure.length).toBeGreaterThan(1000)
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(prompts[0]).not.toContain('END-MARK')
  expect(prompts[0]).not.toContain('xxxxxxxxxx')
  expect(prompts[0]).not.toContain('Exit code')
}, 60_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  buildProject()
  writeFileSync(join(p.dir, 'feature.txt'), 'new on main\n')
  p.run(['git', 'add', 'feature.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'LOCAL-EDIT not committed\n')
  writeFileSync(join(p.dir, 'scratch.txt'), 'LOCAL-NEW not committed\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const commits = git('rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(commits.length).toBeGreaterThan(0)
  expect(git('rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of git('rev-list', branch).split('\n')) {
    expect(git('show', `${c}:notes.txt`)).not.toContain('LOCAL-EDIT')
    expect(git('ls-tree', '-r', '--name-only', c).split('\n')).not.toContain('scratch.txt')
  }
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('LOCAL-EDIT not committed\n')
  expect(readFileSync(join(p.dir, 'scratch.txt'), 'utf8')).toBe('LOCAL-NEW not committed\n')
  const status = git('status', '--porcelain')
  expect(status).toContain('notes.txt')
  expect(status).toContain('scratch.txt')
}, 60_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working(1), working(2), working(3), working(4), working(5), working(6)] } })
  const r = p.werk(['build', '1'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toContain('stopped at the retry cap of 5 passes')
  const branch = branchOf(r.stdout)
  expect(git('branch', '--list', branch)).toContain(branch)
  const subjects = git('log', '--reverse', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(5)
  subjects.forEach((s, i) => expect(s).toMatch(new RegExp(`pass ${i + 1}$`)))
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks[0]).toMatchObject({ cmd: 'make check', ok: false })
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(5)
}, 120_000)

test('83.5 the board shows the ticket in building with its retry count', async () => {
  buildProject()
  const url = await serve()
  const apiBoard = async () => (await (await fetch(`${url}api/board`)).json()) as Board
  expect(columnOf(await apiBoard(), TICKET.title)).toBe('ready')

  const sleepy = (n: number): FakeReply => ({ steps: [{ sleep: 1500 }, ...working(n).steps] })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [sleepy(1), sleepy(2), { steps: [{ sleep: 1500 }, ...finishing.steps] }] } })
  const proc = Bun.spawn([process.execPath, MAIN, 'build', '1'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  cleanups.push(() => void proc.kill('SIGKILL'))
  const columnsSeen = new Set<string>()
  let done = false
  void proc.exited.then(() => (done = true))
  while (!done) {
    const c = columnOf(await apiBoard(), TICKET.title)
    if (c) columnsSeen.add(c)
    await Bun.sleep(200)
  }
  expect(await proc.exited).toBe(0)
  expect(columnsSeen.has('building')).toBe(true)
  const end = await apiBoard()
  const t = end.columns.flatMap((c) => c.tickets).find((x) => x.number === 1)!
  expect(t.retries).toBe(2)
}, 120_000)
