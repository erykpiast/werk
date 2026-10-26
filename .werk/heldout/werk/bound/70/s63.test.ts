import { afterEach, expect, test } from 'bun:test'
import { accepted, graphOf, killed, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const show = (id: string) => p.werk(['show', id])

test('63.1 a link to a ghost is held, and goes live on accept', () => {
  p = project()
  p.writeLog([proposed('storage', { title: 'Storage' }), accepted('storage')])
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
  expect(show('use-sqlite').stdout).toContain('link: depends_on -> #storage (held)')
  const storage = show('storage').stdout.split('\n')
  expect(storage.filter((l) => l.includes('depends_on <- #use-sqlite') && !l.includes('(held)'))).toEqual([])
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const after = show('use-sqlite').stdout.split('\n')
  expect(after).toContain('link: depends_on -> #storage')
  const links = p.events().filter(
    (e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
  )
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child accepts its ghost parent, not a ghost it depends on', () => {
  p = project()
  p.writeLog([proposed('platform', { title: 'Platform' }), accepted('platform')])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic-links', 'email-service', '--type', 'depends_on'])
  ok(['accept', 'magic-links', '--actor', 'you'])
  expect(show('magic-links').stdout).toContain('state: real')
  const auth = show('auth').stdout
  expect(auth).toContain('state: real')
  expect(auth).toContain('parent: #platform')
  expect(show('email-service').stdout).toContain('state: ghost')
  expect(show('magic-links').stdout).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources', async () => {
  p = project()
  p.writeLog([proposed('storage', { title: 'Storage', status: 'decided', who: 'me' }), accepted('storage'), killed('storage')])
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server'])
  ok(['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
  ok(['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'me'])
  const status = p.werk(['status', 'use-sqlite', 'decided'])
  const refusals = { who: [who.code, who.stderr], status: [status.code, status.stderr] }
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const card = show('use-sqlite').stdout
  const option = show('use-postgres').stdout
  const source = show('benchmark-notes').stdout
  expect({ refusals, card, option, source }).toMatchObject({ refusals: { who: [0, ''], status: [0, ''] } })
  expect(card).toContain('state: real')
  expect(card).toContain('status: decided')
  expect(card).toContain('who: me')
  expect(option).toContain('state: real')
  expect(option).toContain('why-not: needs a server')
  expect(source).toContain('state: real')
  expect(card).toContain('supported-by: #benchmark-notes')
  const graph = await graphOf(p)
  expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'use-sqlite', to: 'benchmark-notes', type: 'supported_by' }))
})

test('63.4 discarding a ghost parent discards its whole ghost branch', async () => {
  p = project()
  p.writeLog([proposed('platform', { title: 'Platform' }), accepted('platform')])
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  for (const id of ['auth', 'magic-links', 'passwords']) expect(show(id).code).not.toBe(0)
  const graph = await graphOf(p)
  expect(graph.nodes.map((n) => n.id)).toEqual(['platform'])
  const platform = show('platform').stdout
  expect(platform).toContain('state: real')
  expect(platform).not.toContain('(held)')
  expect(graph.ghostEdges).toEqual([])
})

test('63.5 a ghost changes no count of a real card until accepted', () => {
  p = project()
  p.writeLog([
    proposed('storage', { title: 'Storage', status: 'decided', who: 'me' }),
    proposed('files', { title: 'Files', status: 'decided', who: 'you', parent: 'storage' }),
    accepted('files'),
    { type: 'node.status_set', payload: { id: 'files', status: 'decided', unchallenged: true } },
  ])
  const rollupOf = () => show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(show('storage').stdout.toLowerCase()).not.toContain('stale')
  const add = p.werk(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--status', 'decided'])
  p.werk(['add', 'use-sqlite-opt', '--kind', 'option', '--title', 'Use Postgres'])
  p.werk(['link', 'use-sqlite-opt', 'use-sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(show('storage').stdout.toLowerCase()).not.toContain('stale')
  const acc = p.werk(['accept', 'use-sqlite', '--actor', 'you'])
  expect({ add: [add.code, add.stderr], accept: [acc.code, acc.stderr] }).toEqual({ add: [0, ''], accept: [0, ''] })
  expect(rollupOf()).toContain('3 cards')
})
