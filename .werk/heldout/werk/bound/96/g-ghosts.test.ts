/** Held-out steps 62.x, 63.x, 64.x: ghosts, accepts, held links, the contract check, amend. */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

const lines = (p: Project) => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}
const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown>; actor: string })

const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const show = (p: Project, id: string) => p.werk(['show', id])
/** Runs a printed command in a shell, with `werk` as the project's command line. */
const runPrinted = (p: Project, cmd: string) =>
  p.run(['sh', '-c', `werk() { "${process.execPath}" "${MAIN}" "$@"; }; ${cmd}`])

/** A real card, accepted by the person. */
const real = (p: Project, id: string, title: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', title, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}
/** A real decided root card: a decider, a no-basis reason, and a kill criterion. */
const decidedRoot = (p: Project, id: string, title: string) => {
  real(p, id, title, ['--who', 'me'])
  ok(p, ['edit', id, '--no-basis', 'the root of this map'])
  ok(p, ['kill', id, '--form', 'manual', '--text', 'revisit by use'])
  ok(p, ['status', id, 'decided'])
}

// 62.1
test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  const p = makeProject()
  real(p, 'seed', 'Seed card')
  ok(p, ['add', 'other', '--title', 'Other'])
  const before = lines(p)
  expect(before.length).toBeGreaterThan(0)

  const add = p.werk(['add', 'log', '--title', 'Use a log', '--body', 'The body', '--why', 'The why'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const afterAdd = lines(p)
  expect(afterAdd).toHaveLength(before.length + 1)
  expect(afterAdd.slice(0, before.length)).toEqual(before)

  const ghost = show(p, 'log')
  expect(ghost.stdout).toContain('Use a log')
  expect(ghost.stdout).toContain('The body')
  expect(ghost.stdout).toContain('The why')
  expect(ghost.stdout).toContain('state: ghost')

  const acc = p.werk(['accept', 'log', '--actor', 'you'])
  expect(acc.code).toBe(0)
  const afterAcc = lines(p)
  expect(afterAcc).toHaveLength(afterAdd.length + 1)
  expect(afterAcc.slice(0, afterAdd.length)).toEqual(afterAdd)

  const realShow = show(p, 'log').stdout
  expect(realShow).toContain('Use a log')
  expect(realShow).toContain('The body')
  expect(realShow).toContain('The why')
  expect(realShow).toContain('state: real')
  expect(realShow).not.toContain('ghost')
})

// 62.2
test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'A card'])
  const before = lines(p)
  const r = p.werk(['accept', 'a'])
  expect(r.code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  expect(show(p, 'a').stdout).toContain('state: ghost')
  ok(p, ['accept', 'a', '--actor', 'you'])
  expect(show(p, 'a').stdout).toContain('state: real')
})

// 62.3
test('62.3 the words of a ghost are frozen', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'Use a log'])
  let before = lines(p)
  expect(p.werk(['edit', 'a', '--body', 'New body']).code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  before = lines(p)
  expect(p.werk(['retitle', 'a', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  before = lines(p)
  expect(p.werk(['add', 'a', '--title', 'Something else']).code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  const s = show(p, 'a').stdout
  expect(s).toContain('#a  Use a log')
  expect(s).toContain('state: ghost')
})

// 62.4
test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  const p = makeProject()
  ok(p, ['add', 'a', '--title', 'Use a log'])
  ok(p, ['accept', 'a', '--actor', 'you'])
  const before = lines(p)
  const r = p.werk(['retitle', 'a', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  const after = lines(p)
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  const s = show(p, 'a').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(after[0]).toContain('"Use a log"')
  ok(p, ['edit', 'a', '--body', 'Nothing is deleted.'])
  const s2 = show(p, 'a').stdout
  expect(s2).toContain('Nothing is deleted.')
  expect(s2).toContain('Use an append-only log')
})

// 62.5
test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  const p = makeProject()
  real(p, 'card', 'The card')
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'Benchmark notes']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'A quoted line']],
  ]
  for (const [, args] of adds) {
    const before = lines(p)
    const r = p.werk(args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    const after = lines(p)
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
  }
  const opt = show(p, 'opt').stdout
  expect(opt).toContain('Use Postgres')
  expect(opt).toContain('why-not: too heavy')
  expect(opt).toContain('state: ghost')
  expect(show(p, 'src').stdout).toContain('Benchmark notes')
  expect(show(p, 'src').stdout).toContain('state: ghost')
  expect(show(p, 'exc').stdout).toContain('A quoted line')
  expect(show(p, 'exc').stdout).toContain('state: ghost')

  ok(p, ['accept', 'opt', '--actor', 'you'])
  const optReal = show(p, 'opt').stdout
  expect(optReal).toContain('state: real')
  expect(optReal).toContain('why-not: too heavy')
  expect(show(p, 'src').stdout).toContain('state: ghost')
  expect(show(p, 'exc').stdout).toContain('state: ghost')
})

// 63.1
test('63.1 a link to a ghost is held, and it goes live on accept with no extra link event', () => {
  const p = makeProject()
  real(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(show(p, 'sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const storageLines = show(p, 'storage').stdout.split('\n')
  expect(storageLines.filter((l) => l.includes('depends_on <- #sqlite') && !l.includes('(held)'))).toEqual([])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const after = show(p, 'sqlite').stdout
  expect(after).toContain('link: depends_on -> #storage')
  expect(after).not.toContain('(held)')
  const linkEvents = events(p).filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(linkEvents).toHaveLength(1)
})

// 63.2
test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  const p = makeProject()
  real(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(p, ['link', 'magic', 'email', '--type', 'depends_on'])
  ok(p, ['accept', 'magic', '--actor', 'you'])
  expect(show(p, 'magic').stdout).toContain('state: real')
  const auth = show(p, 'auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(show(p, 'email').stdout).toContain('state: ghost')
  expect(show(p, 'magic').stdout).toContain('link: depends_on -> #email (held)')
})

// 63.3
test('63.3 an accept takes the card own ghost options and sources with it', () => {
  const p = makeProject()
  // Storage is decided, so the parent is a basis that holds.
  decidedRoot(p, 'storage', 'Storage')
  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(p, ['add', 'postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'one more server to run'])
  ok(p, ['link', 'postgres', 'sqlite', '--type', 'alternative_to'])
  ok(p, ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(p, ['link', 'sqlite', 'bench', '--type', 'supported_by'])
  ok(p, ['kill', 'sqlite', '--form', 'manual', '--text', 'revisit when writes grow'])
  const who = p.werk(['edit', 'sqlite', '--who', 'you'])
  const status = p.werk(['status', 'sqlite', 'decided'])
  ok(p, ['accept', 'sqlite', '--actor', 'you'])

  const s = show(p, 'sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const pg = show(p, 'postgres').stdout
  expect(pg).toContain('state: real')
  expect(pg).toContain('kind: option')
  expect(pg).toContain('why-not: one more server to run')
  const b = show(p, 'bench').stdout
  expect(b).toContain('state: real')
  expect(b).toContain('link: supported_by <- #sqlite')
  expect(b).not.toContain('(held)')
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)
})

// 63.4
test('63.4 discarding a ghost parent discards its whole ghost branch', () => {
  const p = makeProject()
  real(p, 'platform', 'Platform')
  ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(p, ['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(p, ['link', 'passwords', 'magic', '--type', 'alternative_to'])
  ok(p, ['discard', 'auth'])
  for (const id of ['auth', 'magic', 'passwords']) expect(show(p, id).code).not.toBe(0)
  const plat = show(p, 'platform').stdout
  expect(plat).toContain('state: real')
  expect(plat).not.toContain('#auth')
  expect(plat).not.toContain('#magic')
  expect(plat).not.toContain('(held)')
})

// 63.5
test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  const p = makeProject()
  decidedRoot(p, 'storage', 'Storage')
  real(p, 'child', 'Child', ['--parent', 'storage', '--who', 'me'])
  ok(p, ['kill', 'child', '--form', 'manual', '--text', 'revisit'])
  ok(p, ['status', 'child', 'decided'])
  const rollupOf = () => show(p, 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(p.werk(['stale']).stdout).not.toContain('storage')

  ok(p, ['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(p, ['kill', 'sqlite', '--form', 'manual', '--text', 'revisit'])
  ok(p, ['status', 'sqlite', 'decided'])
  ok(p, ['add', 'sqlite-opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy'])
  ok(p, ['link', 'sqlite-opt', 'sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('storage')
  expect(show(p, 'storage').stdout).not.toMatch(/stale|paused/)

  ok(p, ['accept', 'sqlite', '--actor', 'you'])
  const m = rollupOf()!.match(/rollup: (\d+) cards/)!
  const b = before!.match(/rollup: (\d+) cards/)!
  expect(Number(m[1])).toBe(Number(b[1]) + 1)
})

/** A card with a decider, a depends_on edge to a decided card and a rejected option. */
const almost = (p: Project, ghost = false) => {
  decidedRoot(p, 'base', 'Base')
  if (ghost) ok(p, ['add', 'c', '--title', 'The card', '--who', 'me'])
  else real(p, 'c', 'The card', ['--who', 'me'])
  ok(p, ['link', 'c', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'c-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'it lost'])
  ok(p, ['link', 'c-opt', 'c', '--type', 'alternative_to'])
}
const statusOf = (p: Project, id: string) => show(p, id).stdout.match(/^status: (\S+)/m)?.[1]

// 64.1
test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const p = makeProject()
  almost(p)
  const before = lines(p)
  const r = p.werk(['status', 'c', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/)
  const cmd = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('werk kill c'))
  expect(cmd).toBeDefined()
  expect(statusOf(p, 'c')).toBe('open')
  expect(lines(p)).toEqual(before)

  expect(runPrinted(p, cmd!).code).toBe(0)
  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(statusOf(p, 'c')).toBe('decided')
})

// 64.2
test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  const p = makeProject()
  decidedRoot(p, 'base', 'Base')
  real(p, 'c', 'The card', ['--body', 'Only a body.'])
  const r = p.werk(['status', 'c', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toContain(`  ${fact}: `)
  const cmds = out.split('\n').filter((l) => /^ {4}werk /.test(l)).map((l) => l.trim())
  expect(cmds).toHaveLength(4)
  expect(statusOf(p, 'c')).toBe('open')
  // The agent fills the one bare placeholder, the card the basis link needs.
  for (const cmd of cmds) {
    const res = runPrinted(p, cmd.replace('<card-it-needs>', 'base'))
    expect(res.code).toBe(0)
  }
  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(statusOf(p, 'c')).toBe('decided')
})

// 64.3
test('64.3 a ghost card obeys the same check through its held edges', () => {
  const p = makeProject()
  almost(p, true)
  ok(p, ['kill', 'c', '--form', 'manual', '--text', 'revisit'])
  ok(p, ['add', 'g2', '--title', 'Second ghost', '--who', 'me'])
  ok(p, ['add', 'g2-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'lost'])
  ok(p, ['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'revisit'])

  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(statusOf(p, 'c')).toBe('decided')
  expect(show(p, 'c').stdout).toContain('state: ghost')
  const r = p.werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('basis:')
  expect(out).toContain('werk link g2')
  expect(out).toContain('--type depends_on')
  expect(statusOf(p, 'g2')).not.toBe('decided')
})

/** A decided card with every fact. */
const decided = (p: Project) => {
  almost(p)
  ok(p, ['kill', 'c', '--form', 'manual', '--text', 'revisit'])
  ok(p, ['status', 'c', 'decided'])
}

// 64.4
test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  const p = makeProject()
  decided(p)
  const before = show(p, 'c').stdout
  const r = p.werk(['amend', 'c', '--summary', 'drop the base', '--unlink', 'base'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('basis:')
  expect(out).toContain('werk link c')
  expect(statusOf(p, 'c')).toBe('decided')
  expect(show(p, 'c').stdout).toBe(before)
})

// 64.5
test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  const p = makeProject()
  decided(p)
  const n = lines(p).length
  const r = p.werk(['amend', 'c', '--summary', 'shorter words', '--body', 'Short.'])
  expect(r.code).toBe(0)
  expect(statusOf(p, 'c')).toBe('decided')
  expect(show(p, 'c').stdout).toContain('Short.')
  const added = events(p).slice(n).filter((e) => e.payload.id === 'c')
  expect(added.some((e) => e.type === 'node.reopened')).toBe(true)
  expect(added.some((e) => e.type === 'node.status_set' && e.payload.status === 'decided')).toBe(true)
})
