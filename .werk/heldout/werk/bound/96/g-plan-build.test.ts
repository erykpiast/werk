/** Held-out steps 82.x (plan), 83.x (build passes), 84.x (grader and reviewers). */
import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../src/test/map-events.ts'

// ---------- plan (82.x) ----------

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec: auth\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I leave.\n'

function ticketText(o: { title: string; cites: string; blockedBy?: string; stories?: string | null; touches: string }): string {
  return [
    `title: ${o.title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blockedBy ?? ''}`,
    ...(o.stories === null ? [] : [`stories: ${o.stories ?? ''}`]),
    `touches: ${o.touches}`,
    '',
    '## What to build',
    '',
    `The person can ${o.title}.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] The ${o.title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

/** A project whose map holds the decided subtree under "auth": auth-session and auth-token, both decided. */
function authProject(extra: Parameters<typeof logOf> = []): Project {
  const p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-token', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-token'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

function writers(p: Project, tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
}

const LOGIN = ticketText({ title: 'login', cites: 'auth, auth-session', stories: '1', touches: 'session store' })
const LOGOUT = ticketText({ title: 'logout', cites: 'auth-token', stories: '2', touches: 'token store' })

const boardLog = (p: Project) => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const mapLog = (p: Project) => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardTickets = (p: Project) =>
  foldBoard(boardLog(p)).columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, title: t.title })))

test('82.1 a plan over a decided subtree records a feature run, puts tickets on the board, and proposes answers as ghosts', () => {
  const p = authProject()
  const tokenTtl: Answer = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token lives one hour.' }
  const splitLogin: Answer = { slug: 'split-login', title: 'Split login in two', why: 'Is login one ticket?', body: 'Login is two tickets.' }
  writers(p, { '1-login.md': LOGIN, '2-logout.md': LOGOUT }, { spec: [tokenTtl], tickets: [splitLogin] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).toBe(0)

  // The first event of the run in the log is a tier event with the tier "feature".
  expect(boardLog(p)[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  // The board shows the two tickets.
  expect(boardTickets(p).map((t) => t.title).toSorted()).toEqual(['login', 'logout'])

  const state = fold(mapLog(p))
  for (const [id, a] of [['auth-token-ttl', tokenTtl], ['auth-split-login', splitLogin]] as const) {
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, title: a.title, why: a.why, body: a.body, who: 'me' })
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    const show = p.werk(['show', id])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain(a.title)
    expect(show.stdout).toContain(a.why)
    expect(show.stdout).toContain(a.body)
  }
  // The person accepts each ghost one at a time (the ✓ button posts the same accept; see the browser spec).
  expect(p.werk(['accept', 'auth-token-ttl', '--actor', 'you']).code).toBe(0)
  expect(fold(mapLog(p)).nodes.get('auth-token-ttl')?.proposed).toBe(false)
  expect(fold(mapLog(p)).nodes.get('auth-split-login')?.proposed).toBe(true)
  expect(p.werk(['accept', 'auth-split-login', '--actor', 'you']).code).toBe(0)
  expect(fold(mapLog(p)).nodes.get('auth-split-login')?.proposed).toBe(false)
})

test('82.2 a plan stops with an error when an answer record has an id that is already in the map', () => {
  const p = authProject([proposed('auth-token-ttl', { parent: 'auth', title: 'Existing card' }), accepted('auth-token-ttl')])
  const tokenTtl: Answer = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long?', body: 'One hour.' }
  writers(p, { '1-login.md': LOGIN, '2-logout.md': LOGOUT }, { spec: [tokenTtl] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog(p).filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  expect(fold(mapLog(p)).nodes.get('auth-token-ttl')?.title).toBe('Existing card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  const p = authProject()
  const login = ticketText({ title: 'login', cites: 'auth, auth-session', stories: null, touches: 'session store' })
  const logout = ticketText({ title: 'logout', cites: 'auth, auth-token', stories: '1, 2', touches: 'token store' })
  writers(p, { '1-login.md': login, '2-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const titles = boardTickets(p).map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  expect(r.stdout).toMatch(/1-login\.md: shape: stories: .*missing/)
  expect(r.stdout).toMatch(/ticket set: cards-cited: .*auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  const p = authProject()
  const a = ticketText({ title: 'a', cites: 'auth', stories: '1', touches: 'a/b.ts' })
  const b = ticketText({ title: 'b', cites: 'auth-session', stories: '1', touches: 'session store' })
  const c = ticketText({ title: 'c', cites: 'auth-token', blockedBy: '1, 2', stories: '2', touches: 'token store' })
  writers(p, { '1-a.md': a, '2-b.md': b, '3-c.md': c })
  p.werk(['plan', 'auth'])
  const t = boardTickets(p)
  expect(t.find((x) => x.title === 'a')).toBeUndefined()
  expect(t.find((x) => x.title === 'c')?.column).toBe('blocked')
  expect(t.find((x) => x.title === 'b')?.column).toBe('ready')
})

test('82.5 a second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  const p = authProject()
  const login = ticketText({ title: 'login', cites: 'auth, auth-session, auth-token', stories: '1, 2', touches: 'session store' })
  writers(p, { '1-login.md': login, '2-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(boardTickets(p).map((t) => t.title).toSorted()).toEqual(['login', 'logout'])

  writers(p, { '1-login.md': login })
  p.werk(['plan', 'auth'])
  const archived = boardLog(p).filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .* no longer needs it/)
  const open = () => boardTickets(p).filter((t) => t.column === 'ready' || t.column === 'blocked').map((t) => t.title)
  expect(open()).toContain('login')
  expect(open()).not.toContain('logout')

  expect(p.werk(['ticket', 'restore', '2']).code).toBe(0)
  expect(open()).toContain('logout')
})

// ---------- build (83.x, 84.x) ----------

const ticket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt says done.',
  root: 'root',
}

const PASSING_MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')

function buildProject(o: { makefile?: string; fields?: Partial<TicketFields>; map?: Parameters<typeof logOf> } = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), o.makefile ?? PASSING_MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(
    ...(o.map ?? [
      proposed('root', { status: 'decided' }),
      proposed('loop', { status: 'decided', parent: 'root', title: 'Write cards by appending' }),
      accepted('loop'),
    ]),
  )
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...ticket, ...o.fields } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
/** A grader reply that scores every line it is asked about. It reads the ids from a fixed list. */
const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const DEFAULT_IDS = ['ac-1', 'ac-2', '#loop']
const judges = (ids = DEFAULT_IDS): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  const launches = p.agentLaunches()
  return p.agentInputs().flatMap((lines, i) => {
    if (roles[i] !== role) return []
    const fromStdin = promptOf(lines)
    // A judge may get its prompt as the -p argument instead of on stdin.
    const argv = launches[i]!
    const pIndex = argv.indexOf('-p')
    return [fromStdin || (pIndex >= 0 ? argv[pIndex + 1] ?? '' : '')]
  })
}
const isHeldout = (role: string | undefined) => role?.startsWith('heldout-') === true
const buildRoles = (p: Project) => p.agentRoles().filter((r) => !isHeldout(r))
const boardTicket = (p: Project) =>
  foldBoard(boardLog(p))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === 3)

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  const p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toMatch(/pass 1$/)
  expect(subjects[0]).toMatch(/pass 2$/)
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(Array.isArray(line.checks)).toBe(true)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
})

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  const makefile = ['check:', '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-OUTPUT"; exit 1; }', ''].join('\n')
  const p = buildProject({ makefile })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  const [first, second] = prompts(p)
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-OF-OUTPUT')
  const failure = second!.slice(second!.indexOf('## Last failure'))
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('make check\nExit code')
  expect(first).not.toContain('yyyyyyyyyy')
  expect(first).not.toContain('TAIL-OF-OUTPUT')
})

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  const p = buildProject()
  writeFileSync(join(p.dir, 'notes.txt'), 'committed\n')
  p.run(['git', 'add', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'LOCAL-UNCOMMITTED-EDIT\n')
  writeFileSync(join(p.dir, 'local.txt'), 'LOCAL-UNTRACKED-FILE\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  const branch = branchOf(r.stdout)
  const commits = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n').filter(Boolean)
  expect(commits.length).toBeGreaterThan(0)
  expect(git(p, 'rev-parse', `${commits[0]}^1`)).toBe(tip)
  const patch = git(p, 'log', '-p', `main..${branch}`)
  expect(patch).not.toContain('LOCAL-UNCOMMITTED-EDIT')
  expect(patch).not.toContain('LOCAL-UNTRACKED-FILE')
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('LOCAL-UNCOMMITTED-EDIT\n')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('LOCAL-UNTRACKED-FILE\n')
  expect(git(p, 'status', '--porcelain')).toContain('notes.txt')
})

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  const p = buildProject()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(5)
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const line of lines) {
    expect(line.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
})

test('83.5 the board shows the ticket in building with its retry count', async () => {
  const p = buildProject()
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, working, finishing] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'cli', 'main.ts'), 'build', '3'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let sawBuilding = false
  while (child.exitCode === null) {
    if (boardTicket(p)?.column === 'building') sawBuilding = true
    await Bun.sleep(50)
  }
  await child.exited
  if (boardTicket(p)?.column === 'building') sawBuilding = true
  expect(sawBuilding).toBe(true)
  expect(boardTicket(p)?.retries).toBe(2)
}, 30_000)

const GAP = 'the diff writes the card in place, the card forbids it'

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  const p = buildProject()
  const failing = grading(DEFAULT_IDS, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? `${GAP} (done.txt:1)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: [failing, grading(DEFAULT_IDS, () => 4)] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  // No reviewer between the first grader and the second builder.
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((x) => x?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(second).toContain(GAP)
  expect(second).toContain('done.txt:1')
})

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const p = buildProject({
    fields: {
      cites: ['c1'],
      brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- first criterion.\n- second criterion.\n- third criterion.',
    },
    map: [
      proposed('root', { status: 'decided' }),
      proposed('c1', { status: 'decided', parent: 'root', title: 'CITED-CARD' }),
      proposed('c2', { status: 'decided', title: 'UNCITED-DECIDED-CARD' }),
      proposed('c3', { status: 'open', title: 'OPEN-CARD' }),
      accepted('c1'),
      accepted('c2'),
      accepted('c3'),
      linked('c1', 'c2', 'depends_on'),
      linked('c2', 'c3', 'depends_on'),
    ],
  })
  p.scriptAgent({ steps: [], roles: { ...judges(['ac-1', 'ac-2', 'ac-3', '#c1', '#c2']), builder: [finishing] } })
  p.werk(['build', '3'])
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const lines = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  expect(lines.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lines).toContain('#c1 (contradiction): CITED-CARD')
  expect(lines).toContain('#c2 (contradiction): UNCITED-DECIDED-CARD')
  expect(lines).not.toContain('OPEN-CARD')
  expect(lines).not.toContain('#c3')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const p = buildProject()
  const unbuilt = grading(DEFAULT_IDS, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'not built yet: the second part' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: unbuilt } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const [i, area] of ['design', 'maintainability', 'tests', 'security and dependencies', 'performance'].entries()) {
    const [prompt] = prompts(p, REVIEWERS[i])
    expect(prompt).toContain(`You are the ${area} reviewer`)
    expect(prompt).toContain('+done')
    // The diff only: no card and no ticket brief.
    expect(prompt).not.toContain('Write cards by appending')
    expect(prompt).not.toContain('Make done.txt.')
  }
})

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  const p = buildProject()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]!
  expect(second).toContain('HIGH')
  expect(second).toContain('done.txt:1')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token')
  const roles = buildRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  const after = roles.slice(secondBuilder + 1)
  expect(after).toContain('grader')
  expect(after.filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  expect(runRecord(p)[1].checks.length).toBeGreaterThan(0)
})

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  const p = buildProject()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  const [line] = runRecord(p)
  expect(line.green).toBe(true)
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  // The ticket leaves building.
  expect(boardTicket(p)?.column).not.toBe('building')
})
