/** Held-out steps 82.1-82.5: the plan verb, with fake spec and ticket writers. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { BoardEvent } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event, NewEvent } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
let p: Project
afterEach(() => p?.cleanup())

function project(extra: NewEvent[] = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you', title: 'Auth' }),
    proposed('auth-session', { status: 'decided', parent: 'auth', title: 'Sessions live in a cookie' }),
    proposed('auth-tokens', { status: 'decided', parent: 'auth', title: 'Tokens expire' }),
    accepted('auth-session'),
    accepted('auth-tokens'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
const SPEC12 = '# Spec\n\n## User Stories\n\n1. As a person, I log in.\n2. As a person, I log out.\n'
const SPEC1 = '# Spec\n\n## User Stories\n\n1. As a person, I log in.\n'

type T = { title: string; cites: string; blocked?: string; stories?: string | null; touches?: string }
function ticket(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? '1'}`]),
    `touches: ${t.touches ?? 'login flow'}`,
    '',
    '## What to build',
    '',
    `Build this: ${t.title}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works for a person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

type Answer = { slug: string; title: string; why: string; body: string }
const answer = (slug: string): Answer => ({ slug, title: `Title of ${slug}`, why: `Why of ${slug}`, body: `Body of ${slug}` })

function writers(o: { spec?: string; specAnswers?: Answer[]; tickets: Record<string, string>; ticketAnswers?: Answer[] }) {
  const spec: FakeReply = { steps: [edit(`${PLAN}/spec.md`, o.spec ?? SPEC12), edit(`${PLAN}/spec.answers.json`, JSON.stringify(o.specAnswers ?? []))] }
  const tickets: FakeReply = {
    steps: [
      ...Object.entries(o.tickets).map(([n, text]) => edit(`${PLAN}/tickets/${n}`, text)),
      edit(`${PLAN}/tickets.answers.json`, JSON.stringify(o.ticketAnswers ?? [])),
    ],
  }
  p.scriptAgent({ steps: [], roles: { 'spec-writer': spec, 'ticket-writer': tickets } })
}

const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = () => foldBoard(boardLog())
const shown = () => board().columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, title: t.title, number: t.number })))

const LOGIN = ticket({ title: 'A person logs in', cites: 'auth, auth-session', stories: '1' })
const LOGOUT = ticket({ title: 'A person logs out', cites: 'auth-tokens', stories: '2' })

test('82.1', async () => {
  project()
  const boardBefore = boardLog().length
  writers({ specAnswers: [answer('token-ttl')], tickets: { '1-login.md': LOGIN, '2-logout.md': LOGOUT }, ticketAnswers: [answer('split-login')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).toBe(0)

  const run = boardLog().slice(boardBefore)
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(shown().map((t) => t.title).toSorted()).toEqual(['A person logs in', 'A person logs out'])

  const state = fold(mapLog())
  for (const slug of ['token-ttl', 'split-login']) {
    const id = `auth-${slug}`
    const node = state.nodes.get(id)
    expect(node?.proposed).toBe(true)
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    const show = p.werk(['show', id])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain('ghost')
    expect(show.stdout).toContain('parent: #auth')
    // "the agent as the one who decides": the contract's own command uses --who me for the agent.
    expect(show.stdout).toContain('who: me')
    expect(show.stdout).toContain(`Title of ${slug}`)
    expect(show.stdout).toContain(`why: Why of ${slug}`)
    expect(show.stdout).toContain(`Body of ${slug}`)
  }

  // Accept each ghost one at a time with the ✓ button in the browser.
  const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
  const server = spawn(process.execPath, [MAIN, 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = ''
      const t = setTimeout(() => reject(new Error('no address')), 20000)
      server.stdout.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) {
          clearTimeout(t)
          resolve(m[0])
        }
      })
    })
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      for (const id of ['auth-token-ttl', 'auth-split-login']) {
        await page.goto(`${url}#${id}`)
        const card = page.getByTestId('card')
        await card.waitFor()
        expect(await card.getAttribute('data-proposed')).toBe('true')
        await page.getByRole('button', { name: `Accept #${id}` }).click()
        await page.waitForFunction(() => document.querySelector('[data-testid="card"]')?.getAttribute('data-proposed') === 'false', undefined, { timeout: 10000 })
        const s = fold(mapLog())
        expect(s.nodes.get(id)?.proposed).toBe(false)
        if (id === 'auth-token-ttl') expect(s.nodes.get('auth-split-login')?.proposed).toBe(true)
      }
      const accepts = mapLog().filter((e) => e.type === 'node.accepted' && e.payload.id.startsWith('auth-') && e.actor === 'you')
      expect(accepts.map((e) => (e.payload as { id: string }).id)).toEqual(['auth-token-ttl', 'auth-split-login'])
    } finally {
      await browser.close()
    }
  } finally {
    server.kill('SIGTERM')
  }
}, 60000)

test('82.2', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'Existing TTL card' }), accepted('auth-token-ttl')])
  writers({ specAnswers: [answer('token-ttl')], tickets: { '1-login.md': LOGIN, '2-logout.md': LOGOUT } })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')?.title).toBe('Existing TTL card')
})

test('82.3', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth-session', stories: null })
  const logout = ticket({ title: 'logout', cites: 'auth, auth-tokens', stories: '1, 2' })
  writers({ tickets: { '1-login.md': login, '2-logout.md': logout } })
  const r = p.werk(['plan', 'auth'])
  const titles = shown().map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  const lines = r.stdout.split('\n')
  expect(lines.some((l) => l.includes('1-login.md') && l.includes('stories'))).toBe(true)
  expect(lines.some((l) => l.includes('#auth-session') && /cite/.test(l))).toBe(true)
})

test('82.4', () => {
  project()
  const a = ticket({ title: 'a', cites: 'auth-session', touches: 'src/a.ts' })
  const b = ticket({ title: 'b', cites: 'auth, auth-tokens', stories: '1' })
  const c = ticket({ title: 'c', cites: 'auth-session', blocked: '1, 2', stories: '2' })
  writers({ tickets: { '1-a.md': a, '2-b.md': b, '3-c.md': c } })
  p.werk(['plan', 'auth'])
  const s = shown()
  expect(s.find((t) => t.title === 'a')).toBeUndefined()
  expect(s.find((t) => t.title === 'c')?.column).toBe('blocked')
  expect(s.find((t) => t.title === 'b')?.column).toBe('ready')
})

test('82.5', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth, auth-session', stories: '1' })
  const logout = ticket({ title: 'logout', cites: 'auth-tokens', stories: '2' })
  writers({ tickets: { '1-login.md': login, '2-logout.md': logout } })
  p.werk(['plan', 'auth'])
  const open = (title: string) => {
    const t = shown().find((x) => x.title === title)
    return t !== undefined && (t.column === 'ready' || t.column === 'blocked')
  }
  expect(open('login')).toBe(true)
  expect(open('logout')).toBe(true)

  const login2 = ticket({ title: 'login', cites: 'auth, auth-session, auth-tokens', stories: '1' })
  writers({ spec: SPEC1, tickets: { '1-login.md': login2 } })
  p.werk(['plan', 'auth'])
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]!.payload).toMatchObject({ number: 2 })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/no longer needs it/)
  expect(board().archived.map((t) => t.title)).toEqual(['logout'])
  expect(open('login')).toBe(true)
  expect(open('logout')).toBe(false)

  const r = p.werk(['ticket', 'restore', '2'])
  expect(r.code).toBe(0)
  expect(open('logout')).toBe(true)
})
