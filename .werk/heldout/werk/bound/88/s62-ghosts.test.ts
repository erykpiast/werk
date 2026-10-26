import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(30_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

let p: Project
beforeEach(() => {
  p = makeProject()
})
afterEach(() => p.cleanup())

const logLines = () => {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}
const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} failed (${r.code}): ${r.stderr}${r.stdout}`)
  return r
}
const show = (id: string) => p.werk(['show', id])
/** Makes a real card decided, with every contract fact it needs. */
const decideReal = (id: string, noBasis: boolean) => {
  ok(['edit', id, '--who', 'you', ...(noBasis ? ['--no-basis', 'it is the root'] : [])])
  ok(['kill', id, '--form', 'manual', '--text', `revisit ${id}`])
  ok(['status', id, 'decided', '--unchallenged'])
}
/** Appends exactly one event at the end, and leaves every earlier line unchanged. */
const expectOneAppended = (before: string[]) => {
  const after = logLines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

describe('62', () => {
  test('62.1 an agent proposes a card and a person accepts it', () => {
    ok(['add', 'seed', '--title', 'Seed card'])
    ok(['accept', 'seed', '--actor', 'you'])
    ok(['say', 'seed', '--text', 'a note'])
    const before = logLines()
    expect(before.length).toBeGreaterThan(0)

    const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'Append events to a file.', '--why', 'It keeps history.'])
    expect(add.code).toBe(0)
    expect(add.stdout).toContain('proposed')
    expectOneAppended(before)

    const s1 = show('use-log')
    expect(s1.code).toBe(0)
    expect(s1.stdout).toContain('Use a log')
    expect(s1.stdout).toContain('Append events to a file.')
    expect(s1.stdout).toContain('It keeps history.')
    expect(s1.stdout).toMatch(/ghost/)

    const before2 = logLines()
    const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
    expect(acc.code).toBe(0)
    expectOneAppended(before2)

    const s2 = show('use-log')
    expect(s2.stdout).toContain('Use a log')
    expect(s2.stdout).toContain('Append events to a file.')
    expect(s2.stdout).toContain('It keeps history.')
    expect(s2.stdout).toContain('state: real')
    expect(s2.stdout).not.toMatch(/ghost/)
  })

  test('62.2 an accept without the claim refuses', () => {
    ok(['add', 'c', '--title', 'A card', '--why', 'because'])
    const before = logLines()
    const r = p.werk(['accept', 'c'])
    expect(r.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    expect(show('c').stdout).toMatch(/ghost/)
    const r2 = p.werk(['accept', 'c', '--actor', 'you'])
    expect(r2.code).toBe(0)
    expect(show('c').stdout).toContain('state: real')
    expect(show('c').stdout).not.toMatch(/ghost/)
  })

  test('62.3 the words of a ghost are frozen', () => {
    ok(['add', 'c', '--title', 'Use a log', '--body', 'old body'])
    let before = logLines()
    const e = p.werk(['edit', 'c', '--body', 'new body'])
    expect(e.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    before = logLines()
    const t = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
    expect(t.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    before = logLines()
    const a = p.werk(['add', 'c', '--title', 'Something else'])
    expect(a.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    const s = show('c').stdout
    expect(s).toContain('Use a log')
    expect(s).not.toContain('Something else')
    expect(s).toMatch(/ghost/)
  })

  test('62.4 a retitle on a real card', () => {
    ok(['add', 'c', '--title', 'Use a log', '--body', 'old body'])
    ok(['accept', 'c', '--actor', 'you'])
    const before = logLines()
    const t = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
    expect(t.code).toBe(0)
    expectOneAppended(before)
    const s = show('c').stdout
    expect(s).toContain('Use an append-only log')
    expect(s).not.toContain('Use a log')
    const lines = logLines()
    expect(lines.slice(0, -1).some((l) => l.includes('"Use a log"'))).toBe(true)
    const e = p.werk(['edit', 'c', '--body', 'the new body'])
    expect(e.code).toBe(0)
    const s2 = show('c').stdout
    expect(s2).toContain('the new body')
    expect(s2).toContain('Use an append-only log')
  })

  test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
    ok(['add', 'card', '--title', 'Storage'])
    ok(['accept', 'card', '--actor', 'you'])
    const adds: [string, string[], string[]][] = [
      ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy', '--parent', 'card'], ['Use Postgres', 'too heavy']],
      ['src', ['add', 'src', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'numbers here'], ['Benchmark notes', 'numbers here']],
      ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'SQLite is fast enough', '--body', 'quoted text'], ['SQLite is fast enough', 'quoted text']],
    ]
    for (const [, args] of adds) {
      const before = logLines()
      const r = p.werk(args)
      expect(r.stderr).toBe('')
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('proposed')
      expectOneAppended(before)
    }
    for (const [id, , fields] of adds) {
      const s = show(id).stdout
      for (const f of fields) expect(s).toContain(f)
      expect(s).toMatch(/ghost/)
    }
    ok(['accept', 'opt', '--actor', 'you'])
    const so = show('opt').stdout
    expect(so).toContain('state: real')
    expect(so).toContain('why-not: too heavy')
    expect(show('src').stdout).toMatch(/ghost/)
    expect(show('exc').stdout).toMatch(/ghost/)
  })
})

describe('63', () => {
  test('63.1 a link to a ghost is held, and goes live on accept', () => {
    ok(['add', 'storage', '--title', 'Storage'])
    ok(['accept', 'storage', '--actor', 'you'])
    ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(['link', 'sqlite', 'storage', '--type', 'depends_on', '--why', 'basis'])
    const edgeLine = (out: string) => out.split('\n').find((l) => l.includes('depends_on') && l.includes('#storage'))
    const s1 = show('sqlite').stdout
    expect(edgeLine(s1)).toBeDefined()
    expect(edgeLine(s1)).toContain('(held)')
    const st = show('storage').stdout
    expect(st.split('\n').filter((l) => l.includes('#sqlite') && l.includes('depends_on') && !l.includes('(held)'))).toEqual([])
    ok(['accept', 'sqlite', '--actor', 'you'])
    const s2 = show('sqlite').stdout
    const live = edgeLine(s2)
    expect(live).toBeDefined()
    expect(live).not.toContain('(held)')
    const links = logLines()
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
    expect(links.length).toBe(1)
  })

  test('63.2 accepting a ghost child accepts its ghost parent, not a dependency', () => {
    ok(['add', 'platform', '--title', 'Platform'])
    ok(['accept', 'platform', '--actor', 'you'])
    ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
    ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
    ok(['link', 'magic', 'email', '--type', 'depends_on'])
    const r = p.werk(['accept', 'magic', '--actor', 'you'])
    expect(r.code).toBe(0)
    expect(show('magic').stdout).toContain('state: real')
    const a = show('auth').stdout
    expect(a).toContain('state: real')
    expect(a).toContain('parent: #platform')
    expect(show('email').stdout).toMatch(/ghost/)
    const dep = show('magic').stdout.split('\n').find((l) => l.includes('depends_on') && l.includes('#email'))
    expect(dep).toBeDefined()
    expect(dep).toContain('(held)')
  })

  test('63.3 an accept takes the card own ghost options and sources', () => {
    ok(['add', 'storage', '--title', 'Storage'])
    ok(['accept', 'storage', '--actor', 'you'])
    decideReal('storage', true)
    ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy'])
    ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
    ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
    ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
    ok(['kill', 'sqlite', '--form', 'manual', '--text', 'revisit sqlite'])
    const who = p.werk(['edit', 'sqlite', '--who', 'alice'])
    const st = p.werk(['status', 'sqlite', 'decided'])
    const acc = p.werk(['accept', 'sqlite', '--actor', 'you'])
    expect({ status: st.code, statusErr: st.stderr, who: who.code, whoErr: who.stderr }).toEqual({ status: 0, statusErr: '', who: 0, whoErr: '' })
    expect(acc.code).toBe(0)
    const s = show('sqlite').stdout
    expect(s).toContain('state: real')
    expect(s).toContain('status: decided')
    expect(s).toContain('who: alice')
    const o = show('pg').stdout
    expect(o).toContain('state: real')
    expect(o).toContain('kind: option')
    expect(o).toContain('why-not: too heavy')
    const b = show('bench').stdout
    expect(b).toContain('state: real')
    expect(b).toContain('kind: source')
    expect(s).toContain('supported-by: #bench')
    expect(s).not.toContain('(held)')
  })

  test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
    ok(['add', 'platform', '--title', 'Platform'])
    ok(['accept', 'platform', '--actor', 'you'])
    ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
    ok(['add', 'pw', '--kind', 'option', '--title', 'Passwords', '--parent', 'magic'])
    const d = p.werk(['discard', 'auth'])
    expect(d.code).toBe(0)
    for (const id of ['auth', 'magic', 'pw']) {
      const s = show(id)
      expect(s.code).not.toBe(0)
    }
    const pl = show('platform').stdout
    expect(pl).toContain('state: real')
    for (const t of ['#auth', '#magic', '#pw', 'Auth', 'Magic links', 'Passwords']) expect(pl).not.toContain(t)
    const f = p.werk(['find']).stdout
    for (const t of ['Auth', 'Magic links', 'Passwords']) expect(f).not.toContain(t)
  })

  test('63.5 a ghost changes no count of a real card until accepted', () => {
    ok(['add', 'storage', '--title', 'Storage'])
    ok(['accept', 'storage', '--actor', 'you'])
    decideReal('storage', true)
    ok(['add', 'kid', '--title', 'Kid', '--parent', 'storage'])
    ok(['accept', 'kid', '--actor', 'you'])
    decideReal('kid', false)
    const rollupOf = () => show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
    const before = rollupOf()
    expect(before).toBeDefined()
    expect(before).toMatch(/unchallenged/)
    const stale0 = p.werk(['stale']).stdout
    expect(stale0).not.toContain('#storage')
    expect(show('storage').stdout).not.toMatch(/stale/)

    ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'alice'])
    ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy'])
    ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
    ok(['kill', 'sqlite', '--form', 'manual', '--text', 'revisit sqlite'])
    ok(['status', 'sqlite', 'decided'])
    expect(show('sqlite').stdout).toContain('status: decided')
    expect(rollupOf()).toBe(before)
    expect(p.werk(['stale']).stdout).not.toContain('#storage')
    expect(show('storage').stdout).not.toMatch(/stale/)

    ok(['accept', 'sqlite', '--actor', 'you'])
    const after = rollupOf()!
    const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
    const decided = (l: string) => Number(/(\d+) decided/.exec(l)![1])
    expect(cards(after)).toBe(cards(before!) + 1)
    expect(decided(after)).toBe(decided(before!) + 1)
  })
})
