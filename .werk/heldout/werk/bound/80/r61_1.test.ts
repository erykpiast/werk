/** 61.1: a fresh clone builds on an empty first commit and passes every check. */
import { afterAll, expect, test } from 'bun:test'
import { clone } from './repo.helpers.ts'

const c = clone()
afterAll(() => c.cleanup())

test('61.1 the first commit holds no files, and every later commit descends from it', () => {
  const roots = c.run(['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
  expect(roots.length).toBe(1)
  const first = roots[0]!
  expect(c.run(['git', 'ls-tree', '-r', '--name-only', first]).out).toBe('')
  for (const commit of c.run(['git', 'rev-list', 'main']).out.trim().split('\n')) {
    expect(c.run(['git', 'merge-base', '--is-ancestor', first, commit]).code).toBe(0)
  }
})

test('61.1 the five make targets pass one after the other', () => {
  expect(c.run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
  expect(c.run(['sh', '-c', 'ls e2e | grep -E "\\.(spec|test)\\.[jt]sx?$" || true']).out.trim()).toBe('')
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = c.run(['make', target])
    if (r.code !== 0) console.error(`make ${target} failed:\n${r.out.slice(-3000)}`)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
}, 900_000)
