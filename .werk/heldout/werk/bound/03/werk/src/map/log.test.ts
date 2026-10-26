import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvent, logPath, readLog, readMap } from './log.ts'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})
const project = () => (dir = mkdtempSync(join(tmpdir(), 'werk-log-')))
const now = new Date('2026-10-19T10:00:00.000Z')

test('a missing log reads as an empty map', () => {
  const p = project()
  expect(readLog(logPath(p))).toEqual([])
  expect(readMap(p).seq).toBe(0)
})

test('append writes one JSON line per event, numbered from 1, and creates .werk/', () => {
  const p = project()
  const path = logPath(p)
  appendEvent(path, { type: 'added', id: 'a', kind: 'card', title: 'A' }, now)
  appendEvent(path, { type: 'retitled', id: 'a', title: 'B' }, now)
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    { type: 'added', id: 'a', kind: 'card', title: 'A', seq: 1, at: now.toISOString() },
    { type: 'retitled', id: 'a', title: 'B', seq: 2, at: now.toISOString() },
  ])
  expect(readMap(p).cards.a!.title).toBe('B')
})

test('a refused event writes nothing, and the log stays byte for byte as it was', () => {
  const p = project()
  const path = logPath(p)
  appendEvent(path, { type: 'added', id: 'a', kind: 'card', title: 'A' }, now)
  const before = readFileSync(path)
  const result = appendEvent(path, { type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'missing' })
  expect(result).toEqual({ ok: false, message: 'no card #missing' })
  expect(readFileSync(path).equals(before)).toBe(true)
})

test('an append keeps every earlier line byte for byte and adds one line after them', () => {
  const p = project()
  const path = logPath(p)
  appendEvent(path, { type: 'added', id: 'a', kind: 'card', title: 'A' }, now)
  const before = readFileSync(path, 'utf8')
  const result = appendEvent(path, { type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a' }, now)
  const after = readFileSync(path, 'utf8')
  expect(after.startsWith(before)).toBe(true)
  expect(after.slice(before.length)).toBe(`${JSON.stringify({ type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a', seq: 2, at: now.toISOString() })}\n`)
  expect(result).toMatchObject({ ok: true, event: { seq: 2 } })
})

test('a line that is not JSON names the file and the line', () => {
  const p = project()
  const path = logPath(p)
  appendEvent(path, { type: 'added', id: 'a', kind: 'card', title: 'A' })
  writeFileSync(path, `${readFileSync(path, 'utf8')}{oops\n`)
  expect(() => readLog(path)).toThrow(`${path}:2: not a JSON event`)
})
