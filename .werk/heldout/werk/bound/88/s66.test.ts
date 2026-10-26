/** Held-out steps 66.1-66.5: remove, restore, reparent, find. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../src/map/events.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, killed, linked, logOf, noBasis, proposed, statusSet, whoSet } from '../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

const card = (id: string, title: string, status: 'open' | 'decided', parent?: string): NewEvent[] => [
  proposed(id, { title, status: 'open', ...(parent !== undefined && { parent }) }),
  accepted(id),
  ...(status === 'decided' ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
]

const logFile = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => readFileSync(logFile(), 'utf8').split('\n').filter(Boolean)

const seed = (...events: NewEvent[]) => {
  p = makeProject()
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(logFile(), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
}

const ok = (args: string[]) => {
  const r = p.werk(args)
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  return r.stdout
}

/** The children "under" a card in the map: the refines links into it that show prints. */
const childrenOf = (id: string) => [...ok(['show', id]).matchAll(/link: refines <- #(\S+)/g)].map((m) => m[1])

test('66.1 an agent removes a bad branch and the log keeps its history', () => {
  seed(
    ...card('storage', 'Storage', 'decided'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
    ...card('eviction', 'Eviction', 'open', 'cache'),
  )
  const before = logLines()
  ok(['remove', 'cache', '--actor', 'you'])
  expect(ok(['show', 'cache'])).toContain('state: removed')
  expect(ok(['show', 'eviction'])).toContain('state: removed')
  const kids = childrenOf('storage')
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(['removed'])).toContain('Cache')
  const after = logLines()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 a person restores a removed card and its subtree with their links', () => {
  seed(
    ...card('storage', 'Storage', 'decided'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('eviction', 'Eviction', 'open', 'cache'),
    ...card('memory', 'Memory budget', 'open'),
    linked('cache', 'memory', 'depends_on'),
  )
  ok(['remove', 'cache', '--actor', 'you'])
  ok(['restore', 'cache'])
  const shown = ok(['show', 'cache'])
  expect(shown).not.toContain('removed')
  expect(childrenOf('storage')).toContain('cache')
  expect(childrenOf('cache')).toContain('eviction')
  expect(shown).toContain('link: depends_on -> #memory')
  expect(ok(['removed'])).not.toContain('Cache')
})

test('66.3 an agent removes a bad parent but keeps its good children', () => {
  seed(
    ...card('storage', 'Storage', 'decided'),
    ...card('bad', 'Bad layer', 'open', 'storage'),
    ...card('write', 'Write path', 'open', 'bad'),
    ...card('read', 'Read path', 'open', 'bad'),
  )
  ok(['remove', 'bad', '--actor', 'you', '--reparent'])
  expect(ok(['show', 'bad'])).toContain('state: removed')
  const kids = childrenOf('storage')
  expect(kids).toContain('write')
  expect(kids).toContain('read')
  expect(ok(['show', 'write'])).not.toContain('removed')
  expect(ok(['show', 'read'])).not.toContain('removed')
})

test('66.4 an agent finds the open cards it can work on in a subtree', () => {
  seed(
    ...card('storage', 'Storage', 'decided'),
    ...card('later', 'Later basis', 'decided'),
    ...card('wrong', 'Wrong basis', 'decided'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
    ...card('backup', 'Backup', 'open', 'storage'),
    ...card('quota', 'Quota', 'open', 'storage'),
    ...card('outside', 'Outside work', 'open'),
    linked('backup', 'later', 'depends_on'),
    linked('quota', 'wrong', 'depends_on'),
  )
  ok(['reopen', 'later', '--reason', 'postponed', '--why', 'not now'])
  ok(['reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong'])
  const stale = ok(['stale'])
  expect(stale).toContain('#backup')
  expect(stale).toContain('#quota')
  const found = ok(['find', 'storage'])
  expect(found).toContain('#cache')
  expect(found).toContain('#index')
  expect(found).not.toContain('#backup')
  expect(found).not.toContain('#quota')
  expect(found).not.toContain('#outside')
})

test('66.5 a removed branch drops out of the find result and comes back after a restore', () => {
  seed(
    ...card('storage', 'Storage', 'decided'),
    ...card('cache', 'Cache', 'open', 'storage'),
    ...card('index', 'Index', 'open', 'storage'),
  )
  ok(['remove', 'cache', '--actor', 'you'])
  const first = ok(['find', 'storage'])
  expect(first).toContain('#index')
  expect(first).not.toContain('#cache')
  ok(['restore', 'cache'])
  const again = ok(['find', 'storage'])
  expect(again).toContain('#cache')
  expect(again).toContain('#index')
})
