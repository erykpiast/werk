/** Held-out steps 62.x, 63.x, 64.x: the map verbs, run as a process. */
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(120_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'

const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')
let p: Project
afterEach(() => p?.cleanup())

const logPathOf = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => (existsSync(logPathOf()) ? readFileSync(logPathOf(), 'utf8').split('\n').filter(Boolean) : [])
const events = () => logLines().map((l) => JSON.parse(l))

const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const appendsOne = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).toBe(0)
  const after = logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
const refuses = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(logLines()).toEqual(before)
  return r
}
const show = (id: string) => p.werk(['show', id])
const isGhost = (id: string) => show(id).stdout.includes('state: ghost')
const isReal = (id: string) => show(id).stdout.includes('state: real')
const statusOf = (id: string) => /status: (\w+)/.exec(show(id).stdout)?.[1]

/** The map, as the server sends it at /api/graph: the graph of the log, drawn as the refines tree. */
const mapTree = () => refinesTree(graphOf(readLog(logPathOf())))
const findIn = (trees: TreeNode[], id: string): TreeNode | undefined => {
  for (const t of trees) {
    if (t.node.id === id) return t
    const f = findIn(t.children, id)
    if (f) return f
  }
  return undefined
}

/** A real card, accepted by the person. */
const realCard = (id: string, title: string, extra: string[] = []) => {
  ok(['add', id, '--title', title, ...extra])
  ok(['accept', id, '--actor', 'you'])
}
/** A real decided root card. */
const decidedRoot = (id: string, title: string) => {
  realCard(id, title)
  ok(['edit', id, '--who', 'me', '--no-basis', 'the root of the map'])
  ok(['kill', id, '--form', 'revisit'])
  ok(['status', id, 'decided'])
}
/** Runs a printed fix command, with the agent's values put in the placeholders. */
const runPrinted = (cmd: string, fill: Record<string, string>) => {
  let c = cmd
  for (const [k, v] of Object.entries(fill)) c = c.replaceAll(k, v)
  c = c.replace(/<[^>]+>/g, 'filled in by the agent')
  c = c.replaceAll(/(^|&& )werk /g, `$1${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} `)
  const r = p.run(['sh', '-c', c])
  if (r.code !== 0) throw new Error(`printed command failed: ${c}\n${r.stderr}`)
}
const printedCommands = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk '))

// ---------------------------------------------------------------- 62

test('62.1', () => {
  p = makeProject()
  realCard('seed', 'Seed card')
  ok(['say', 'seed', '--text', 'an earlier note'])
  const add = appendsOne(['add', 'log', '--title', 'Use a log', '--body', 'Append only lines', '--why', 'We need history'])
  expect(add.stdout).toContain('proposed')
  const s = show('log').stdout
  expect(s).toContain('Use a log')
  expect(s).toContain('Append only lines')
  expect(s).toContain('We need history')
  expect(s).toContain('state: ghost')
  appendsOne(['accept', 'log', '--actor', 'you'])
  const s2 = show('log').stdout
  expect(s2).toContain('Use a log')
  expect(s2).toContain('Append only lines')
  expect(s2).toContain('We need history')
  expect(s2).toContain('state: real')
  expect(s2).not.toContain('ghost')
})

test('62.2', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'A card'])
  refuses(['accept', 'c'])
  expect(isGhost('c')).toBe(true)
  ok(['accept', 'c', '--actor', 'you'])
  expect(isReal('c')).toBe(true)
})

test('62.3', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  refuses(['edit', 'c', '--body', 'new body'])
  refuses(['retitle', 'c', '--title', 'Use an append-only log'])
  refuses(['add', 'c', '--title', 'Something else'])
  const s = show('c').stdout
  expect(s).toContain('Use a log')
  expect(s).toContain('state: ghost')
})

test('62.4', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  ok(['accept', 'c', '--actor', 'you'])
  appendsOne(['retitle', 'c', '--title', 'Use an append-only log'])
  const s = show('c').stdout
  expect(s).toContain('Use an append-only log')
  expect(s.replaceAll('Use an append-only log', '')).not.toContain('Use a log')
  expect(logLines().some((l) => l.includes('"Use a log"'))).toBe(true)
  ok(['edit', 'c', '--body', 'The new body text'])
  const s2 = show('c').stdout
  expect(s2).toContain('The new body text')
  expect(s2).toContain('Use an append-only log')
})

test('62.5', () => {
  p = makeProject()
  realCard('c', 'Real card')
  const o = appendsOne(['add', 'opt', '--kind', 'option', '--title', 'An option', '--why-not', 'too slow', '--parent', 'c'])
  const src = appendsOne(['add', 'src', '--kind', 'source', '--title', 'A source', '--body', 'source body'])
  const ex = appendsOne(['add', 'ex', '--kind', 'excerpt', '--title', 'An excerpt', '--body', 'excerpt body'])
  for (const r of [o, src, ex]) expect(r.stdout).toContain('proposed')
  expect(show('opt').stdout).toContain('An option')
  expect(show('opt').stdout).toContain('why-not: too slow')
  expect(show('src').stdout).toContain('source body')
  expect(show('ex').stdout).toContain('excerpt body')
  for (const id of ['opt', 'src', 'ex']) expect(isGhost(id)).toBe(true)
  ok(['accept', 'opt', '--actor', 'you'])
  expect(isReal('opt')).toBe(true)
  expect(show('opt').stdout).toContain('why-not: too slow')
  expect(isGhost('src')).toBe(true)
  expect(isGhost('ex')).toBe(true)
})

// ---------------------------------------------------------------- 63

test('63.1', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'sqlite', 'storage', '--type', 'depends_on'])
  expect(show('sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const st = show('storage').stdout
  expect(st).not.toMatch(/link: depends_on <- #sqlite(?! \(held\))/)
  expect(graphOf(readLog(logPathOf())).edges.some((e) => e.from === 'sqlite' && e.type === 'depends_on')).toBe(false)
  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = show('sqlite').stdout
  expect(s).toContain('link: depends_on -> #storage')
  expect(s).not.toContain('link: depends_on -> #storage (held)')
  expect(events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'sqlite' && e.payload.to === 'storage')).toHaveLength(1)
})

test('63.2', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic', 'email', '--type', 'depends_on'])
  ok(['accept', 'magic', '--actor', 'you'])
  expect(isReal('magic')).toBe(true)
  expect(isReal('auth')).toBe(true)
  expect(show('auth').stdout).toContain('parent: #platform')
  expect(isGhost('email')).toBe(true)
  expect(show('magic').stdout).toContain('link: depends_on -> #email (held)')
})

test('63.3', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
  ok(['link', 'pg', 'sqlite', '--type', 'alternative_to'])
  ok(['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'sqlite', 'bench', '--type', 'supported_by'])
  // The status change needs the contract facts; who and kill are facts that record on a ghost.
  const who = p.werk(['edit', 'sqlite', '--who', 'me'])
  ok(['kill', 'sqlite', '--form', 'revisit'])
  ok(['edit', 'storage', '--who', 'me', '--no-basis', 'root'])
  ok(['kill', 'storage', '--form', 'revisit'])
  ok(['status', 'storage', 'decided'])
  const status = p.werk(['status', 'sqlite', 'decided'])
  ok(['accept', 'sqlite', '--actor', 'you'])
  const s = show('sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: me')
  const pg = show('pg').stdout
  expect(pg).toContain('state: real')
  expect(pg).toContain('why-not: needs a server')
  const b = show('bench').stdout
  expect(b).toContain('state: real')
  expect(s).toContain('supported-by: #bench')
  expect(graphOf(readLog(logPathOf())).edges.some((e) => e.from === 'sqlite' && e.to === 'bench' && e.type === 'supported_by')).toBe(true)
  expect(who.code).toBe(0)
  expect(status.code).toBe(0)
})

test('63.4', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'pw', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'pw', 'magic', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  const tree = mapTree()
  for (const id of ['auth', 'magic', 'pw']) {
    expect(findIn(tree, id)).toBeUndefined()
    expect(show(id).code).not.toBe(0)
  }
  expect(isReal('platform')).toBe(true)
  expect(findIn(tree, 'platform')!.children.filter((c) => c.node.proposed)).toHaveLength(0)
})

test('63.5', () => {
  p = makeProject()
  decidedRoot('storage', 'Storage')
  realCard('child', 'Child', ['--parent', 'storage'])
  ok(['edit', 'child', '--who', 'me'])
  ok(['kill', 'child', '--form', 'revisit'])
  ok(['status', 'child', 'decided'])
  const rollupOf = () => /rollup: .*/.exec(show('storage').stdout)?.[0]
  const before = rollupOf()
  expect(before).toBeDefined()
  const staleBefore = p.werk(['stale']).stdout
  expect(staleBefore).not.toContain('storage')
  // A ghost proposed straight as decided would need its kill criterion first, so the agent
  // proposes it, records the kill criterion and the decider, and sets it decided.
  ok(['add', 'sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
  ok(['kill', 'sqlite', '--form', 'revisit'])
  ok(['status', 'sqlite', 'decided'])
  ok(['add', 'opt', '--kind', 'option', '--title', 'Use files', '--why-not', 'no queries'])
  ok(['link', 'opt', 'sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(p.werk(['stale']).stdout).not.toContain('storage')
  ok(['accept', 'sqlite', '--actor', 'you'])
  const after = /rollup: (\d+) cards/.exec(show('storage').stdout)?.[1]
  expect(Number(after)).toBe(Number(/rollup: (\d+) cards/.exec(before!)![1]) + 1)
})

// ---------------------------------------------------------------- 64

/** A card with a decider, a depends_on edge and a rejected option, and no kill criterion. */
const almostDecidable = (id: string) => {
  decidedRoot('base', 'Base')
  realCard(id, 'Use a log', ['--body', 'Append lines'])
  ok(['edit', id, '--who', 'you'])
  ok(['link', id, 'base', '--type', 'depends_on'])
  ok(['add', `${id}-opt`, '--kind', 'option', '--title', 'Use a database', '--why-not', 'too heavy'])
  ok(['accept', `${id}-opt`, '--actor', 'you'])
  ok(['link', `${id}-opt`, id, '--type', 'alternative_to'])
  ok(['status', id, 'open'])
}

test('64.1', () => {
  p = makeProject()
  almostDecidable('c')
  const statusEvents = () => events().filter((e) => e.type === 'node.status_set' && e.payload.id === 'c').length
  const n = statusEvents()
  const r = refuses(['status', 'c', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toContain('kill criterion')
  const cmds = printedCommands(out)
  expect(cmds.some((c) => c.startsWith('werk kill c '))).toBe(true)
  expect(statusOf('c')).toBe('open')
  expect(statusEvents()).toBe(n)
  runPrinted(cmds.find((c) => c.startsWith('werk kill c '))!, {})
  ok(['status', 'c', 'decided'])
  expect(statusOf('c')).toBe('decided')
})

test('64.2', () => {
  p = makeProject()
  decidedRoot('base', 'Base')
  realCard('c', 'Use a log', ['--body', 'Append lines'])
  ok(['status', 'c', 'open'])
  const r = refuses(['status', 'c', 'decided'])
  const out = r.stdout + r.stderr
  const facts = [...out.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  expect(facts).toContain('who')
  expect(facts).toContain('basis')
  expect(facts).toContain('kill')
  expect(facts).toContain('options')
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(facts.length)
  expect(statusOf('c')).toBe('open')
  for (const c of cmds) runPrinted(c, { '<card-it-needs>': 'base' })
  ok(['status', 'c', 'decided'])
  expect(statusOf('c')).toBe('decided')
})

test('64.3', () => {
  p = makeProject()
  decidedRoot('base', 'Base')
  ok(['add', 'g1', '--title', 'First ghost', '--who', 'you'])
  ok(['link', 'g1', 'base', '--type', 'depends_on'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'slow'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'revisit'])
  ok(['add', 'g2', '--title', 'Second ghost', '--who', 'you'])
  ok(['add', 'g2-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'slow'])
  ok(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'revisit'])
  expect(p.werk(['status', 'g1', 'decided']).code).toBe(0)
  expect(statusOf('g1')).toBe('decided')
  const r = refuses(['status', 'g2', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/basis: .*depends_on/)
  expect(printedCommands(out).some((c) => c.includes('werk link g2') && c.includes('depends_on'))).toBe(true)
  expect(statusOf('g2')).not.toBe('decided')
})

/** A decided card with every fact. */
const decidedCard = (id: string) => {
  almostDecidable(id)
  ok(['kill', id, '--form', 'revisit'])
  ok(['status', id, 'decided'])
}

test('64.4', () => {
  p = makeProject()
  decidedCard('c')
  const before = show('c').stdout
  // The product has no verb that drops a link, so an amend that removes the depends_on edge
  // has no command. The verbs it lists are the agent's only tools.
  const help = p.werk(['help']).stdout
  const dropVerb = ['unlink', 'amend'].find((v) => new RegExp(`^\\s*${v}\\b`, 'm').test(help))
  expect(dropVerb).toBeDefined()
  const r = refuses([dropVerb!, 'c', 'base', '--type', 'depends_on'])
  expect(r.stdout + r.stderr).toMatch(/basis/)
  expect(statusOf('c')).toBe('decided')
  expect(show('c').stdout).toBe(before)
})

test('64.5', () => {
  p = makeProject()
  decidedCard('c')
  const n = events().length
  ok(['edit', 'c', '--body', 'One short sentence.'])
  const s = show('c').stdout
  expect(s).toContain('status: decided')
  expect(s).toContain('One short sentence.')
  const added = events().slice(n)
  expect(added.some((e) => e.type === 'node.reopened' && e.payload.id === 'c')).toBe(true)
  expect(added.some((e) => e.type === 'node.status_set' && e.payload.id === 'c' && e.payload.status === 'decided')).toBe(true)
})
