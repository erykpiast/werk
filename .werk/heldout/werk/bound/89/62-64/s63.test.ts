import { expect, test } from 'bun:test'
import { events, fresh, ok, p, rollupOf, show } from './util.ts'

/** A real decided card, so other cards can stand on it. Set up through the CLI. */
const realDecided = (id: string, title: string) => {
  ok(['add', id, '--title', title, '--who', 'me'])
  ok(['accept', id, '--actor', 'you'])
  ok(['edit', id, '--no-basis', 'a root card'])
  ok(['kill', id, '--form', 'revisit'])
  ok(['status', id, 'decided'])
}

const linkLines = (out: string) => out.split('\n').filter((l) => l.startsWith('link: '))

// 63.1
// Scenario: A link to a ghost is held, and it goes live on accept with no extra link event
// Given a project with a real card "Storage"
// And an agent proposes a new card "Use SQLite" under "Storage"
// When the agent links "Use SQLite" to "Storage" as its basis
// Then the show output for "Use SQLite" lists that edge as held
// And the live edges of "Storage" do not include that edge
// When the person accepts "Use SQLite"
// Then the show output for "Use SQLite" lists that edge as live
// And the log holds exactly one link event for that edge
test('63.1', () => {
  fresh()
  ok(['add', 'storage', '--title', 'Storage'])
  ok(['accept', 'storage', '--actor', 'you'])
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'sqlite', 'storage', '--type', 'depends_on', '--why', 'stores in it'])

  expect(show('sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const liveOfStorage = linkLines(show('storage').stdout).filter((l) => !l.includes('(held)'))
  expect(liveOfStorage.filter((l) => l.includes('depends_on') && l.includes('#sqlite'))).toEqual([])

  ok(['accept', 'sqlite', '--actor', 'you'])
  const after = show('sqlite').stdout
  expect(after).toContain('link: depends_on -> #storage — stores in it')
  expect(after).not.toContain('(held)')
  const links = events().filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(links).toHaveLength(1)
})

// 63.2
// Scenario: Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on
// Given a project with a real card "Platform"
// And an agent proposes a ghost card "Auth" under "Platform"
// And the agent proposes a ghost card "Magic links" under "Auth"
// And the agent proposes a ghost card "Email service" under "Platform"
// And the agent links "Magic links" so that it depends on "Email service"
// When the person accepts "Magic links"
// Then "Magic links" shows as a real card
// And "Auth" shows as a real card under "Platform"
// And "Email service" still shows as a ghost
// And the depends-on edge from "Magic links" to "Email service" still shows as held
test('63.2', () => {
  fresh()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic', 'email', '--type', 'depends_on'])
  ok(['accept', 'magic', '--actor', 'you'])

  const m = show('magic').stdout
  expect(m).toContain('state: real')
  expect(m).toContain('kind: card')
  const a = show('auth').stdout
  expect(a).toContain('state: real')
  expect(a).toContain('parent: #platform')
  expect(show('email').stdout).toContain('state: ghost')
  expect(m).toContain('link: depends_on -> #email (held)')
})

// 63.3
// Scenario: An accept takes the card's own ghost options and sources with it
// Given a project with a real card "Storage"
// And an agent proposes a ghost card "Use SQLite" under "Storage"
// And the agent proposes a ghost option "Use Postgres" for "Use SQLite" with a why-not reason
// And the agent proposes a ghost source "Benchmark notes" and links it to "Use SQLite"
// And the agent sets the status of "Use SQLite" to decided and sets its who field
// When the person accepts "Use SQLite"
// Then "Use SQLite" is a real decided card with the who field the agent set
// And "Use Postgres" is a real option with its why-not reason
// And "Benchmark notes" is a real source linked to "Use SQLite" by a live edge
// And the agent got no refusal for the status change or the who change while the card was a ghost
test('63.3', () => {
  fresh()
  realDecided('storage', 'Storage')
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
  ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // The who change and the status change while "Use SQLite" is a ghost. A kill criterion is
  // also needed for the decided contract check; the agent records it first.
  const who = p.werk(['edit', 'sqlite', '--who', 'me'])
  ok(['kill', 'sqlite', '--form', 'revisit'])
  const status = p.werk(['status', 'sqlite', 'decided'])

  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = show('sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('kind: card')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: me')
  const o = show('pg').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('why-not: needs a server')
  const b = show('bench').stdout
  expect(b).toContain('state: real')
  expect(b).toContain('kind: source')
  expect(b).toContain('link: supported_by <- #sqlite')
  expect(b).not.toContain('(held)')
  expect({ code: who.code, stderr: who.stderr }).toEqual({ code: 0, stderr: '' })
  expect({ code: status.code, stderr: status.stderr }).toEqual({ code: 0, stderr: '' })
})

// 63.4
// Scenario: Discarding a ghost parent discards its whole ghost branch
// Given a project with a real card "Platform"
// And an agent proposes a ghost card "Auth" under "Platform"
// And the agent proposes a ghost card "Magic links" under "Auth"
// And the agent proposes a ghost option "Passwords" for "Magic links"
// When the person discards "Auth"
// Then "Auth", "Magic links" and "Passwords" no longer show in the map or in the show output
// And "Platform" still shows as a real card with no ghost children
test('63.4', () => {
  fresh()
  ok(['add', 'platform', '--title', 'Platform'])
  ok(['accept', 'platform', '--actor', 'you'])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(['discard', 'auth'])

  for (const id of ['auth', 'magic', 'pw']) expect({ id, code: show(id).code }).toEqual({ id, code: 1 })
  const pl = show('platform').stdout
  expect(pl).toContain('state: real')
  expect(pl).not.toContain('#auth')
  expect(pl).not.toContain('#magic')
  expect(pl).not.toContain('#pw')
  expect(pl).not.toContain('(held)')
})

// 63.5
// Scenario: A ghost changes no count of a real card until it is accepted
// Given a project with a real card "Storage" that has one real decided child
// And the person notes the rollup count and the unchallenged count of "Storage"
// And "Storage" shows no staleness mark
// When an agent proposes a ghost card "Use SQLite" under "Storage" with status decided and a ghost option
// Then the rollup count and the unchallenged count of "Storage" are the same as before
// And "Storage" still shows no staleness mark
// When the person accepts "Use SQLite"
// Then the rollup count of "Storage" includes "Use SQLite"
test('63.5', () => {
  fresh()
  realDecided('storage', 'Storage')
  ok(['add', 'files', '--title', 'Use files', '--parent', 'storage', '--who', 'me'])
  ok(['accept', 'files', '--actor', 'you'])
  ok(['kill', 'files', '--form', 'revisit'])
  ok(['status', 'files', 'decided', '--unchallenged'])

  const before = rollupOf('storage')
  expect(before).toBeDefined()
  expect(p.werk(['stale']).stdout).not.toContain('#storage')

  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
  ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(['kill', 'sqlite', '--form', 'revisit'])
  ok(['status', 'sqlite', 'decided'])
  expect(show('sqlite').stdout).toContain('state: ghost')

  const mid = rollupOf('storage')
  expect(mid?.cards).toBe(before!.cards)
  expect(mid?.unchallenged).toBe(before!.unchallenged)
  expect(mid).toEqual(before)
  expect(p.werk(['stale']).stdout).not.toContain('#storage')

  ok(['accept', 'sqlite', '--actor', 'you'])
  const after = rollupOf('storage')
  expect(after?.cards).toBe(before!.cards + 1)
  expect(after?.decided).toBe(before!.decided + 1)
})
