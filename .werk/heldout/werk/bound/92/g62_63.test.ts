/** Held-out steps 62.x and 63.x: ghosts, accept, held links, discard, counts. */
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

const project = () => {
  const p = makeProject()
  cleanups.push(p.cleanup)
  return p
}
const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const lines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])
const events = (p: Project) => lines(p).map((l) => JSON.parse(l))
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}
const state = (p: Project) => fold(readLog(logFile(p)))
/** Checks that a command added exactly one line at the end and left earlier lines alone. */
const appendsOne = (p: Project, args: string[]) => {
  const before = lines(p)
  const r = ok(p, args)
  const after = lines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
const appendsNone = (p: Project, args: string[]) => {
  const before = lines(p)
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  return r
}
const real = (p: Project, id: string, title: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', title, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}
/** A real decided card: decider agent, no basis by a written reason, a kill criterion. */
const realDecided = (p: Project, id: string, title: string, extra: string[] = []) => {
  real(p, id, title, extra)
  ok(p, ['edit', id, '--who', 'agent'])
  if (!extra.includes('--parent')) ok(p, ['edit', id, '--no-basis', 'a root'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}

test('62.1 an agent proposes a card and a person accepts it', () => {
  const p = project()
  real(p, 'seed', 'Seed card')
  ok(p, ['say', 'seed', '--text', 'a note'])
  const add = appendsOne(p, ['add', 'log', '--title', 'Use a log', '--body', 'Append only', '--why', 'Keeps history'])
  expect(add.stdout).toContain('proposed')
  const ghost = ok(p, ['show', 'log']).stdout
  expect(ghost).toContain('Use a log')
  expect(ghost).toContain('Append only')
  expect(ghost).toContain('Keeps history')
  expect(ghost).toMatch(/ghost/)
  appendsOne(p, ['accept', 'log', '--actor', 'you'])
  const shown = ok(p, ['show', 'log']).stdout
  expect(shown).toContain('Use a log')
  expect(shown).toContain('Append only')
  expect(shown).toContain('Keeps history')
  expect(shown).toContain('state: real')
  expect(shown).not.toMatch(/ghost/)
})

test('62.2 an accept without the claim refuses and leaves the ghost', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  appendsNone(p, ['accept', 'log'])
  expect(ok(p, ['show', 'log']).stdout).toMatch(/ghost/)
  ok(p, ['accept', 'log', '--actor', 'you'])
  expect(ok(p, ['show', 'log']).stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  appendsNone(p, ['edit', 'log', '--body', 'New body'])
  appendsNone(p, ['retitle', 'log', '--title', 'Use an append-only log'])
  appendsNone(p, ['add', 'log', '--title', 'Other title'])
  const shown = ok(p, ['show', 'log']).stdout
  expect(shown).toContain('#log  Use a log')
  expect(shown).toMatch(/ghost/)
})

test('62.4 a retitle on a real card keeps the old title in the log', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  ok(p, ['accept', 'log', '--actor', 'you'])
  const before = lines(p)
  appendsOne(p, ['retitle', 'log', '--title', 'Use an append-only log'])
  const shown = ok(p, ['show', 'log']).stdout
  expect(shown).toContain('Use an append-only log')
  expect(shown).not.toMatch(/Use a log(?!\w)/)
  expect(shown.replaceAll('Use an append-only log', '')).not.toContain('Use a log')
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true)
  expect(lines(p).slice(0, before.length)).toEqual(before)
  ok(p, ['edit', 'log', '--body', 'The new body'])
  const after = ok(p, ['show', 'log']).stdout
  expect(after).toContain('The new body')
  expect(after).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt enter as ghosts', () => {
  const p = project()
  real(p, 'card', 'A real card')
  for (const [id, kind, extra] of [
    ['opt', 'option', ['--why-not', 'Too slow']],
    ['src', 'source', ['--body', 'Source body']],
    ['exc', 'excerpt', ['--body', 'Excerpt body']],
  ] as const) {
    const r = appendsOne(p, ['add', id, '--kind', kind, '--title', `Title ${id}`, ...extra])
    expect(r.stdout).toContain('proposed')
  }
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  const opt = ok(p, ['show', 'opt']).stdout
  expect(opt).toContain('Title opt')
  expect(opt).toContain('Too slow')
  expect(opt).toMatch(/ghost/)
  expect(ok(p, ['show', 'src']).stdout).toMatch(/Title src[\s\S]*ghost[\s\S]*Source body/)
  expect(ok(p, ['show', 'exc']).stdout).toMatch(/Title exc[\s\S]*ghost[\s\S]*Excerpt body/)
  ok(p, ['accept', 'opt', '--actor', 'you'])
  const accepted = ok(p, ['show', 'opt']).stdout
  expect(accepted).toContain('state: real')
  expect(accepted).toContain('why-not: Too slow')
  expect(ok(p, ['show', 'src']).stdout).toMatch(/ghost/)
  expect(ok(p, ['show', 'exc']).stdout).toMatch(/ghost/)
})

test('63.1 a link to a ghost is held and goes live on accept with no extra link event', () => {
  const p = project()
  real(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(ok(p, ['show', 'sqlite']).stdout).toContain('link: depends_on -> #storage (held)')
  expect(state(p).edges.some((e) => e.from === 'sqlite' && e.to === 'storage' && e.type === 'depends_on')).toBe(false)
  expect(ok(p, ['show', 'storage']).stdout).not.toMatch(/depends_on <- #sqlite(?! \(held\))/)
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const shown = ok(p, ['show', 'sqlite']).stdout
  expect(shown).toContain('link: depends_on -> #storage')
  expect(shown).not.toContain('(held)')
  const links = events(p).filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage')
  expect(links.length).toBe(1)
})

test('63.2 accepting a ghost child accepts its ghost parent, not a ghost it depends on', () => {
  const p = project()
  real(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  expect(ok(p, ['show', 'magic']).stdout).toContain('state: real')
  const auth = ok(p, ['show', 'auth']).stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(ok(p, ['show', 'email']).stdout).toMatch(/ghost/)
  expect(ok(p, ['show', 'magic']).stdout).toContain('link: depends_on -> #email (held)')
})

// Reading: the decide of the ghost must meet the decide contract (64.x), so the setup makes
// "Storage" decided and records a kill criterion on "Use SQLite"; the who change comes first.
test('63.3 an accept takes the card own ghost options and sources', () => {
  const p = project()
  realDecided(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'])
  ok(p, ['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  const who = p.werk(['edit', 'sqlite', '--who', 'agent'])
  const status = p.werk(['status', 'sqlite', 'decided'])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const s = ok(p, ['show', 'sqlite']).stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: agent')
  const pg = ok(p, ['show', 'pg']).stdout
  expect(pg).toContain('state: real')
  expect(pg).toContain('why-not: Needs a server')
  expect(ok(p, ['show', 'bench']).stdout).toContain('state: real')
  expect(state(p).edges.some((e) => e.from === 'sqlite' && e.to === 'bench' && e.type === 'supported_by')).toBe(true)
  expect({ who: who.code, status: status.code, err: status.stderr }).toEqual({ who: 0, status: 0, err: '' })
})

test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const p = project()
  real(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  const s = state(p)
  for (const id of ['auth', 'magic', 'pw']) {
    expect(s.nodes.has(id)).toBe(false)
    expect(p.werk(['show', id]).code).not.toBe(0)
  }
  expect(ok(p, ['show', 'platform']).stdout).toContain('state: real')
  const ghostChildren = [...s.edges, ...s.ghostEdges].filter((e) => e.type === 'refines' && e.to === 'platform')
  expect(ghostChildren).toEqual([])
})

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  const p = project()
  realDecided(p, 'storage', 'Storage')
  realDecided(p, 'child', 'Child', ['--parent', 'storage'])
  const rollupOf = () => ok(p, ['show', 'storage']).stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(ok(p, ['stale']).stdout).toContain('nothing is marked')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['edit', 'sqlite', '--who', 'agent'])
  ok(p, ['kill', 'sqlite', '--form', 'revisit'])
  ok(p, ['status', 'sqlite', 'decided'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'An option', '--why-not', 'No'])
  ok(p, ['link', 'opt', 'sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(ok(p, ['stale']).stdout).toContain('nothing is marked')
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const after = rollupOf()!
  expect(Number(/rollup: (\d+) cards/.exec(after)![1])).toBe(Number(/rollup: (\d+) cards/.exec(before!)![1]) + 1)
  expect(after).toMatch(/3 decided/)
})
