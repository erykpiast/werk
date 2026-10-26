import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { boardLog, boardOf, FIX, projectWith } from './util.ts'

let p: Project | undefined
let server: ReturnType<typeof Bun.spawn> | undefined
afterEach(() => {
  server?.kill()
  server = undefined
  p?.cleanup()
})

const PLAN = '.werk/plans/auth'
const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

/** A decided subtree under the root card "#auth" (id "auth"), with two decided children. */
const authSubtree = () => [
  proposed('auth', { status: 'decided', who: 'you' }),
  proposed('auth-session', { status: 'decided', parent: 'auth' }),
  proposed('auth-token', { status: 'decided', parent: 'auth' }),
  accepted('auth'),
  accepted('auth-session'),
  accepted('auth-token'),
]

type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
const folder = (name: string): Record<string, string> =>
  Object.fromEntries(readdirSync(join(FIX, name)).map((f) => [f, readFileSync(join(FIX, name, f), 'utf8')]))

/** Scripts the spec writer and the ticket writer the way a real writer writes the plan files. */
function writers(tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
  p!.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': {
        steps: [edit(`${PLAN}/spec.md`, readFileSync(join(FIX, 'auth-spec.md'), 'utf8')), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))],
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

const mapState = () => fold(readLog<Event>(join(p!.dir, '.werk', 'log.jsonl')))
/** Board reading: the fold of the board log, as {column: [ticket titles]}, archived apart. */
const columns = () => Object.fromEntries(boardOf(p!).columns.map((c) => [c.name, c.tickets.map((t) => t.title)]))
const onBoard = () => boardOf(p!).columns.flatMap((c) => c.tickets.map((t) => t.title))

/** Starts `werk serve` on the project and gives its address. */
async function serve(): Promise<string> {
  server = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: p!.dir, env: p!.env, stdout: 'pipe', stderr: 'pipe' })
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  let out = ''
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    out += new TextDecoder().decode(value)
    const m = out.match(/http:\/\/\S+\//)
    if (m) return m[0]
  }
  throw new Error('werk serve printed no address: ' + out)
}

// 82.1
// Scenario: A plan over a decided subtree records a feature run, writes a spec and tickets, and puts the writers' answers on the map as proposals
// Given a map with a decided subtree under the root card "#auth"
// And the spec writer returns one spec and one answer record with the slug "token-ttl", a title, a why and a body
// And the ticket writer returns two tickets that pass all checks and one answer record with the slug "split-login"
// When the person runs the plan over "#auth"
// Then the first event of the run in the log is a tier event with the tier "feature"
// And the board shows the two tickets
// And the map shows a ghost card "#auth-token-ttl" that refines "#auth", with the agent as the one who decides
// And the map shows a ghost card "#auth-split-login" that refines "#auth", with the agent as the one who decides
// And each ghost shows the title, the why and the body from its record
// And the person can accept each ghost one at a time with the ✓ button
// Readings: "the log" of the run is the board log (.werk/board.jsonl). "The board shows" is the
// board fold over it. "The agent as the one who decides" is who = "me" (werk's word for the agent;
// "you" is the person). The ✓ button is the same write path: a POST to /api/accept/<id> on a real
// `werk serve`, which is what the ✓ sends; then the fold shows that ghost real and the other still a ghost.
test('82.1', async () => {
  p = projectWith(authSubtree())
  const ttl: Answer = { slug: 'token-ttl', title: 'A token lives one hour', why: 'How long does a token live?', body: 'A token ends one hour after it is made.' }
  const split: Answer = { slug: 'split-login', title: 'Split log in from log out', why: 'Is log in one ticket with log out?', body: 'Log in and log out are two tickets.' }
  writers(folder('f82-1'), { spec: [ttl], tickets: [split] })
  const r = p.werk(['plan', 'auth'])
  console.log('82.1 plan output:\n' + r.stdout + r.stderr)
  expect(r.code).toBe(0)

  const first = boardLog(p)[0]!
  expect(first.type).toBe('tier.recorded')
  expect((first.payload as { tier: string }).tier).toBe('feature')

  expect(onBoard().toSorted()).toEqual(['A person can log in', 'A person can log out'])

  const state = mapState()
  for (const [id, a] of [['auth-token-ttl', ttl], ['auth-split-login', split]] as const) {
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, who: 'me', title: a.title, why: a.why, body: a.body })
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
  }

  const url = await serve()
  const res1 = await fetch(`${url}api/accept/auth-token-ttl`, { method: 'POST' })
  expect(res1.status).toBe(200)
  const after1 = mapState()
  expect(after1.nodes.get('auth-token-ttl')?.proposed).toBe(false)
  expect(after1.nodes.get('auth-split-login')?.proposed).toBe(true)
  const res2 = await fetch(`${url}api/accept/auth-split-login`, { method: 'POST' })
  expect(res2.status).toBe(200)
  expect(mapState().nodes.get('auth-split-login')?.proposed).toBe(false)
})

// 82.2
// Scenario: A plan stops with an error when an answer record has an id that is already in the map
// Given a map with a decided subtree under the root card "#auth"
// And the map already has a card "#auth-token-ttl"
// And the spec writer returns an answer record with the slug "token-ttl"
// When the person runs the plan over "#auth"
// Then the plan exits with an error
// And the output names the record "token-ttl"
// And the map shows no second card with the id "#auth-token-ttl"
// Reading: "exits with an error" is a non-zero exit code. The existing card is an open child of
// "#auth", so it is not a decided card the tickets must cite.
test('82.2', () => {
  p = projectWith([...authSubtree(), proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'Old token ttl' }), accepted('auth-token-ttl')])
  writers(folder('f82-1'), { spec: [{ slug: 'token-ttl', title: 'A token lives one hour', why: 'How long?', body: 'One hour.' }] })
  const r = p.werk(['plan', 'auth'])
  console.log('82.2 plan output:\n' + r.stdout + r.stderr)
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = readLog<Event>(join(p.dir, '.werk', 'log.jsonl')).filter(
    (e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl',
  )
  expect(proposals).toHaveLength(1)
  expect(mapState().nodes.get('auth-token-ttl')).toMatchObject({ proposed: false, title: 'Old token ttl' })
})

// 82.3
// Scenario: A ticket that fails its own checks stays off the board and gives no coverage
// Given a map with a decided subtree under the root card "#auth" that holds the decided card "#auth-session"
// And the ticket writer returns a ticket "login" that has no stories header line and is the only ticket that cites "#auth-session"
// And the ticket writer returns a ticket "logout" that passes all checks and cites other cards
// When the person runs the plan over "#auth"
// Then the board shows "logout" and does not show "login"
// And the output names the missing field in "login"
// And the output reports "#auth-session" as a card that no ticket cites
test('82.3', () => {
  p = projectWith(authSubtree())
  writers(folder('f82-3'))
  const r = p.werk(['plan', 'auth'])
  console.log('82.3 plan output:\n' + r.stdout + r.stderr)
  expect(onBoard()).toEqual(['A person can log out'])
  const out = r.stdout.trimEnd().split('\n')
  expect(out.some((l) => l.startsWith('01-login.md:') && l.includes('stories') && l.includes('missing'))).toBe(true)
  expect(out.some((l) => l.includes('no ticket cites') && l.includes('#auth-session'))).toBe(true)
})

// 82.4
// Scenario: A ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready
// Given a map with a decided subtree under the root card "#auth"
// And the ticket writer returns a ticket "a" that fails its own checks
// And the ticket writer returns a ticket "b" that passes all checks and has no blockers
// And the ticket writer returns a ticket "c" that names "a" and "b" as its blockers
// When the person runs the plan over "#auth"
// Then the board does not show "a"
// And the board shows "c" as blocked
// And the board shows "b" as ready
// Reading: ticket "a" is 01-a.md with no touches line; "b" is 02-b.md; "c" is 03-c.md with blocked_by 1, 2.
test('82.4', () => {
  p = projectWith(authSubtree())
  writers(folder('f82-4'))
  const r = p.werk(['plan', 'auth'])
  console.log('82.4 plan output:\n' + r.stdout + r.stderr)
  const cols = columns()
  expect(onBoard()).not.toContain('Ticket a')
  expect(cols.blocked).toEqual(['Ticket c'])
  expect(cols.ready).toEqual(['Ticket b'])
})

// 82.5
// Scenario: A second plan archives an open ticket that the new spec drops, and a restore puts it back
// Given a person ran the plan over "#auth" and the board shows the open tickets "login" and "logout"
// And the ticket writer now returns only the ticket "login"
// When the person runs the plan over "#auth" again
// Then the board log shows "logout" as archived with the reason that the current spec no longer needs it
// And the board shows "login" as open
// When the person restores "logout"
// Then the board shows "logout" as open again
// Reading: "open" is the ready or the blocked column. The restore is `werk ticket restore 2`.
test('82.5', () => {
  p = projectWith(authSubtree())
  const both = folder('f82-5')
  writers(both)
  const first = p.werk(['plan', 'auth'])
  console.log('82.5 first plan:\n' + first.stdout + first.stderr)
  const open = () => [...(columns().ready ?? []), ...(columns().blocked ?? [])]
  expect(open().toSorted()).toEqual(['A person can log in', 'A person can log out'])

  writers({ '01-login.md': both['01-login.md']! })
  const second = p.werk(['plan', 'auth'])
  console.log('82.5 second plan:\n' + second.stdout + second.stderr)
  const archived = boardLog(p).filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  const payload = archived[0]!.payload as { number: number; reason: string }
  expect(payload.number).toBe(2)
  expect(payload.reason).toMatch(/current spec.*no longer needs it/)
  expect(open()).toEqual(['A person can log in'])

  const restore = p.werk(['ticket', 'restore', '2'])
  console.log('82.5 restore:\n' + restore.stdout + restore.stderr)
  expect(restore.code).toBe(0)
  expect(open().toSorted()).toEqual(['A person can log in', 'A person can log out'])
})
