import { expect, test } from 'bun:test'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh } from './util.ts'

function evidence(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? evidence(p) : name.endsWith('.png') ? [p] : []
  })
}

test('69.5 make e2e runs every spec on a copy of the fixture, with one screenshot per test', () => {
  const dir = freshClone()
  const fixtureLog = sh('git hash-object e2e/fixture-project/.werk/log.jsonl', dir).out
  const r = sh('make e2e', dir)
  console.log(r.out.slice(-4000))
  expect(r.code).toBe(0)
  const results = r.out.split('\n').filter((l) => /^\s+(✓|✘|-)\s+\d+ \[chromium\]/.test(l))
  const passed = Number(/(\d+) passed/.exec(r.out)?.[1] ?? 0)
  const failed = Number(/(\d+) failed/.exec(r.out)?.[1] ?? 0)
  expect(results.length).toBe(passed + failed)
  const pngs = evidence(join(dir, 'test-results'))
  console.log('69.5 tests:', passed + failed, 'screenshots:', pngs.length)
  expect(pngs.length).toBe(passed + failed)
  expect(sh('git hash-object e2e/fixture-project/.werk/log.jsonl', dir).out).toBe(fixtureLog)
  expect(existsSync(join(dir, '.werk'))).toBe(false)
  expect(sh('git status --porcelain', dir).out.trim()).toBe('')
}, 20 * 60_000)
