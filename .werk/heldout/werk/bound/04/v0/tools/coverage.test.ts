import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkGate, formatGate, parseLcov, percent } from './coverage.ts'
import { PURE_FILES, THRESHOLD } from './pure-files.ts'

const record = (file: string, found: number, hit: number) => `TN:\nSF:${file}\nFNF:0\nFNH:0\nLF:${found}\nLH:${hit}\nend_of_record\n`

describe('parseLcov', () => {
  test('reads the line counts of each record', () => {
    const report = parseLcov(record('a.ts', 10, 9) + record('b.ts', 4, 4))
    expect(report.get('a.ts')).toEqual({ linesFound: 10, linesHit: 9 })
    expect(report.get('b.ts')).toEqual({ linesFound: 4, linesHit: 4 })
  })

  test('ignores a record with no end', () => {
    expect(parseLcov('SF:a.ts\nLF:3\nLH:1\n').size).toBe(0)
  })
})

describe('checkGate', () => {
  test('passes when every listed file is at or over the threshold', () => {
    const report = parseLcov(record('a.ts', 10, 9) + record('b.ts', 10, 10) + record('c.ts', 10, 1))
    const result = checkGate(report, ['a.ts', 'b.ts'], 90)
    expect(result.ok).toBe(true)
    expect(result.rows.map((row) => row.percent)).toEqual([90, 100])
  })

  test('fails when one listed file is under the threshold', () => {
    const report = parseLcov(record('a.ts', 1000, 899) + record('b.ts', 10, 10))
    const result = checkGate(report, ['a.ts', 'b.ts'], 90)
    expect(result.ok).toBe(false)
    expect(result.rows[0]).toEqual({ file: 'a.ts', percent: 89.9, ok: false })
  })

  test('fails when a listed file is missing from the report', () => {
    const result = checkGate(new Map(), ['a.ts'], 90)
    expect(result).toEqual({ ok: false, rows: [{ file: 'a.ts', percent: undefined, ok: false }] })
  })

  test('a file with no lines counts as covered', () => {
    expect(percent({ linesFound: 0, linesHit: 0 })).toBe(100)
  })
})

test('the report names each file and the verdict', () => {
  const pass = formatGate(checkGate(parseLcov(record('a.ts', 2, 2)), ['a.ts'], 90), 90)
  expect(pass).toBe('ok    a.ts  100.00%\ncoverage gate passed: every pure file is at or over 90%')
  const fail = formatGate(checkGate(new Map(), ['a.ts'], 90), 90)
  expect(fail).toBe('FAIL  a.ts  not in the report\ncoverage gate failed: 1 pure file(s) under 90%')
})

describe('the gate command', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  const gate = (lcov: string | undefined) => {
    dir = mkdtempSync(join(tmpdir(), 'werk-gate-'))
    const path = join(dir, 'lcov.info')
    if (lcov !== undefined) writeFileSync(path, lcov)
    return spawnSync(process.execPath, [join(import.meta.dir, 'coverage-gate.ts'), path], { encoding: 'utf8' })
  }

  test('exits 0 when every pure file is at or over the threshold', () => {
    const result = gate(PURE_FILES.map((file) => record(file, 10, 9)).join(''))
    expect(THRESHOLD).toBe(90)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('coverage gate passed')
  })

  test('exits 1 when one pure file is under the threshold', () => {
    const [first, ...rest] = PURE_FILES
    const result = gate(record(first!, 100, 89) + rest.map((file) => record(file, 10, 10)).join(''))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`FAIL  ${first}  89.00%`)
  })

  test('exits 1 when there is no report', () => {
    const result = gate(undefined)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no report at')
  })
})
