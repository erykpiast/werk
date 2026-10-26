import { expect, test } from 'bun:test'
import { linked } from '../../src/test/map-events.ts'
import { card, logLines, ok, projectWith } from './helpers.ts'

/** The direct children of a card in the served map: the parent line of show. */
const parentOf = (p: ReturnType<typeof projectWith>, id: string) => ok(p, ['show', id]).match(/^parent: #(\S+)$/m)?.[1]

async function childrenInMap(p: ReturnType<typeof projectWith>, parent: string): Promise<string[]> {
  const { serveProject } = await import('../../src/test/harness.ts')
  const s = serveProject(p)
  const url = await s.url
  const g = (await (await fetch(`${url}api/graph`)).json()) as { nodes: { id: string }[]; edges: { from: string; to: string; type: string }[] }
  await s.stop()
  const ids = new Set((Array.isArray(g.nodes) ? g.nodes : Object.values(g.nodes)).map((n) => n.id))
  return g.edges.filter((e) => e.type === 'refines' && e.to === parent && ids.has(e.from)).map((e) => e.from)
}

test('66.1 An agent removes a bad branch and the log keeps its history', async () => {
  const p = projectWith(...card('Storage', 'open'), ...card('Cache', 'open', 'Storage'), ...card('Index', 'open', 'Storage'), ...card('Eviction', 'open', 'Cache'))
  const before = logLines(p)
  ok(p, ['remove', 'Cache', '--actor', 'you'])
  expect(ok(p, ['show', 'Cache'])).toMatch(/state: removed/)
  expect(ok(p, ['show', 'Eviction'])).toMatch(/state: removed/)
  const kids = await childrenInMap(p, 'Storage')
  expect(kids).not.toContain('Cache')
  expect(kids).not.toContain('Eviction')
  expect(kids).toContain('Index')
  expect(ok(p, ['removed'])).toContain('#Cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', async () => {
  const p = projectWith(
    ...card('Storage', 'open'), ...card('Cache', 'open', 'Storage'), ...card('Eviction', 'open', 'Cache'), ...card('Memory budget', 'open', undefined, 'Memory budget'),
    linked('Cache', 'Memory budget', 'depends_on'),
  )
  ok(p, ['remove', 'Cache', '--actor', 'you'])
  ok(p, ['restore', 'Cache'])
  const shown = ok(p, ['show', 'Cache'])
  expect(shown).not.toMatch(/state: removed/)
  expect(await childrenInMap(p, 'Storage')).toContain('Cache')
  expect(await childrenInMap(p, 'Cache')).toContain('Eviction')
  expect(shown).toContain('depends_on -> #Memory budget')
  expect(ok(p, ['removed'])).not.toContain('#Cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', async () => {
  const p = projectWith(...card('Storage', 'open'), ...card('Bad layer', 'open', 'Storage'), ...card('Write path', 'open', 'Bad layer'), ...card('Read path', 'open', 'Bad layer'))
  ok(p, ['remove', 'Bad layer', '--actor', 'you', '--reparent'])
  expect(ok(p, ['show', 'Bad layer'])).toMatch(/state: removed/)
  const kids = await childrenInMap(p, 'Storage')
  expect(kids).toContain('Write path')
  expect(kids).toContain('Read path')
  expect(parentOf(p, 'Write path')).toBe('Storage')
  expect(ok(p, ['show', 'Write path'])).not.toMatch(/state: removed/)
  expect(ok(p, ['show', 'Read path'])).not.toMatch(/state: removed/)
})

const listed = (out: string, id: string) => new RegExp(`#${id}\\b`).test(out)

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  const p = projectWith(
    ...card('Storage', 'open'),
    ...['Cache', 'Index', 'Backup', 'Quota'].flatMap((id) => card(id, 'open', 'Storage')),
    ...card('Later', 'decided'), ...card('Wrong', 'decided'), ...card('Outside', 'open'),
    linked('Backup', 'Later', 'depends_on'), linked('Quota', 'Wrong', 'depends_on'),
  )
  ok(p, ['reopen', 'Later', '--reason', 'postponed', '--why', 'not now'])
  ok(p, ['reopen', 'Wrong', '--reason', 'rejected', '--why', 'wrong'])
  const out = ok(p, ['find', 'Storage'])
  expect(listed(out, 'Cache')).toBe(true)
  expect(listed(out, 'Index')).toBe(true)
  expect(listed(out, 'Backup')).toBe(false)
  expect(listed(out, 'Quota')).toBe(false)
  expect(listed(out, 'Outside')).toBe(false)
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  const p = projectWith(...card('Storage', 'open'), ...card('Cache', 'open', 'Storage'), ...card('Index', 'open', 'Storage'))
  ok(p, ['remove', 'Cache', '--actor', 'you'])
  let out = ok(p, ['find', 'Storage'])
  expect(listed(out, 'Index')).toBe(true)
  expect(listed(out, 'Cache')).toBe(false)
  ok(p, ['restore', 'Cache'])
  out = ok(p, ['find', 'Storage'])
  expect(listed(out, 'Cache')).toBe(true)
  expect(listed(out, 'Index')).toBe(true)
})
