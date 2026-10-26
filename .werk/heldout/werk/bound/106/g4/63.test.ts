import { describe, expect, test } from 'bun:test'
import { accepted, decidedRoot, logEvents, makeProject, mapGraph, ok, proposed, seed, show, startServer } from './helpers.ts'

const linkLines = (out: string) => out.split('\n').filter((l) => l.startsWith('link:'))

describe('63', () => {
  test('63.1 A link to a ghost is held, and it goes live on accept with no extra link event', () => {
    const p = makeProject()
    seed(p, [proposed('storage', { title: 'Storage' }), accepted('storage')])
    ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(p, ['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
    const edge = (out: string) => linkLines(out).filter((l) => l.includes('depends_on') && l.includes('#storage'))
    const s1 = edge(show(p, 'use-sqlite').stdout)
    expect(s1).toHaveLength(1)
    expect(s1[0]).toContain('(held)')
    const live = linkLines(show(p, 'storage').stdout).filter((l) => l.includes('#use-sqlite') && !l.includes('(held)'))
    expect(live).toEqual([])
    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
    const s2 = edge(show(p, 'use-sqlite').stdout)
    expect(s2).toHaveLength(1)
    expect(s2[0]).not.toContain('(held)')
    const links = logEvents(p).filter(
      (e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
    )
    expect(links).toHaveLength(1)
  })

  test('63.2 Accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
    const p = makeProject()
    seed(p, [proposed('platform', { title: 'Platform' }), accepted('platform')])
    ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
    ok(p, ['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
    ok(p, ['link', 'magic-links', 'email-service', '--type', 'depends_on'])
    ok(p, ['accept', 'magic-links', '--actor', 'you'])
    expect(show(p, 'magic-links').stdout).toContain('state: real')
    const auth = show(p, 'auth').stdout
    expect(auth).toContain('state: real')
    expect(auth).toContain('parent: #platform')
    expect(show(p, 'email-service').stdout).toContain('ghost')
    const dep = linkLines(show(p, 'magic-links').stdout).filter((l) => l.includes('depends_on') && l.includes('#email-service'))
    expect(dep).toHaveLength(1)
    expect(dep[0]).toContain('(held)')
  })

  test('63.3 An accept takes the card\'s own ghost options and sources with it', () => {
    const p = makeProject()
    // Storage is decided, so it is a basis the decide of Use SQLite can stand on.
    seed(p, [...decidedRoot('storage', 'Storage')])
    ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(p, ['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'A server to run for one user'])
    ok(p, ['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
    ok(p, ['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes'])
    ok(p, ['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by'])
    // A decided card needs a kill criterion in this product; the step names none, so the Given records one.
    ok(p, ['kill', 'use-sqlite', '--form', 'manual', '--text', 'revisit when two users write'])
    const who = p.werk(['edit', 'use-sqlite', '--who', 'me'])
    const status = p.werk(['status', 'use-sqlite', 'decided'])
    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
    const card = show(p, 'use-sqlite').stdout
    expect(card).toContain('state: real')
    expect(card).toContain('status: decided')
    expect(card).toContain('who: me')
    const opt = show(p, 'use-postgres').stdout
    expect(opt).toContain('state: real')
    expect(opt).toContain('kind: option')
    expect(opt).toContain('why-not: A server to run for one user')
    const src = show(p, 'benchmark-notes').stdout
    expect(src).toContain('state: real')
    const supp = linkLines(src).filter((l) => l.includes('supported_by') && l.includes('#use-sqlite'))
    expect(supp).toHaveLength(1)
    expect(supp[0]).not.toContain('(held)')
    expect({ code: who.code, err: who.stderr }).toEqual({ code: 0, err: '' })
    expect({ code: status.code, err: status.stderr }).toEqual({ code: 0, err: '' })
  })

  test('63.4 Discarding a ghost parent discards its whole ghost branch', async () => {
    const p = makeProject()
    seed(p, [proposed('platform', { title: 'Platform' }), accepted('platform')])
    ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
    ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
    ok(p, ['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
    ok(p, ['discard', 'auth'])
    const graph = await mapGraph(p)
    for (const id of ['auth', 'magic-links', 'passwords']) {
      expect(show(p, id).code).not.toBe(0)
      expect(graph.nodes.map((n) => n.id)).not.toContain(id)
    }
    expect(show(p, 'platform').stdout).toContain('state: real')
    expect(graph.nodes.filter((n) => n.proposed)).toEqual([])
  })

  test('63.5 A ghost changes no count of a real card until it is accepted', async () => {
    const p = makeProject()
    seed(p, [
      ...decidedRoot('storage', 'Storage'),
      proposed('wal', { title: 'Write-ahead log', parent: 'storage', status: 'decided', who: 'me' }),
      accepted('wal'),
      { type: 'kill.recorded', payload: { id: 'wal', criterion: { form: 'manual', text: 'x' } } },
    ])
    const server = startServer(p)
    const rollup = () => show(p, 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
    const count = (line: string | undefined, what: string) => Number(line?.match(new RegExp(`(\\d+) ${what}`))?.[1])
    const r0 = rollup()
    expect(r0).toBeDefined()
    expect((await mapGraph(p, server)).marks.storage).toBeUndefined()
    ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--who', 'me'])
    ok(p, ['kill', 'use-sqlite', '--form', 'manual', '--text', 'revisit when two users write'])
    ok(p, ['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'heavy'])
    ok(p, ['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
    ok(p, ['status', 'use-sqlite', 'decided'])
    const r1 = rollup()
    expect(count(r1, 'cards')).toBe(count(r0, 'cards'))
    expect(count(r1, 'unchallenged')).toBe(count(r0, 'unchallenged'))
    expect((await mapGraph(p, server)).marks.storage).toBeUndefined()
    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
    const r2 = rollup()
    expect(count(r2, 'cards')).toBe(count(r0, 'cards') + 1)
    expect(count(r2, 'decided')).toBe(count(r0, 'decided') + 1)
  })
})
