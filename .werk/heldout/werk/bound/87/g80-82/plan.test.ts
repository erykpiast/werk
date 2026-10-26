/** Held-out steps 82.1–82.5: the plan verb, with fake spec and ticket writers. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')
let p: Project
afterEach(() => p?.cleanup())

function project(extra: ReturnType<typeof proposed>[] = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-login', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-login'),
    ...extra.flatMap((e) => [e, accepted((e.payload as { id: string }).id)]),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

const SPEC = '# Spec: auth\n\n## User stories\n\n1. As a person, I want to log in, so that I work.\n2. As a person, I want to log out, so that I leave.\n'
type T = { title: string; cites: string; blocked_by?: string; stories?: string | null; touches?: string }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked_by ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? '1'}`]),
    `touches: ${t.touches ?? 'session store'}`,
    '',
    '## What to build',
    '',
    `A person can do this: ${t.title}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
function writers(tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
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
const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
/** What the board shows: the fold of the board log, the same fold that GET /api/board sends. */
const boardTitles = () => Object.fromEntries(foldBoard(boardLog()).columns.map((c) => [c.name, c.tickets.map((t) => t.title)]))
const allTitles = () => Object.values(boardTitles()).flat()

const LOGIN = ticket({ title: 'Log in', cites: 'auth, auth-login', stories: '1' })
const LOGOUT = ticket({ title: 'Log out', cites: 'auth-session', stories: '2' })

test('82.1 a plan records a feature run, writes a spec and tickets, and proposes the answers', async () => {
  project()
  const tokenTtl = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token expires after one hour.' }
  const split = { slug: 'split-login', title: 'Login is its own ticket', why: 'Is login one ticket or two?', body: 'Login and logout are two tickets.' }
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [tokenTtl], tickets: [split] })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  const board = boardLog()
  expect(board[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(allTitles().toSorted()).toEqual(['Log in', 'Log out'])
  const state = fold(mapLog())
  for (const [id, rec] of [['auth-token-ttl', tokenTtl], ['auth-split-login', split]] as const) {
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, who: 'me', title: rec.title, why: rec.why, body: rec.body })
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    const show = p.werk(['show', id]).stdout
    expect(show).toContain(rec.title)
    expect(show).toContain(rec.why)
    expect(show).toContain(rec.body)
  }

  // The ✓ button, in a browser, on the real server.
  const server = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const browser = await chromium.launch()
  try {
    const reader = server.stdout.getReader()
    let out = ''
    let url: string | undefined
    while (!url) {
      const { value, done } = await reader.read()
      if (done) throw new Error('server exited: ' + out)
      out += new TextDecoder().decode(value)
      url = out.match(/http:\/\/\S+\//)?.[0]
    }
    const page = await browser.newPage()
    for (const id of ['auth-token-ttl', 'auth-split-login']) {
      await page.goto(`${url}#${id}`)
      const card = page.getByTestId('card')
      await card.waitFor()
      expect(await card.getAttribute('data-card-id')).toBe(id)
      await page.getByRole('button', { name: `Accept #${id}` }).click()
      await page.waitForFunction((cardId) => document.querySelector(`[data-card-id="${cardId}"]`)?.getAttribute('data-proposed') === 'false', id, { timeout: 5000 })
      const after = fold(mapLog())
      expect(after.nodes.get(id)?.proposed).toBe(false)
      const others = ['auth-token-ttl', 'auth-split-login'].filter((o) => o !== id)
      if (id === 'auth-token-ttl') expect(after.nodes.get(others[0]!)?.proposed).toBe(true)
    }
    const accepts = mapLog().filter((e) => e.type === 'node.accepted' && ['auth-token-ttl', 'auth-split-login'].includes((e.payload as { id: string }).id))
    expect(accepts.map((e) => e.actor)).toEqual(['you', 'you'])
  } finally {
    await browser.close()
    server.kill()
  }
}, 60_000)

test('82.2 a plan stops with an error on an answer id that is already in the map', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'The existing token card' })])
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long?', body: 'One hour.' }] })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  expect(mapLog().filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')).toHaveLength(1)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')?.title).toBe('The existing token card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session', stories: null }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth, auth-login', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(allTitles()).toContain('logout')
  expect(allTitles()).not.toContain('login')
  expect(r.stdout).toMatch(/01-login\.md: shape: stories: /)
  expect(r.stdout).toMatch(/cards-cited: .*#auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', () => {
  project()
  writers({
    '01-a.md': ticket({ title: 'a', cites: 'auth', touches: 'server/routes.ts' }),
    '02-b.md': ticket({ title: 'b', cites: 'auth, auth-session, auth-login', stories: '1, 2' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth-login', blocked_by: '1, 2', stories: '2' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const cols = boardTitles()
  expect(allTitles()).not.toContain('a')
  expect(cols.blocked).toContain('c')
  expect(cols.ready).toContain('b')
})

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  project()
  writers({ '01-login.md': ticket({ title: 'login', cites: 'auth, auth-login', stories: '1' }), '02-logout.md': ticket({ title: 'logout', cites: 'auth-session', stories: '2' }) })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  const open = () => [...(boardTitles().ready ?? []), ...(boardTitles().blocked ?? [])]
  expect(open().toSorted()).toEqual(['login', 'logout'])
  writers({ '01-login.md': ticket({ title: 'login', cites: 'auth, auth-login, auth-session', stories: '1, 2' }) })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  expect(open()).toContain('login')
  expect(open()).not.toContain('logout')
  const restore = p.werk(['ticket', 'restore', '2'])
  expect(restore.code).toBe(0)
  expect(open()).toContain('logout')
})
