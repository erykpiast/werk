/** Held-out steps 82.1 (command-line part) to 82.5: the plan verb with fake writers. */
import { afterEach, expect, test } from 'bun:test'
import { foldBoard } from '../../src/board/fold.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { proposed } from '../../src/test/map-events.ts'
import { boardLog, boardTickets, GOOD_TICKETS, mapLog, scriptWriters, seedMap, ticketText } from './plan-helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const answer = (slug: string) => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })

test('82.1 a plan records a feature run, puts two tickets on the board, and proposes the answers as ghosts', () => {
  p = makeProject()
  seedMap(p)
  scriptWriters(p.scriptAgent as never, GOOD_TICKETS, { spec: [answer('token-ttl')], tickets: [answer('split-login')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).toBe(0)

  // The first event of the run in the log is a tier event with the tier "feature".
  expect(boardLog(p.dir)[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  // The board shows the two tickets.
  expect(boardTickets(p.dir).map((t) => t.title).toSorted()).toEqual(['login', 'logout'])

  for (const slug of ['token-ttl', 'split-login']) {
    const show = p.werk(['show', `auth-${slug}`])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain('state: ghost')
    expect(show.stdout).toContain('parent: #auth')
    expect(show.stdout).toContain('who: me')
    expect(show.stdout).toContain(`Title ${slug}`)
    expect(show.stdout).toContain(`Why ${slug}?`)
    expect(show.stdout).toContain(`Body of ${slug}.`)
    const ev = mapLog(p.dir).find((e) => e.type === 'node.proposed' && e.payload.id === `auth-${slug}`)!
    expect(ev.actor).toBe('agent')
  }
})

test('82.2 a plan stops with an error when an answer record has an id already in the map', () => {
  p = makeProject()
  seedMap(p, [proposed('auth-token-ttl', { parent: 'auth', title: 'Existing token ttl' })])
  scriptWriters(p.scriptAgent as never, GOOD_TICKETS, { spec: [answer('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog(p.dir).filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  expect(p.werk(['show', 'auth-token-ttl']).stdout).toContain('Existing token ttl')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  p = makeProject()
  seedMap(p)
  scriptWriters(p.scriptAgent as never, {
    '01-login.md': ticketText({ title: 'login', cites: 'auth-session', stories: null }),
    '02-logout.md': ticketText({ title: 'logout', cites: 'auth-logout, #auth', stories: '1, 2', touches: 'logout flow' }),
  })
  const r = p.werk(['plan', 'auth'])
  const out = r.stdout + r.stderr
  const titles = boardTickets(p.dir).map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  expect(out).toMatch(/01-login\.md.*stories/)
  expect(out).toContain('#auth-session')
  expect(out).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its good blocker goes to ready', () => {
  p = makeProject()
  seedMap(p)
  scriptWriters(p.scriptAgent as never, {
    '01-a.md': ticketText({ title: 'a', cites: 'auth-session', stories: '1', touches: '' }),
    '02-b.md': ticketText({ title: 'b', cites: 'auth-session, #auth', stories: '1' }),
    '03-c.md': ticketText({ title: 'c', cites: 'auth-logout', blockedBy: '1, 2', stories: '2', touches: 'logout flow' }),
  })
  p.werk(['plan', 'auth'])
  const tickets = boardTickets(p.dir)
  expect(tickets.find((t) => t.title === 'a')).toBeUndefined()
  expect(tickets.find((t) => t.title === 'c')?.column).toBe('blocked')
  expect(tickets.find((t) => t.title === 'b')?.column).toBe('ready')
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
  p = makeProject()
  seedMap(p)
  scriptWriters(p.scriptAgent as never, GOOD_TICKETS)
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(boardTickets(p.dir).map((t) => t.title).toSorted()).toEqual(['login', 'logout'])

  scriptWriters(p.scriptAgent as never, {
    '01-login.md': ticketText({ title: 'login', cites: 'auth-session, auth-logout, #auth', stories: '1, 2' }),
  })
  p.werk(['plan', 'auth'])
  const archived = boardLog(p.dir).find((e) => e.type === 'ticket.archived')
  expect(archived).toMatchObject({ payload: { number: 2 } })
  expect((archived!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  const open = boardTickets(p.dir)
  expect(open.find((t) => t.title === 'login')?.column).toMatch(/blocked|ready|building|merging/)
  expect(open.find((t) => t.title === 'logout')).toBeUndefined()
  expect(foldBoard(boardLog(p.dir)).archived.length).toBe(1)

  const r = p.werk(['ticket', 'restore', '2'])
  expect(r.code).toBe(0)
  expect(boardTickets(p.dir).find((t) => t.title === 'logout')?.column).toMatch(/blocked|ready/)
})
