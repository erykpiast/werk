import { afterEach, expect, test } from 'bun:test'
import { fold } from '../../src/map/fold.ts'
import { refinesTree, toGraph, type TreeNode } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'
import { acc, kil, out, project, prop, soft, stat, type P } from './helpers.ts'

let p: P | undefined
afterEach(() => p?.cleanup())

const realCard = (p: P, id: string, title: string) => {
  expect(p.werk(['add', id, '--title', title]).code).toBe(0)
  expect(p.werk(['accept', id, '--actor', 'you']).code).toBe(0)
}

const treeIds = (trees: TreeNode[]): string[] => trees.flatMap((t) => [t.node.id, ...treeIds(t.children)])

test('63.1', () => {
  p = project()
  const s = soft()
  realCard(p, 'storage', 'Storage')
  expect(p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage']).code).toBe(0)
  const l = p.werk(['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
  s.check(l.code === 0, `link exit ${l.code}: ${out(l)}`)
  const shown = p.show('use-sqlite').stdout
  s.check(shown.includes('link: depends_on -> #storage (held)'), `show use-sqlite: ${shown}`)
  const live = fold(readLog(p.logFile)).edges
  s.check(!live.some((e) => e.from === 'use-sqlite' && e.to === 'storage' && e.type === 'depends_on'), 'edge is live before accept')
  const storageShow = p.show('storage').stdout
  s.check(!/depends_on <- #use-sqlite(?! \(held\))/.test(storageShow), `storage shows the edge as live: ${storageShow}`)
  const a = p.werk(['accept', 'use-sqlite', '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  const after = p.show('use-sqlite').stdout
  s.check(/link: depends_on -> #storage$/m.test(after), `show after accept: ${after}`)
  const links = p.events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on')
  s.check(links.length === 1, `link events: ${links.length}`)
  expect(s.problems).toEqual([])
})

test('63.2', () => {
  p = project()
  const s = soft()
  realCard(p, 'platform', 'Platform')
  for (const [id, title, parent] of [
    ['auth', 'Auth', 'platform'],
    ['magic-links', 'Magic links', 'auth'],
    ['email-service', 'Email service', 'platform'],
  ]) expect(p.werk(['add', id!, '--title', title!, '--parent', parent!]).code).toBe(0)
  expect(p.werk(['link', 'magic-links', 'email-service', '--type', 'depends_on']).code).toBe(0)
  const a = p.werk(['accept', 'magic-links', '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  const magic = p.show('magic-links').stdout
  s.check(magic.includes('state: real'), `magic: ${magic}`)
  const auth = p.show('auth').stdout
  s.check(auth.includes('state: real') && auth.includes('parent: #platform'), `auth: ${auth}`)
  s.check(/ghost/.test(p.show('email-service').stdout), 'email service is not a ghost')
  s.check(magic.includes('link: depends_on -> #email-service (held)'), `magic edge not held: ${magic}`)
  expect(s.problems).toEqual([])
})

test('63.3', () => {
  // Given: Storage is a real card, and decided, so that a decided child has a decided parent as its basis.
  p = project([
    prop('storage', 'Storage', { who: 'me' }),
    acc('storage'),
    kil('storage'),
    { type: 'node.edited', payload: { id: 'storage', noBasis: 'the root' } },
    stat('storage', 'decided'),
  ])
  const s = soft()
  expect(p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage']).code).toBe(0)
  expect(p.werk(['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'It needs a server']).code).toBe(0)
  expect(p.werk(['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to']).code).toBe(0)
  expect(p.werk(['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes']).code).toBe(0)
  expect(p.werk(['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by']).code).toBe(0)
  const st = p.werk(['status', 'use-sqlite', 'decided'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'me'])
  const a = p.werk(['accept', 'use-sqlite', '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  const card = p.show('use-sqlite').stdout
  s.check(card.includes('state: real') && card.includes('status: decided') && card.includes('who: me'), `use-sqlite: ${card}`)
  const opt = p.show('use-postgres').stdout
  s.check(opt.includes('state: real') && opt.includes('why-not: It needs a server'), `use-postgres: ${opt}`)
  const src = p.show('benchmark-notes').stdout
  s.check(src.includes('state: real'), `benchmark-notes: ${src}`)
  const live = fold(readLog(p.logFile)).edges
  s.check(live.some((e) => e.from === 'use-sqlite' && e.to === 'benchmark-notes' && e.type === 'supported_by'), 'supported_by edge is not live')
  s.check(st.code === 0, `status decided refused, exit ${st.code}: ${out(st)}`)
  s.check(who.code === 0, `who change refused, exit ${who.code}: ${out(who)}`)
  expect(s.problems).toEqual([])
})

test('63.4', () => {
  p = project()
  const s = soft()
  realCard(p, 'platform', 'Platform')
  expect(p.werk(['add', 'auth', '--title', 'Auth', '--parent', 'platform']).code).toBe(0)
  expect(p.werk(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth']).code).toBe(0)
  expect(p.werk(['add', 'passwords', '--kind', 'option', '--title', 'Passwords']).code).toBe(0)
  expect(p.werk(['link', 'passwords', 'magic-links', '--type', 'alternative_to']).code).toBe(0)
  const d = p.werk(['discard', 'auth'])
  s.check(d.code === 0, `discard exit ${d.code}: ${out(d)}`)
  const graph = toGraph(fold(readLog(p.logFile)))
  const inMap = treeIds(refinesTree(graph))
  for (const id of ['auth', 'magic-links', 'passwords']) {
    s.check(p.show(id).code !== 0, `show ${id} still prints it`)
    s.check(!inMap.includes(id) && !graph.nodes.some((n) => n.id === id), `${id} still in the map graph`)
  }
  const plat = p.show('platform').stdout
  s.check(plat.includes('state: real') && !/#auth|#magic-links|#passwords|held/.test(plat), `platform: ${plat}`)
  expect(s.problems).toEqual([])
})

test('63.5', () => {
  // Given: Storage is real and decided, with one real decided child.
  p = project([
    prop('storage', 'Storage', { who: 'me' }),
    acc('storage'),
    kil('storage'),
    { type: 'node.edited', payload: { id: 'storage', noBasis: 'the root' } },
    stat('storage', 'decided'),
    prop('child', 'A decided child', { parent: 'storage', who: 'me' }),
    acc('child'),
    kil('child'),
    stat('child', 'decided'),
  ])
  const s = soft()
  const rollupOf = () => /^rollup: .*$/m.exec(p!.show('storage').stdout)?.[0]
  const counts = (line: string | undefined) => {
    const m = /rollup: (\d+) cards .* (\d+) unchallenged/.exec(line ?? '')
    return m ? { cards: Number(m[1]), unchallenged: Number(m[2]) } : undefined
  }
  const before = rollupOf()
  expect(before).toBeDefined()
  s.check(!/stale/i.test(p.show('storage').stdout), 'storage shows a staleness mark before')

  const add = p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--status', 'decided'])
  s.check(add.code === 0, `add with status decided refused, exit ${add.code}: ${out(add)}`)
  const opt = p.werk(['add', 'use-sqlite-opt', '--kind', 'option', '--title', 'Use files', '--why-not', 'No queries'])
  const ol = p.werk(['link', 'use-sqlite-opt', 'use-sqlite', '--type', 'alternative_to'])
  s.check(opt.code === 0 && ol.code === 0, `ghost option: ${out(opt)} ${out(ol)}`)
  s.check(JSON.stringify(counts(rollupOf())) === JSON.stringify(counts(before)), `counts changed: ${before} -> ${rollupOf()}`)
  s.check(!/stale/i.test(p.show('storage').stdout), 'storage shows a staleness mark after the ghost')

  const a = p.werk(['accept', 'use-sqlite', '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  const after = counts(rollupOf())
  s.check(after?.cards === counts(before)!.cards + 1, `rollup after accept: ${rollupOf()} (before: ${before})`)
  expect(s.problems).toEqual([])
})
