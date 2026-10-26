import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BoardEvent } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import { acc, project, prop, type P } from './cli-util.ts'

let p: P
afterEach(() => p?.cleanup())

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec: auth', '', '## User Stories', '', '1. As a person, I log in.', '2. As a person, I log out.', ''].join('\n')
type Ans = { slug: string; title: string; why: string; body: string }
const ans = (slug: string): Ans => ({ slug, title: `Title ${slug}`, why: `Which ${slug}?`, body: `Body ${slug}.` })

function ticket(f: { title: string; cites: string; blocked?: string; stories?: string | null }): string {
  const head = [`title: ${f.title}`, `cites: ${f.cites}`, `blocked_by: ${f.blocked ?? ''}`]
  if (f.stories !== null) head.push(`stories: ${f.stories ?? '1, 2'}`)
  head.push('touches: auth flow')
  return [...head, '', '## What to build', '', `Build ${f.title}.`, '', '## Acceptance criteria', '', '- [ ] It works.', '', '## Checks', '', '- `make test`', ''].join('\n')
}

function setup(extra: object[] = []) {
  p = project()
  p.seed([
    prop('auth', { title: 'Auth', status: 'decided', who: 'you' }),
    acc('auth'),
    prop('auth-session', { title: 'Session', status: 'decided', parent: 'auth' }),
    acc('auth-session'),
    prop('auth-login', { title: 'Login', status: 'decided', parent: 'auth' }),
    acc('auth-login'),
    ...extra,
  ])
}

function writers(tickets: Record<string, string>, specAnswers: Ans[] = [], ticketAnswers: Ans[] = []) {
  const edit = (path: string, content: string) => ({ edit: { path, content } })
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([n, t]) => edit(`${PLAN}/tickets/${n}`, t)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(ticketAnswers)),
        ],
      },
    },
  })
}
const board = () => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name

test('82.2', () => {
  setup([prop('auth-token-ttl', { title: 'Existing TTL', parent: 'auth' }), acc('auth-token-ttl')])
  writers({ '01-login.md': ticket({ title: 'login', cites: 'auth-session, auth-login' }) }, [ans('token-ttl')])
  const r = p.w('plan', 'auth')
  console.log('82.2:', r.code, r.all)
  expect(r.code).not.toBe(0)
  expect(r.all).toContain('token-ttl')
  expect(p.log().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')).toHaveLength(1)
})

test('82.3', () => {
  setup()
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth-session', stories: null }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth-login' }),
  })
  const r = p.w('plan', 'auth')
  console.log('82.3:', r.code, r.all)
  expect(columnOf('logout')).toBeDefined()
  expect(columnOf('login')).toBeUndefined()
  expect(r.all).toMatch(/01-login\.md: shape: stories/)
  expect(r.all).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4', () => {
  setup()
  writers({
    '01-a.md': ticket({ title: 'a', cites: 'auth-session', stories: null }),
    '02-b.md': ticket({ title: 'b', cites: 'auth-session, auth-login' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth-login', blocked: '1, 2' }),
  })
  const r = p.w('plan', 'auth')
  console.log('82.4:', r.code, r.all)
  expect(columnOf('a')).toBeUndefined()
  expect(columnOf('c')).toBe('blocked')
  expect(columnOf('b')).toBe('ready')
})

test('82.5', () => {
  setup()
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session, auth-login', stories: '1' }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth-login', stories: '2' }),
  })
  expect(p.w('plan', 'auth').code).toBe(0)
  expect(columnOf('login')).toBe('ready')
  expect(columnOf('logout')).toBe('ready')
  writers({ '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session, auth-login', stories: '1, 2' }) })
  const r = p.w('plan', 'auth')
  console.log('82.5 second plan:', r.code, r.all)
  const archived = boardLog().find((e) => e.type === 'ticket.archived')
  console.log('82.5 archived:', JSON.stringify(archived))
  expect(archived).toMatchObject({ payload: { number: 2 } })
  expect((archived as { payload: { reason: string } }).payload.reason).toMatch(/no longer needs/)
  expect(['ready', 'blocked']).toContain(columnOf('login'))
  expect(columnOf('logout')).toBeUndefined()
  // The person restores logout. Look for a verb that does it.
  const help = p.w('help').stdout
  const restore = p.w('restore', '2')
  console.log('82.5 restore:', restore.code, restore.all.trim(), '| help has restore:', /restore/.test(help))
  expect(restore.code).toBe(0)
  expect(['ready', 'blocked']).toContain(columnOf('logout'))
})
