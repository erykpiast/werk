/** Held-out steps 80.x (ticket check) and 82.x (plan). Prefix s80. */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event } from '../src/map/events.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites?: string; blocked_by?: string; stories?: string; touches?: string; what?: string }

const ticket = (t: T): string =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites ?? ''}`,
    `blocked_by: ${t.blocked_by ?? ''}`,
    `stories: ${t.stories ?? ''}`,
    `touches: ${t.touches ?? 'map view'}`,
    '',
    '## What to build',
    '',
    t.what ?? `A person does the thing that "${t.title}" names.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The thing works for a person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const spec = (n: number) =>
  ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`), ''].join(
    '\n',
  )

function writeLog(dir: string, events: Parameters<typeof logOf>) {
  mkdirSync(join(dir, '.werk'), { recursive: true })
  writeFileSync(join(dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
}

const failureLines = (stdout: string) => stdout.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

// ---------------------------------------------------------------- 80.x
describe('80 ticket check', () => {
  /** Root "map" is real but open; its decided cards are the given children. */
  function mapProject(decided: string[]) {
    p = makeProject()
    writeLog(p.dir, [
      proposed('map', { status: 'open' }),
      accepted('map'),
      ...decided.flatMap((id) => [proposed(id, { status: 'decided', parent: 'map' }), accepted(id)]),
    ])
  }
  const writeFolder = (files: Record<string, string>, stories = 3) => {
    mkdirSync(join(p.dir, 'tickets'), { recursive: true })
    writeFileSync(join(p.dir, 'spec.md'), spec(stories))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, 'tickets', name), text)
  }
  const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])

  test('80.1 a folder of valid tickets passes', () => {
    mapProject(['map-reopen', 'map-stale'])
    writeFolder({
      '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
      '02-stale.md': ticket({ title: 'Stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }),
    })
    const r = check()
    console.log('80.1', r)
    expect(failureLines(r.stdout)).toEqual([])
    expect(r.stdout).toContain('0 failure(s) in all')
    expect(r.code).toBe(0)
  })

  test('80.2 own checks fail by name', () => {
    mapProject(['map-reopen', 'map-stale'])
    const t1 = ticket({ title: 'One', cites: 'map-reopen', stories: '1', touches: 'map view' })
    const t2 = ticket({ title: 'Two', cites: 'map-stale', stories: '2', touches: 'decision log' })
    const t3 = ticket({ title: 'Three', blocked_by: '1', stories: '3', touches: 'fold' })
    writeFolder({ '01-one.md': t1, '02-two.md': t2, '03-three.md': t3 })
    const base = check()
    expect(base.code).toBe(0)

    const t3new = t3.replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n')
    const pathLine = t3new.split('\n').indexOf('edit src/loop.ts') + 1
    writeFolder({
      '01-one.md': t1.replace('touches: map view', 'touches: map view, server/routes'),
      '02-two.md': t2.replace(/^touches:.*\n/m, ''),
      '03-three.md': t3new,
    })
    const r = check()
    console.log('80.2', r)
    const lines = failureLines(r.stdout)
    expect(lines).toContain('02-two.md: shape: touches: the header line "touches:" is missing')
    expect(lines).toContain(`03-three.md: no-file-paths: What to build: line ${pathLine} names the file path "src/loop.ts"`)
    expect(lines.some((l) => l.startsWith('01-one.md: touches: touches:') && l.includes('server/routes'))).toBe(true)
    expect(r.code).not.toBe(0)
  })

  test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
    mapProject(['map-reopen', 'map-stale'])
    const files = {
      '01-one.md': ticket({ title: 'One', cites: 'map-reopen', stories: '1' }),
      '02-two.md': ticket({ title: 'Two', cites: 'map-stale', stories: '3' }),
      '03-three.md': ticket({ title: 'Three', stories: '2' }),
      '04-four.md': ticket({ title: 'Four', blocked_by: '2', stories: '2' }),
    }
    writeFolder(files)
    expect(check().code).toBe(0)
    writeFolder({ ...files, '02-two.md': files['02-two.md'].replace('## What to build\n', '') })
    const r = check()
    console.log('80.3', r)
    const lines = failureLines(r.stdout)
    expect(lines).toContain('02-two.md: shape: What to build: the heading "## What to build" is missing')
    expect(lines).toContain('ticket set: cards-cited: cites: no ticket cites the decided card #map-stale')
    expect(lines).toContain('ticket set: stories: stories: no ticket delivers story 3')
    expect(lines).toContain('04-four.md: blocked_by: blocked_by: blocker 2 is not a ticket in the set')
    expect(r.code).not.toBe(0)
  })

  test('80.4 coverage and order errors name each card, story and ticket', () => {
    mapProject(['map-reopen', 'map-stale'])
    writeFolder(
      {
        '01-one.md': ticket({ title: 'One', cites: 'map-stale', stories: '1, 9' }),
        '02-two.md': ticket({ title: 'Two', blocked_by: '3', stories: '2' }),
        '03-three.md': ticket({ title: 'Three', blocked_by: '2', stories: '3' }),
        '04-four.md': ticket({ title: 'Four', stories: '1' }),
        '05-five.md': ticket({ title: 'Five', blocked_by: '8', stories: '2' }),
      },
      4,
    )
    const r = check()
    console.log('80.4', r)
    const lines = failureLines(r.stdout)
    expect(lines).toContain('ticket set: cards-cited: cites: no ticket cites the decided card #map-reopen')
    expect(lines).toContain('ticket set: stories: stories: no ticket delivers story 4')
    expect(lines).toContain('ticket set: stories: stories: story 9 is listed, but the spec has no story 9')
    expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
    expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
    expect(lines).toContain('05-five.md: blocked_by: blocked_by: blocker 8 is not a ticket in the set')
    expect(lines.filter((l) => /^0[14]-\w+\.md: blocked_by:/.test(l))).toEqual([])
    expect(r.code).not.toBe(0)
  })

  test('80.5 a fix to a ticket makes the next check pass', () => {
    mapProject(['map-reopen', 'map-stale'])
    writeFolder({
      '01-one.md': ticket({ title: 'One', cites: 'map-reopen', stories: '1' }),
      '02-two.md': ticket({ title: 'Two', cites: 'map-stale', stories: '2' }),
    })
    const first = check()
    expect(failureLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
    expect(first.code).not.toBe(0)
    // The agent edits ticket 2 on the person's request.
    const path = join(p.dir, 'tickets', '02-two.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('stories: 2', 'stories: 2, 3'))
    const r = check()
    console.log('80.5', r)
    expect(failureLines(r.stdout)).toEqual([])
    expect(r.code).toBe(0)
  })
})

// ---------------------------------------------------------------- 82.x
describe('82 plan', () => {
  const PLAN = '.werk/plans/auth'
  const answer = (slug: string) => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
  const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

  function authProject(extra: Parameters<typeof logOf> = []) {
    p = makeProject()
    writeLog(p.dir, [
      proposed('auth', { status: 'decided', who: 'you' }),
      proposed('auth-session', { status: 'decided', parent: 'auth' }),
      accepted('auth-session'),
      ...extra,
    ])
  }
  function writers(tickets: Record<string, string>, specAnswers: unknown[] = [], ticketAnswers: unknown[] = []) {
    p.scriptAgent({
      steps: [],
      roles: {
        'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec(3)), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
        'ticket-writer': {
          steps: [
            ...Object.entries(tickets).map(([n, t]) => edit(`${PLAN}/tickets/${n}`, t)),
            edit(`${PLAN}/tickets.answers.json`, JSON.stringify(ticketAnswers)),
          ],
        },
      },
    })
  }
  const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
  const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
  const board = () => foldBoard(boardLog())
  const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name
  const openTitles = () =>
    board()
      .columns.filter((c) => c.name === 'ready' || c.name === 'blocked')
      .flatMap((c) => c.tickets.map((t) => t.title))

  const LOGIN = ticket({ title: 'login', cites: 'auth, auth-session', stories: '1, 2', touches: 'session store' })
  const LOGOUT = ticket({ title: 'logout', cites: 'auth', blocked_by: '1', stories: '3', touches: 'session store' })

  test('82.1 plan records a feature run, writes spec and tickets, proposes answers as ghosts', () => {
    authProject()
    writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, [answer('token-ttl')], [answer('split-login')])
    const r = p.werk(['plan', 'auth'])
    console.log('82.1', r)
    expect(boardLog()[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
    const all = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
    expect(all.toSorted()).toEqual(['login', 'logout'])
    for (const slug of ['token-ttl', 'split-login']) {
      const s = p.werk(['show', `auth-${slug}`])
      console.log('82.1 show', s.stdout)
      expect(s.code).toBe(0)
      expect(s.stdout).toContain('state: ghost')
      expect(s.stdout).toContain('parent: #auth')
      expect(s.stdout).toContain('who: me')
      expect(s.stdout).toContain(`Title ${slug}`)
      expect(s.stdout).toContain(`why: Why ${slug}?`)
      expect(s.stdout).toContain(`Body of ${slug}.`)
    }
    expect(r.code).toBe(0)
  })

  test('82.2 an answer id already in the map stops the plan with an error', () => {
    authProject([proposed('auth-token-ttl', { status: 'open', parent: 'auth' }), accepted('auth-token-ttl')])
    writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, [answer('token-ttl')])
    const r = p.werk(['plan', 'auth'])
    console.log('82.2', r)
    expect(r.code).not.toBe(0)
    expect(r.stdout + r.stderr).toContain('token-ttl')
    const proposals = mapLog().filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
    expect(proposals).toHaveLength(1)
  })

  test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
    authProject()
    writers({
      '01-login.md': LOGIN.replace(/^stories:.*\n/m, ''),
      '02-logout.md': ticket({ title: 'logout', cites: 'auth', stories: '1, 2, 3', touches: 'session store' }),
    })
    const r = p.werk(['plan', 'auth'])
    console.log('82.3', r)
    const all = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
    expect(all).toContain('logout')
    expect(all).not.toContain('login')
    expect(r.stdout).toContain('01-login.md: shape: stories: the header line "stories:" is missing')
    expect(r.stdout).toContain('no ticket cites the decided card #auth-session')
  })

  test('82.4 a ticket blocked by a failed ticket is blocked, its good blocker goes to ready', () => {
    authProject()
    writers({
      '01-a.md': ticket({ title: 'a', cites: 'auth-session', stories: '1' }).replace(/^touches:.*\n/m, ''),
      '02-b.md': ticket({ title: 'b', cites: 'auth', stories: '2' }),
      '03-c.md': ticket({ title: 'c', cites: 'auth', blocked_by: '1, 2', stories: '3' }),
    })
    const r = p.werk(['plan', 'auth'])
    console.log('82.4', r)
    const all = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
    expect(all).not.toContain('a')
    expect(columnOf('c')).toBe('blocked')
    expect(columnOf('b')).toBe('ready')
  })

  test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
    authProject()
    writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT })
    const first = p.werk(['plan', 'auth'])
    console.log('82.5 first', first)
    expect(openTitles().toSorted()).toEqual(['login', 'logout'])

    writers({ '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session', stories: '1, 2, 3', touches: 'session store' }) })
    const second = p.werk(['plan', 'auth'])
    console.log('82.5 second', second)
    const archived = boardLog().filter((e) => e.type === 'ticket.archived')
    expect(archived).toHaveLength(1)
    expect(archived[0]).toMatchObject({ payload: { number: 2 } })
    expect((archived[0]!.payload as { reason: string }).reason).toContain('no longer needs it')
    expect(openTitles()).toContain('login')
    expect(openTitles()).not.toContain('logout')

    const restore = p.werk(['ticket', 'restore', '2'])
    console.log('82.5 restore', restore)
    expect(restore.code).toBe(0)
    expect(openTitles()).toContain('logout')
  })
})
