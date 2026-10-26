// The part of permission.ts that keeps state: allow.json, asks.jsonl and the open-ask queue.
// Both files sit next to WERK_LOG, which the preload points at a scratch dir.
import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { addAlways, appendAsk, Asks, readAlways, type Ask } from './permission.ts'
import { paths } from './project.ts'

const ALLOW_PATH = paths.allow
const ASKS_PATH = paths.asks

const ask = (id: string, extra: Partial<Ask> = {}): Ask => ({
  id,
  at: '2026-01-01T00:00:00.000Z',
  tool: 'Bash',
  label: 'curl example.com',
  input: { command: 'curl example.com' },
  convo: 'main',
  ...extra,
})

describe('allow.json', () => {
  beforeEach(() => rmSync(ALLOW_PATH, { force: true }))

  test('no file holds nothing', () => {
    expect(readAlways()).toEqual({ rules: [], dirs: [] })
  })

  test('addAlways merges without duplicates and writes the file', () => {
    addAlways({ rules: ['Read'] })
    const next = addAlways({ rules: ['Read', 'Bash(ls)'], dirs: ['/tmp/x'] })
    expect(next).toEqual({ rules: ['Read', 'Bash(ls)'], dirs: ['/tmp/x'] })
    expect(readAlways()).toEqual(next)
  })

  test('the old bare-array file still reads as rules', () => {
    writeFileSync(ALLOW_PATH, JSON.stringify(['Read', 7]))
    expect(readAlways()).toEqual({ rules: ['Read'], dirs: [] })
  })

  test('a corrupt file reads as empty instead of stopping the server', () => {
    writeFileSync(ALLOW_PATH, '{nope')
    expect(readAlways()).toEqual({ rules: [], dirs: [] })
  })

  test('a field of the wrong type reads as empty', () => {
    writeFileSync(ALLOW_PATH, JSON.stringify({ rules: 'Read', dirs: null }))
    expect(readAlways()).toEqual({ rules: [], dirs: [] })
  })
})

describe('asks.jsonl', () => {
  test('one line per resolved ask; only always records what it widened', () => {
    rmSync(ASKS_PATH, { force: true })
    const updates = [{ type: 'addRules' as const, rules: [{ toolName: 'Read' }], behavior: 'allow' as const }]
    appendAsk(ask('1', { always: { label: 'Read', updates } }), 'always')
    appendAsk(ask('2', { always: { label: 'Read', updates } }), 'allow')
    const lines = readFileSync(ASKS_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => [l.decision, l.widened])).toEqual([
      ['always', updates],
      ['allow', undefined],
    ])
    expect(existsSync(ASKS_PATH)).toBe(true)
  })
})

describe('the open-ask queue', () => {
  test('put waits for an answer, and listeners see the queue change both ways', async () => {
    const asks = new Asks()
    const seen: number[] = []
    const off = asks.onChange((open) => seen.push(open.length))
    const answer = asks.put(ask('a'))
    expect(asks.open().map((a) => a.id)).toEqual(['a'])
    expect(asks.answer('a', 'deny', 'picked B')).toBe(true)
    expect(await answer).toEqual({ decision: 'deny', message: 'picked B' })
    expect(seen).toEqual([1, 0])
    off()
  })

  test('an unknown id is not an error, so a double click is harmless', () => {
    expect(new Asks().answer('nope', 'allow')).toBe(false)
  })

  test('clear answers every open ask with deny by default', async () => {
    const asks = new Asks()
    const one = asks.put(ask('1'))
    const two = asks.put(ask('2'))
    asks.clear()
    expect(await Promise.all([one, two])).toEqual([
      { decision: 'deny', message: undefined },
      { decision: 'deny', message: undefined },
    ])
    expect(asks.open()).toEqual([])
  })
})
