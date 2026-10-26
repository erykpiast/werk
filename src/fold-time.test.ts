import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fold } from './fold.ts'
import { foldLog, foldTimes } from './fold-time.ts'
import { append, readEvents } from './log.ts'
import { paths } from './project.ts'

const scratch = () => join(mkdtempSync(join(tmpdir(), 'werk-foldtime-')), 'nested', 'fold-times.jsonl')

describe('fold times', () => {
  test('the file sits beside the scratch log, never in the repository', () => {
    expect(paths.foldTimes.startsWith(join(paths.log, '..'))).toBe(true)
  })

  test('a timed read returns the same graph as a plain fold of the log', () => {
    append('node.added', { id: 'ft-a', kind: 'card', title: 'A', status: 'open' })
    const g = foldLog('test', scratch())
    expect([...g.nodes.keys()]).toEqual([...fold(readEvents()).nodes.keys()])
  })

  test('a timed read appends one line: the log size, the time, and the read', () => {
    const path = scratch()
    foldLog('werk show', path)
    foldLog('/api/graph', path)
    const rows = foldTimes(readFileSync(path, 'utf8'))
    expect(rows.map((r) => r.via)).toEqual(['werk show', '/api/graph'])
    expect(rows[0].events).toBe(readEvents().length)
    expect(rows[0].ms).toBeGreaterThanOrEqual(0)
  })

  test('a read still returns its graph when the time cannot be written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'werk-foldtime-'))
    const blocker = join(dir, 'file')
    writeFileSync(blocker, '')
    expect(foldLog('test', join(blocker, 'fold-times.jsonl')).nodes).toBeDefined()
  })

  test('parsing skips a cut-off line and a line that is not a fold time', () => {
    const text = [
      '{"at":"2026-10-01T00:00:00Z","events":10,"ms":1.5,"via":"a"}',
      '{"at":"2026-10-01T00:00:01Z","events":',
      '{"at":"2026-10-01T00:00:02Z","ms":"x","events":3}',
      '{"at":"2026-10-01T00:00:03Z","events":12,"ms":2}',
    ].join('\n')
    expect(foldTimes(text)).toEqual([
      { at: '2026-10-01T00:00:00Z', events: 10, ms: 1.5, via: 'a' },
      { at: '2026-10-01T00:00:03Z', events: 12, ms: 2, via: '' },
    ])
  })

  test('parsing keeps only the lines from the given time on', () => {
    const text = '{"at":"2026-10-01T00:00:00Z","events":1,"ms":1}\n{"at":"2026-10-08T00:00:00Z","events":2,"ms":1}'
    expect(foldTimes(text, Date.parse('2026-10-05T00:00:00Z')).map((r) => r.events)).toEqual([2])
  })
})
