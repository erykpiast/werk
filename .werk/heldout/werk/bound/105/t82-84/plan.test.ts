/** Held-out steps 82.2 to 82.5: the plan verb over a decided subtree "#auth", with fake writers. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
let p: Project
afterEach(() => p?.cleanup())

const SPEC = '# Spec: auth\n\n## Problem Statement\n\nA person cannot log in.\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I end my session.\n'

export function ticketText(o: { title: string; cites: string[]; blockedBy?: number[]; stories?: number[] | null; touches?: string }) {
  const lines = [`title: ${o.title}`, `cites: ${o.cites.join(', ')}`, `blocked_by: ${(o.blockedBy ?? []).join(', ')}`]
  if (o.stories !== null) lines.push(`stories: ${(o.stories ?? [1]).join(', ')}`)
  lines.push(`touches: ${o.touches ?? 'session store'}`)
  return [
    ...lines,
    '',
    '## What to build',
    '',
    `A person does the thing that ${o.title.toLowerCase()} names.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The thing works for the person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

function project(extra: Parameters<typeof logOf> = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-login', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-login'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

type Answer = { slug: string; title: string; why: string; body: string }
const answer = (slug: string): Answer => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: `The ${slug} body.` })
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
const board = () => foldBoard(boardLog())
const shown = () => board().columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, title: t.title, number: t.number })))

const LOGIN = ticketText({ title: 'Login', cites: ['auth', 'auth-login', 'auth-session'], stories: [1] })
const LOGOUT = ticketText({ title: 'Logout', cites: ['auth-session'], stories: [2] })

test('82.2 a plan stops with an error when an answer record has an id that is already in the map', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'The existing token ttl card' }), accepted('auth-token-ttl')])
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [answer('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  // Then the plan exits with an error
  expect(r.code).not.toBe(0)
  // And the output names the record "token-ttl"
  expect(r.stdout + r.stderr).toContain('token-ttl')
  // And the map shows no second card with the id "#auth-token-ttl"
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')?.title).toBe('The existing token ttl card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  const login = ticketText({ title: 'login', cites: ['auth-session', 'auth-login'], stories: null })
  const logout = ticketText({ title: 'logout', cites: ['auth-login'], stories: [1, 2] })
  writers({ '01-login.md': login, '02-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const titles = shown().map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  const out = r.stdout + r.stderr
  const loginLine = out.split('\n').find((l) => l.includes('01-login.md'))
  expect(loginLine).toBeDefined()
  expect(loginLine).toContain('stories')
  expect(out.split('\n').some((l) => l.includes('auth-session') && /cite/.test(l))).toBe(true)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  project()
  const a = ticketText({ title: 'a', cites: ['auth-session'], stories: null })
  const b = ticketText({ title: 'b', cites: ['auth-session', 'auth-login'], stories: [1] })
  const c = ticketText({ title: 'c', cites: ['auth-login'], blockedBy: [1, 2], stories: [2] })
  writers({ '01-a.md': a, '02-b.md': b, '03-c.md': c })
  p.werk(['plan', 'auth'])
  const t = shown()
  expect(t.find((x) => x.title === 'a')).toBeUndefined()
  expect(t.find((x) => x.title === 'c')?.column).toBe('blocked')
  expect(t.find((x) => x.title === 'b')?.column).toBe('ready')
})

test('82.5 a second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(shown().map((t) => t.title).toSorted()).toEqual(['Login', 'Logout'])

  writers({ '01-login.md': LOGIN.replace('stories: 1', 'stories: 1, 2') })
  p.werk(['plan', 'auth'])
  const archived = boardLog().find((e) => e.type === 'ticket.archived')
  expect(archived).toBeDefined()
  expect((archived!.payload as { number: number }).number).toBe(2)
  expect((archived!.payload as { reason: string }).reason).toMatch(/spec.*no longer needs/)
  const now = shown()
  expect(now.find((t) => t.title === 'Login')?.column).toMatch(/^(ready|blocked)$/)
  expect(now.find((t) => t.title === 'Logout')).toBeUndefined()

  const r = p.werk(['ticket', 'restore', '2'])
  expect(r.code).toBe(0)
  expect(shown().find((t) => t.title === 'Logout')?.column).toMatch(/^(ready|blocked)$/)
})
