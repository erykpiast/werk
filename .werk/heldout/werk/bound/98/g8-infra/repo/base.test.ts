/** 61.1 and 95.5: a fresh clone builds on an empty first commit and passes every check. */
import { expect, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh } from './clone.ts'

const LONG = 1_800_000

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = freshClone()
  // The main branch of the clone: the checkout's main, which is HEAD here.
  const main = sh('git rev-parse origin/main', dir).out.trim()
  const roots = sh(`git rev-list --max-parents=0 ${main}`, dir).out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  // The first commit holds no files.
  expect(sh(`git ls-tree -r --name-only ${first}`, dir).out.trim()).toBe('')
  // Every later commit on main has the first commit as an ancestor.
  const all = sh(`git rev-list ${main}`, dir).out.trim().split('\n')
  const notDescending = all.filter((c) => sh(`git merge-base --is-ancestor ${first} ${c}`, dir).code !== 0)
  expect(notDescending).toEqual([])

  const results: Record<string, { code: number; tail: string }> = {}
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(`make ${target}`, dir)
    results[target] = { code: r.code, tail: r.out.slice(-1500) }
  }
  console.log(JSON.stringify(results, null, 1))
  for (const target of Object.keys(results)) expect({ target, code: results[target]!.code }).toEqual({ target, code: 0 })

  // make e2e passes although the project has no browser spec yet: the clone with its specs taken away.
  for (const spec of sh('ls e2e/*.spec.ts', dir).out.trim().split('\n')) rmSync(join(dir, spec))
  const e2e = sh('make e2e', dir)
  console.log('e2e with no spec:', e2e.code, e2e.out.slice(-600))
  expect(e2e.code).toBe(0)
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)

test('95.5 a fresh clone passes its checks with no manual step', () => {
  const dir = freshClone()
  expect(existsSync(join(dir, 'node_modules'))).toBe(false)
  const r = sh('make test', dir)
  console.log(r.out.slice(0, 600), '\n...\n', r.out.slice(-600))
  // The run installs the locked packages first.
  const install = r.out.indexOf('bun install --frozen-lockfile')
  expect(install).toBeGreaterThanOrEqual(0)
  expect(install).toBeLessThan(r.out.indexOf('bun test'))
  expect(existsSync(join(dir, 'node_modules'))).toBe(true)
  // The tests run inside v0's own directory.
  expect(r.out).toMatch(new RegExp(`cd (/private)?${dir.replace(/^\/private/, "")} && CI=true bun run test`))
  expect(r.code).toBe(0)
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)
