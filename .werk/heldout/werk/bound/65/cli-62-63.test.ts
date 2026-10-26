import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { decidedCard, findTree, project, realCard, staleEntries, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const expectAppendedOne = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = project()
  p.writeLog([...realCard('root', 'The root'), { type: 'note.said', payload: { id: 'root', text: 'hello' } }])
  const before = p.lines()
  const add = p.werk(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const afterAdd = p.lines()
  expectAppendedOne(before, afterAdd)

  const show = p.show('c1')
  expect(show.code).toBe(0)
  expect(show.stdout).toContain('Use a log')
  expect(show.stdout).toContain('The body text')
  expect(show.stdout).toContain('The why text')
  expect(show.stdout).toMatch(/ghost/)

  const acc = p.werk(['accept', 'c1', '--actor', 'you'])
  expect(acc.code).toBe(0)
  expectAppendedOne(afterAdd, p.lines())
  const show2 = p.show('c1').stdout
  expect(show2).toContain('Use a log')
  expect(show2).toContain('The body text')
  expect(show2).toContain('The why text')
  expect(show2).toContain('state: real')
  expect(show2).not.toMatch(/ghost/)
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = project()
  expect(p.werk(['add', 'c1', '--title', 'A card']).code).toBe(0)
  const before = p.lines()
  const acc = p.werk(['accept', 'c1'])
  expect(acc.code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.show('c1').stdout).toMatch(/ghost/)
  expect(p.werk(['accept', 'c1', '--actor', 'you']).code).toBe(0)
  expect(p.show('c1').stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = project()
  expect(p.werk(['add', 'c1', '--title', 'Use a log']).code).toBe(0)
  let before = p.lines()
  expect(p.werk(['edit', 'c1', '--body', 'new body']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.werk(['retitle', 'c1', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.werk(['add', 'c1', '--title', 'Another title']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  const show = p.show('c1').stdout
  expect(show).toContain('Use a log')
  expect(show).toMatch(/ghost/)
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = project()
  expect(p.werk(['add', 'c1', '--title', 'Use a log']).code).toBe(0)
  expect(p.werk(['accept', 'c1', '--actor', 'you']).code).toBe(0)
  const before = p.lines()
  expect(p.werk(['retitle', 'c1', '--title', 'Use an append-only log']).code).toBe(0)
  const after = p.lines()
  expectAppendedOne(before, after)
  const show = p.show('c1').stdout
  expect(show).toContain('Use an append-only log')
  expect(show).not.toContain('Use a log')
  const log = readFileSync(p.logPath, 'utf8').split('\n')
  const oldLine = log.findIndex((l) => l.includes('"Use a log"'))
  const newLine = log.findIndex((l) => l.includes('"Use an append-only log"'))
  expect(oldLine).toBeGreaterThanOrEqual(0)
  expect(oldLine).toBeLessThan(newLine)
  expect(p.werk(['edit', 'c1', '--body', 'A brand new body']).code).toBe(0)
  const show2 = p.show('c1').stdout
  expect(show2).toContain('A brand new body')
  expect(show2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = project()
  p.writeLog(realCard('r', 'The real card'))
  const adds: [string, string[], string[]][] = [
    ['o1', ['--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy', '--parent', 'r'], ['Use Postgres', 'Too heavy']],
    ['s1', ['--kind', 'source', '--title', 'Benchmark notes', '--body', 'source body'], ['Benchmark notes', 'source body']],
    ['e1', ['--kind', 'excerpt', '--title', 'a quoted line', '--body', 'excerpt body'], ['a quoted line', 'excerpt body']],
  ]
  for (const [id, args] of adds) {
    const before = p.lines()
    const r = p.werk(['add', id, ...args])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    expectAppendedOne(before, p.lines())
  }
  for (const [id, , fields] of adds) {
    const show = p.show(id).stdout
    for (const f of fields) expect(show).toContain(f)
    expect(show).toMatch(/ghost/)
  }
  expect(p.werk(['accept', 'o1', '--actor', 'you']).code).toBe(0)
  const o = p.show('o1').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('why-not: Too heavy')
  expect(p.show('s1').stdout).toMatch(/ghost/)
  expect(p.show('e1').stdout).toMatch(/ghost/)
})

test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  p = project()
  p.writeLog(realCard('storage', 'Storage'))
  expect(p.werk(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage']).code).toBe(0)
  expect(p.werk(['link', 'sqlite', 'storage', '--type', 'depends_on']).code).toBe(0)
  expect(p.show('sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const storageLinks = p.show('storage').stdout.split('\n').filter((l) => l.startsWith('link: depends_on <- #sqlite'))
  expect(storageLinks.filter((l) => !l.includes('(held)'))).toEqual([])
  expect(p.werk(['accept', 'sqlite', '--actor', 'you']).code).toBe(0)
  const show = p.show('sqlite').stdout.split('\n')
  expect(show).toContain('link: depends_on -> #storage')
  const linkEvents = p.events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage')
  expect(linkEvents.length).toBe(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = project()
  p.writeLog(realCard('platform', 'Platform'))
  expect(p.werk(['add', 'auth', '--title', 'Auth', '--parent', 'platform']).code).toBe(0)
  expect(p.werk(['add', 'magic', '--title', 'Magic links', '--parent', 'auth']).code).toBe(0)
  expect(p.werk(['add', 'email', '--title', 'Email service', '--parent', 'platform']).code).toBe(0)
  expect(p.werk(['link', 'magic', 'email', '--type', 'depends_on']).code).toBe(0)
  expect(p.werk(['accept', 'magic', '--actor', 'you']).code).toBe(0)
  expect(p.show('magic').stdout).toContain('state: real')
  const auth = p.show('auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(p.show('email').stdout).toMatch(/ghost/)
  expect(p.show('magic').stdout).toContain('link: depends_on -> #email (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = project()
  p.writeLog(decidedCard('storage', { title: 'Storage' }))
  const ok = (args: string[]) => {
    const r = p.werk(args)
    expect({ args, code: r.code, err: r.stderr }).toMatchObject({ code: 0 })
    return r
  }
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy for one user'])
  ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // Binder setup: the contract needs a kill criterion before a decide.
  ok(['kill', 'sqlite', '--form', 'manual', '--text', 'use it for a week'])
  ok(['edit', 'sqlite', '--who', 'you'])
  ok(['status', 'sqlite', 'decided'])
  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = p.show('sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const pg = p.show('pg').stdout
  expect(pg).toContain('state: real')
  expect(pg).toContain('why-not: Too heavy for one user')
  const b = p.show('bench').stdout.split('\n')
  expect(b).toContain('state: real')
  expect(b).toContain('link: supported_by <- #sqlite')
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  p = project()
  p.writeLog(realCard('platform', 'Platform'))
  expect(p.werk(['add', 'auth', '--title', 'Auth', '--parent', 'platform']).code).toBe(0)
  expect(p.werk(['add', 'magic', '--title', 'Magic links', '--parent', 'auth']).code).toBe(0)
  expect(p.werk(['add', 'pw', '--kind', 'option', '--title', 'Passwords']).code).toBe(0)
  expect(p.werk(['link', 'pw', 'magic', '--type', 'alternative_to']).code).toBe(0)
  expect(p.werk(['discard', 'auth']).code).toBe(0)
  for (const id of ['auth', 'magic', 'pw']) {
    expect(p.show(id).code).not.toBe(0)
    expect(findTree(p.tree(), id)).toBeUndefined()
  }
  expect(p.show('platform').stdout).toContain('state: real')
  const platform = findTree(p.tree(), 'platform')!
  expect(platform.node.proposed).toBe(false)
  expect(platform.children.filter((c) => c.node.proposed)).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = project()
  p.writeLog([
    ...decidedCard('storage', { title: 'Storage' }),
    ...decidedCard('child', { parent: 'storage', who: 'you' }).map((e) =>
      e.type === 'node.status_set' ? { ...e, payload: { ...e.payload, unchallenged: true as const } } : e,
    ),
  ])
  const rollupOf = () => p.show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(before).toContain('1 unchallenged')
  const marked = () => staleEntries(p.werk(['stale']).stdout).filter((e) => e.id === 'storage')
  expect(marked()).toEqual([])

  const ok = (args: string[]) => expect({ args, ...p.werk(args) }).toMatchObject({ code: 0 })
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy'])
  ok(['link', 'opt', 'sqlite', '--type', 'alternative_to'])
  ok(['edit', 'sqlite', '--who', 'you'])
  ok(['kill', 'sqlite', '--form', 'revisit'])
  ok(['status', 'sqlite', 'decided'])
  expect(rollupOf()).toBe(before)
  expect(marked()).toEqual([])
  ok(['accept', 'sqlite', '--actor', 'you'])
  const after = rollupOf()!
  expect(after).toMatch(/rollup: 3 cards/)
  expect(after).toMatch(/3 decided/)
})
