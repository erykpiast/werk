// The pure-file coverage gate: what is on the list (#werk-test-pure-list-union), and whose
// lines count for a file (#werk-reflink-own-test-coverage).
import { describe, expect, test } from 'bun:test'
import { judge, lcovRecords, ownTestFile, parseLcov, parsePureList } from './coverage-gate.ts'

describe('the list of pure files is a set', () => {
  test('a repeat counts once, and comments and blank lines are not entries', () => {
    // Both sides of a merge added y; the union driver keeps both lines.
    expect(parsePureList('# head\na\nb\n\nx  # from X\ny\ny\n')).toEqual(['a', 'b', 'x', 'y'])
  })
})

describe('own test file', () => {
  test('a file under src/ owns the test beside it; a file under web/ owns the test in src/', () => {
    expect(ownTestFile('src/fold.ts')).toBe('src/fold.test.ts')
    expect(ownTestFile('src/gridsys/parse.ts')).toBe('src/gridsys/parse.test.ts')
    expect(ownTestFile('web/md.js')).toBe('src/md.test.ts')
  })
})

describe('the verdict', () => {
  const lcov = 'SF:src/r.ts\nDA:1,1\nLF:10\nLH:10\nend_of_record\nSF:src/k.ts\nLF:4\nLH:4\nend_of_record\n'

  test('lcovRecords keeps each record whole, so one file can be cut out of a run', () => {
    const records = lcovRecords(lcov)
    expect([...records.keys()]).toEqual(['src/r.ts', 'src/k.ts'])
    expect(records.get('src/r.ts')).toBe('SF:src/r.ts\nDA:1,1\nLF:10\nLH:10\nend_of_record\n')
    expect(parseLcov(lcov).get('src/k.ts')).toEqual({ found: 4, hit: 4 })
  })

  test("a file with no own test file is 0% and names the missing test, even when a caller's test ran it", () => {
    // R-test ran every line of K, but only R's record was kept from that run.
    const report = parseLcov(lcovRecords(lcov).get('src/r.ts')!)
    const [r, k] = judge(['src/r.ts', 'src/k.ts'], report, new Set(['src/k.ts']))
    expect(r).toMatchObject({ ok: true, pct: 100 })
    expect(k).toMatchObject({ ok: false, pct: 0, detail: 'no own test file: src/k.test.ts is missing' })
  })

  test('a file that its own test does not load is 0%', () => {
    const [v] = judge(['src/q.ts'], new Map(), new Set())
    expect(v).toMatchObject({ ok: false, pct: 0 })
  })
})
