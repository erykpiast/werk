import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const isRemoved = (id: string) => /state: removed/.test(p.show(id))
const childrenOnMap = (id: string) => {
  const g = p.graph()
  return [...g.edges, ...g.ghostEdges].filter((e) => e.type === 'refines' && e.to === id).map((e) => e.from)
}
const removedList = () => p.ok(['removed']).stdout

function card(id: string, parent?: string) {
  p.realCard(id, `Title ${id}`, parent ? ['--parent', parent] : [])
}
function openCard(id: string, parent?: string) {
  card(id, parent)
  p.ok(['status', id, 'open'])
}

test('66.1', () => {
  p = project()
  card('storage')
  card('cache', 'storage')
  card('index', 'storage')
  card('eviction', 'cache')
  const before = p.lines()
  // remove is for the person: the agent passes --actor you, as the verb requires.
  p.ok(['remove', 'cache', '--actor', 'you'])
  expect(isRemoved('cache')).toBe(true)
  expect(isRemoved('eviction')).toBe(true)
  const kids = childrenOnMap('storage')
  expect(kids).not.toContain('cache')
  expect(p.graph().nodes.map((n) => n.id)).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(removedList()).toContain('#cache')
  const after = p.lines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
})

test('66.2', () => {
  p = project()
  card('storage')
  card('cache', 'storage')
  card('eviction', 'cache')
  card('memory-budget')
  p.ok(['link', 'cache', 'memory-budget', '--type', 'depends_on'])
  p.ok(['remove', 'cache', '--actor', 'you'])
  p.ok(['restore', 'cache'])
  expect(isRemoved('cache')).toBe(false)
  expect(childrenOnMap('storage')).toContain('cache')
  expect(childrenOnMap('cache')).toContain('eviction')
  expect(p.show('cache')).toContain('link: depends_on -> #memory-budget')
  expect(removedList()).not.toContain('#cache')
})

test('66.3', () => {
  p = project()
  card('storage')
  card('bad-layer', 'storage')
  card('write-path', 'bad-layer')
  card('read-path', 'bad-layer')
  p.ok(['remove', 'bad-layer', '--reparent', '--actor', 'you'])
  expect(isRemoved('bad-layer')).toBe(true)
  const kids = childrenOnMap('storage')
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(isRemoved('write-path')).toBe(false)
  expect(isRemoved('read-path')).toBe(false)
})

test('66.4', () => {
  p = project()
  card('storage')
  for (const id of ['cache', 'index', 'backup', 'quota']) openCard(id, 'storage')
  p.decided('later-thing')
  p.decided('wrong-thing')
  p.ok(['link', 'backup', 'later-thing', '--type', 'depends_on'])
  p.ok(['link', 'quota', 'wrong-thing', '--type', 'depends_on'])
  p.ok(['reopen', 'later-thing', '--reason', 'postponed', '--why', 'later'])
  p.ok(['reopen', 'wrong-thing', '--reason', 'rejected', '--why', 'wrong'])
  expect(p.graph().marks['backup']?.mark).toBe('paused')
  expect(p.graph().marks['quota']?.mark).toBe('stale')
  openCard('outside')
  const out = p.ok(['find', 'storage']).stdout
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
  expect(out).not.toContain('#backup')
  expect(out).not.toContain('#quota')
  expect(out).not.toContain('#outside')
})

test('66.5', () => {
  p = project()
  card('storage')
  openCard('cache', 'storage')
  openCard('index', 'storage')
  p.ok(['remove', 'cache', '--actor', 'you'])
  let out = p.ok(['find', 'storage']).stdout
  expect(out).toContain('#index')
  expect(out).not.toContain('#cache')
  p.ok(['restore', 'cache'])
  out = p.ok(['find', 'storage']).stdout
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
})
