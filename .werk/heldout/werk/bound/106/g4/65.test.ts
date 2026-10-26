import { describe, expect, test } from 'bun:test'
import { accepted, decidedRoot, linked, makeProject, mapGraph, ok, proposed, seed, show, startServer, type Project } from './helpers.ts'
import type { NewEvent } from '../../src/map/events.ts'

/** A decided card with every fact, refining nothing, depending on `on` when given. */
const decided = (id: string, on?: string): NewEvent[] => [
  ...decidedRoot(id, `Card ${id.toUpperCase()}`),
  ...(on === undefined ? [] : [linked(id, on, 'depends_on')]),
]
const open = (id: string, on: string): NewEvent[] => [proposed(id, { title: `Card ${id.toUpperCase()}` }), accepted(id), linked(id, on, 'depends_on')]

/** The stale list as blocks: the header line of each marked card with its trace lines. */
function staleList(p: Project) {
  const lines = ok(p, ['stale']).stdout.split('\n')
  const entries: { mark: string; id: string; traces: string[] }[] = []
  for (const line of lines) {
    const head = line.match(/^(stale|paused)\s+#(\S+)/)
    if (head) entries.push({ mark: head[1]!, id: head[2]!, traces: [] })
    else if (line.startsWith('  ') && entries.length > 0) entries.at(-1)!.traces.push(line)
  }
  return entries
}
const entry = (p: Project, id: string) => staleList(p).find((e) => e.id === id)

describe('65', () => {
  test('65.1 A rejected reopen marks only the next hop as stale', async () => {
    const p = makeProject()
    seed(p, [...decided('a'), ...decided('b', 'a'), ...decided('c', 'b')])
    ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
    const b = entry(p, 'b')
    expect(b?.mark).toBe('stale')
    const trace = b!.traces.join('\n')
    expect(trace).toContain('#a')
    expect(trace).toContain('depends_on')
    expect(trace).toContain('rejected')
    expect(entry(p, 'c')).toBeUndefined()
    const graph = await mapGraph(p)
    expect(graph.marks.c).toBeUndefined()
  })

  test('65.2 A postponed reopen pauses every downstream card and keeps their status', async () => {
    const p = makeProject()
    seed(p, [...decided('a'), ...decided('b', 'a'), ...decided('c', 'b'), ...decided('d', 'c')])
    ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
    const server = startServer(p)
    const graph = await mapGraph(p, server)
    for (const id of ['b', 'c', 'd']) expect({ id, mark: graph.marks[id]?.mark }).toEqual({ id, mark: 'paused' })
    expect(graph.nodes.find((n) => n.id === 'd')?.status).toBe('decided')
    expect(show(p, 'd').stdout).toContain('status: decided')
    const d = entry(p, 'd')
    expect(d?.mark).toBe('paused')
    expect(d!.traces.join('\n')).toContain('postponed #a')
    expect(Object.values(graph.marks).filter((m) => m.mark === 'stale')).toEqual([])
    expect(staleList(p).filter((e) => e.mark === 'stale')).toEqual([])
  })

  test('65.3 Stale wins when a postponement and a rejection reach the same card', async () => {
    const p = makeProject()
    seed(p, [
      ...decided('a'),
      ...decided('b'),
      ...decided('c', 'a'),
      linked('c', 'b', 'refines'),
    ])
    ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'a waits'])
    ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'b is wrong'])
    const graph = await mapGraph(p)
    expect(graph.marks.c?.mark).toBe('stale')
    const c = entry(p, 'c')
    expect(c?.mark).toBe('stale')
    const trace = c!.traces.join('\n')
    expect(trace).toContain('#b')
    expect(trace).toContain('rejected')
  })

  test('65.4 Rederive clears the mark on one card and leaves the others', async () => {
    const p = makeProject()
    seed(p, [...decided('a'), ...decided('b', 'a'), ...decided('c', 'a')])
    ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'a is wrong'])
    expect(entry(p, 'b')?.mark).toBe('stale')
    expect(entry(p, 'c')?.mark).toBe('stale')
    ok(p, ['rederive', 'b', 'confirm', '--why', 'b still holds'])
    expect(entry(p, 'b')).toBeUndefined()
    const c = entry(p, 'c')
    expect(c?.mark).toBe('stale')
    expect(c!.traces.join('\n')).toContain('rejected #a')
    const graph = await mapGraph(p)
    expect(graph.marks.b).toBeUndefined()
  })

  test('65.5 Deciding a postponed card again clears the paused marks downstream', async () => {
    const p = makeProject()
    seed(p, [...decided('a'), ...open('b', 'a'), ...decided('c', 'b')])
    const server = startServer(p)
    const statusBefore = (await mapGraph(p, server)).nodes.find((n) => n.id === 'c')?.status
    ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'a waits'])
    const g1 = await mapGraph(p, server)
    expect(g1.marks.b?.mark).toBe('paused')
    expect(g1.marks.c?.mark).toBe('paused')
    const r = p.werk(['status', 'a', 'decided'])
    expect({ code: r.code, err: r.stderr }).toMatchObject({ code: 0 })
    const g2 = await mapGraph(p, server)
    expect(g2.marks.b).toBeUndefined()
    expect(g2.marks.c).toBeUndefined()
    expect(entry(p, 'b')).toBeUndefined()
    expect(entry(p, 'c')).toBeUndefined()
    expect(g2.nodes.find((n) => n.id === 'c')?.status).toBe(statusBefore)
  })
})
