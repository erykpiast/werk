import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type P } from './cli-util.ts'

let p: P
afterEach(() => p?.cleanup())

/** A map whose log already holds some events, with one real card "base". */
function seeded(): P {
  p = project()
  p.ok('add', 'base', '--title', 'The base card')
  p.ok('accept', 'base', '--actor', 'you')
  p.ok('add', 'other', '--title', 'Another ghost', '--parent', 'base')
  return p
}

function expectOneMoreAtEnd(before: string[]) {
  const after = p.lines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1', () => {
  seeded()
  let before = p.lines()
  const add = p.w('add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text')
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  expectOneMoreAtEnd(before)
  let show = p.w('show', 'c1').stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('The body text')
  expect(show).toContain('The why text')
  expect(show).toMatch(/ghost/)
  before = p.lines()
  const a = p.w('accept', 'c1', '--actor', 'you')
  expect(a.code).toBe(0)
  expectOneMoreAtEnd(before)
  show = p.w('show', 'c1').stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('The body text')
  expect(show).toContain('The why text')
  expect(show).toContain('state: real')
  expect(show).not.toMatch(/ghost/)
})

test('62.2', () => {
  seeded()
  p.ok('add', 'c1', '--title', 'Use a log')
  const before = p.lines()
  const a = p.w('accept', 'c1')
  expect(a.code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.w('show', 'c1').stdout).toMatch(/ghost/)
  expect(p.w('accept', 'c1', '--actor', 'you').code).toBe(0)
  expect(p.w('show', 'c1').stdout).toContain('state: real')
})

test('62.3', () => {
  seeded()
  p.ok('add', 'c1', '--title', 'Use a log')
  let before = p.lines()
  expect(p.w('edit', 'c1', '--body', 'A new body').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.w('retitle', 'c1', '--title', 'Use an append-only log').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.w('add', 'c1', '--title', 'Something else').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  const show = p.w('show', 'c1').stdout
  expect(show).toContain('Use a log')
  expect(show).toMatch(/ghost/)
})

test('62.4', () => {
  seeded()
  p.ok('add', 'c1', '--title', 'Use a log')
  p.ok('accept', 'c1', '--actor', 'you')
  const before = p.lines()
  expect(p.w('retitle', 'c1', '--title', 'Use an append-only log').code).toBe(0)
  expectOneMoreAtEnd(before)
  let show = p.w('show', 'c1').stdout
  expect(show).toContain('Use an append-only log')
  expect(show).not.toContain('Use a log')
  const raw = readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8').split('\n')
  const at = raw.findIndex((l) => l.includes('"Use a log"'))
  expect(at).toBeGreaterThanOrEqual(0)
  expect(at).toBeLessThan(raw.length - 2)
  expect(p.w('edit', 'c1', '--body', 'The new body').code).toBe(0)
  show = p.w('show', 'c1').stdout
  expect(show).toContain('The new body')
  expect(show).toContain('Use an append-only log')
})

test('62.5', () => {
  seeded()
  const adds: [string, string[]][] = [
    ['o1', ['--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy for v0', '--parent', 'base']],
    ['s1', ['--kind', 'source', '--title', 'Benchmark notes', '--body', 'source body']],
    ['e1', ['--kind', 'excerpt', '--title', 'A quoted line', '--body', 'excerpt body']],
  ]
  for (const [id, flags] of adds) {
    const before = p.lines()
    const r = p.w('add', id, ...flags)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    expectOneMoreAtEnd(before)
  }
  const o = p.w('show', 'o1').stdout
  expect(o).toContain('Use Postgres')
  expect(o).toContain('Too heavy for v0')
  expect(o).toMatch(/ghost/)
  const s = p.w('show', 's1').stdout
  expect(s).toContain('Benchmark notes')
  expect(s).toContain('source body')
  expect(s).toMatch(/ghost/)
  const e = p.w('show', 'e1').stdout
  expect(e).toContain('A quoted line')
  expect(e).toContain('excerpt body')
  expect(e).toMatch(/ghost/)
  expect(p.w('accept', 'o1', '--actor', 'you').code).toBe(0)
  const o2 = p.w('show', 'o1').stdout
  expect(o2).toContain('state: real')
  expect(o2).toContain('why-not: Too heavy for v0')
  expect(p.w('show', 's1').stdout).toMatch(/ghost/)
  expect(p.w('show', 'e1').stdout).toMatch(/ghost/)
})

function realCard(id: string, title: string, extra: string[] = []) {
  p.ok('add', id, '--title', title, ...extra)
  p.ok('accept', id, '--actor', 'you')
}

test('63.1', () => {
  p = project()
  realCard('storage', 'Storage')
  p.ok('add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage')
  p.ok('link', 'sqlite', 'storage', '--type', 'depends_on')
  expect(p.w('show', 'sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const st = p.state()
  expect(st.edges.some((e) => e.from === 'sqlite' && e.to === 'storage' && e.type === 'depends_on')).toBe(false)
  expect(p.w('show', 'storage').stdout).not.toMatch(/link: depends_on <- #sqlite(?! \(held\))/)
  p.ok('accept', 'sqlite', '--actor', 'you')
  const show = p.w('show', 'sqlite').stdout
  expect(show).toContain('link: depends_on -> #storage')
  expect(show).not.toContain('link: depends_on -> #storage (held)')
  expect(p.log().filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage')).toHaveLength(1)
})

test('63.2', () => {
  p = project()
  realCard('platform', 'Platform')
  p.ok('add', 'auth', '--title', 'Auth', '--parent', 'platform')
  p.ok('add', 'magic', '--title', 'Magic links', '--parent', 'auth')
  p.ok('add', 'email', '--title', 'Email service', '--parent', 'platform')
  p.ok('link', 'magic', 'email', '--type', 'depends_on')
  p.ok('accept', 'magic', '--actor', 'you')
  expect(p.w('show', 'magic').stdout).toContain('state: real')
  const auth = p.w('show', 'auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(p.w('show', 'email').stdout).toMatch(/ghost/)
  expect(p.w('show', 'magic').stdout).toContain('link: depends_on -> #email (held)')
})

test('63.3', () => {
  p = project()
  realCard('storage', 'Storage')
  // Setup beyond the step: Storage is decided and the card carries a kill criterion, so the contract check (64) can pass.
  p.ok('edit', 'storage', '--who', 'me')
  p.ok('edit', 'storage', '--no-basis', 'the root')
  p.ok('kill', 'storage', '--form', 'revisit')
  p.ok('status', 'storage', 'decided')
  p.ok('add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage')
  p.ok('add', 'postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy')
  p.ok('link', 'postgres', 'sqlite', '--type', 'alternative_to')
  p.ok('add', 'bench', '--kind', 'source', '--title', 'Benchmark notes')
  p.ok('link', 'sqlite', 'bench', '--type', 'supported_by')
  p.ok('kill', 'sqlite', '--form', 'revisit')
  // The step does not fix the order. The who change goes first, since the contract check needs a decider.
  const who = p.w('edit', 'sqlite', '--who', 'you')
  const s = p.w('status', 'sqlite', 'decided')
  console.log('63.3 who:', who.code, who.all.trim(), '| status:', s.code, s.all.trim())
  expect(who.code).toBe(0)
  expect(s.code).toBe(0)
  p.ok('accept', 'sqlite', '--actor', 'you')
  const show = p.w('show', 'sqlite').stdout
  expect(show).toContain('state: real')
  expect(show).toContain('status: decided')
  expect(show).toContain('who: you')
  const opt = p.w('show', 'postgres').stdout
  expect(opt).toContain('state: real')
  expect(opt).toContain('why-not: Too heavy')
  expect(p.w('show', 'bench').stdout).toContain('state: real')
  expect(p.state().edges).toContainEqual({ from: 'sqlite', to: 'bench', type: 'supported_by' })
})

test('63.4', () => {
  p = project()
  realCard('platform', 'Platform')
  p.ok('add', 'auth', '--title', 'Auth', '--parent', 'platform')
  p.ok('add', 'magic', '--title', 'Magic links', '--parent', 'auth')
  p.ok('add', 'passwords', '--kind', 'option', '--title', 'Passwords')
  p.ok('link', 'passwords', 'magic', '--type', 'alternative_to')
  expect(p.w('discard', 'auth').code).toBe(0)
  const st = p.state()
  for (const id of ['auth', 'magic', 'passwords']) {
    expect(st.nodes.has(id)).toBe(false)
    expect(p.w('show', id).code).not.toBe(0)
  }
  expect(p.w('show', 'platform').stdout).toContain('state: real')
  expect([...st.edges, ...st.ghostEdges].filter((e) => e.type === 'refines' && e.to === 'platform')).toHaveLength(0)
})

test('63.5', () => {
  p = project()
  p.seed([
    { type: 'node.proposed', payload: { id: 'storage', kind: 'card', title: 'Storage', status: 'decided', who: 'you', unchallenged: true } },
    { type: 'node.proposed', payload: { id: 'child', kind: 'card', title: 'A decided child', status: 'decided', who: 'you', parent: 'storage' } },
    { type: 'node.status_set', payload: { id: 'child', status: 'decided', unchallenged: true } },
    { type: 'node.accepted', actor: 'you', payload: { id: 'child' } },
  ])
  const rollup = () => p.w('show', 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollup()
  console.log('63.5 rollup before:', before)
  expect(before).toBeDefined()
  expect(p.w('stale').stdout).not.toContain('#storage')
  p.ok('add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me')
  p.ok('add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy')
  p.ok('link', 'opt', 'sqlite', '--type', 'alternative_to')
  p.ok('kill', 'sqlite', '--form', 'revisit')
  p.ok('status', 'sqlite', 'decided')
  expect(rollup()).toBe(before!)
  expect(p.w('stale').stdout).not.toContain('#storage')
  p.ok('accept', 'sqlite', '--actor', 'you')
  const after = rollup()
  console.log('63.5 rollup after:', after)
  expect(Number(/rollup: (\d+) cards/.exec(after!)![1])).toBe(Number(/rollup: (\d+) cards/.exec(before!)![1]) + 1)
})
