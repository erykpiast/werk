import { expect, test } from 'bun:test'
import { setup } from './helpers.ts'

/** A real card that is decided, so a card under it has a decided basis. */
const decidedReal = (h: ReturnType<typeof setup>, id: string, title: string) => {
  h.real(id, title, ['--who', 'me'])
  h.ok(['edit', id, '--no-basis', 'the root of the map'])
  h.ok(['kill', id, '--form', 'revisit'])
  h.ok(['status', id, 'decided'])
}

test('63.1 a link to a ghost is held, and goes live on accept with no extra link event', () => {
  const h = setup()
  const { p, ok, show, real, logLines } = h
  try {
    real('storage', 'Storage')
    ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(['link', 'sqlite', 'storage', '--type', 'depends_on', '--why', 'basis'])
    const s1 = show('sqlite').stdout.split('\n')
    expect(s1.some((l) => l.startsWith('link: depends_on -> #storage') && l.includes('(held)'))).toBe(true)
    const st = show('storage').stdout.split('\n')
    expect(st.some((l) => l.startsWith('link: depends_on <- #sqlite') && !l.includes('(held)'))).toBe(false)

    ok(['accept', 'sqlite', '--actor', 'you'])
    const s2 = show('sqlite').stdout.split('\n')
    expect(s2.some((l) => l.startsWith('link: depends_on -> #storage') && !l.includes('(held)'))).toBe(true)
    const links = logLines()
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
    expect(links.length).toBe(1)
  } finally {
    p.cleanup()
  }
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  const h = setup()
  const { p, ok, show, real } = h
  try {
    real('platform', 'Platform')
    ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
    ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
    ok(['link', 'magic', 'email', '--type', 'depends_on'])
    ok(['accept', 'magic', '--actor', 'you'])
    expect(show('magic').stdout).toContain('state: real')
    const auth = show('auth').stdout
    expect(auth).toContain('state: real')
    expect(auth).toContain('parent: #platform')
    expect(show('email').stdout).toContain('state: ghost')
    const m = show('magic').stdout.split('\n')
    expect(m.some((l) => l.startsWith('link: depends_on -> #email') && l.includes('(held)'))).toBe(true)
  } finally {
    p.cleanup()
  }
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  const h = setup()
  const { p, show } = h
  try {
    decidedReal(h, 'storage', 'Storage')
    h.ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    h.ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
    h.ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
    h.ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
    h.ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
    // The contract check (#64) needs a kill criterion before a decide.
    h.ok(['kill', 'sqlite', '--form', 'revisit'])
    const who = p.werk(['edit', 'sqlite', '--who', 'you'])
    const status = p.werk(['status', 'sqlite', 'decided'])
    expect({ code: who.code, err: who.stderr }).toEqual({ code: 0, err: '' })
    expect({ code: status.code, err: status.stderr }).toEqual({ code: 0, err: '' })

    h.ok(['accept', 'sqlite', '--actor', 'you'])
    const s = show('sqlite').stdout
    expect(s).toContain('state: real')
    expect(s).toContain('status: decided')
    expect(s).toContain('who: you')
    const o = show('pg').stdout
    expect(o).toContain('state: real')
    expect(o).toContain('why-not: needs a server')
    const b = show('bench').stdout
    expect(b).toContain('state: real')
    // The link from the card to the source is live, not held.
    expect(s).toContain('supported-by: #bench')
    expect(b.split('\n').some((l) => l.startsWith('link: supported_by <- #sqlite') && !l.includes('(held)'))).toBe(true)
  } finally {
    p.cleanup()
  }
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const h = setup()
  const { p, ok, show, real } = h
  try {
    real('platform', 'Platform')
    ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
    ok(['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
    ok(['link', 'passwords', 'magic', '--type', 'alternative_to'])
    ok(['discard', 'auth'])
    for (const id of ['auth', 'magic', 'passwords']) {
      const r = show(id)
      expect(r.code).not.toBe(0)
    }
    const pl = show('platform')
    expect(pl.code).toBe(0)
    expect(pl.stdout).toContain('state: real')
    for (const word of ['#auth', '#magic', '#passwords', 'Auth', 'Magic links', 'Passwords', 'held']) {
      expect(pl.stdout).not.toContain(word)
    }
  } finally {
    p.cleanup()
  }
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  const h = setup()
  const { p, ok, show } = h
  try {
    decidedReal(h, 'storage', 'Storage')
    h.real('cache', 'Cache', ['--parent', 'storage', '--who', 'you'])
    ok(['kill', 'cache', '--form', 'revisit'])
    ok(['status', 'cache', 'decided', '--unchallenged'])
    const rollupLine = () => show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
    const before = rollupLine()
    expect(before).toBeDefined()
    expect(before).toContain('2 cards')
    expect(before).toContain('1 unchallenged')
    const staleBefore = p.werk(['stale']).stdout
    expect(staleBefore).not.toContain('storage')

    ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'you'])
    ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
    ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
    ok(['kill', 'sqlite', '--form', 'revisit'])
    ok(['status', 'sqlite', 'decided'])
    expect(rollupLine()).toBe(before)
    expect(p.werk(['stale']).stdout).not.toContain('storage')

    ok(['accept', 'sqlite', '--actor', 'you'])
    expect(rollupLine()).toContain('3 cards')
  } finally {
    p.cleanup()
  }
})
