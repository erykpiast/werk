import { expect, test } from 'bun:test'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh, tail } from './util.ts'

// 61.1
// Scenario: A fresh clone builds on an empty first commit and passes every check
// Given a person clones the werk repository
// When the person lists the files of the first commit on the main branch
// Then the first commit holds no files
// And every later commit on the main branch has the first commit as an ancestor
// When the person installs the dependencies and runs `make test`, `make test-coverage`, `make typecheck`, `make lint` and `make e2e` one after the other
// Then each of the five commands exits with success
// And `make e2e` passes although the project has no browser spec yet
// Reading of the last line: the product now has specs, so `make e2e` must exit 0, the e2e
// script must carry `--pass-with-no-tests`, and with the specs removed in the clone it still exits 0.
test('61.1', () => {
  const dir = freshClone('s1')
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
  expect(roots.length).toBe(1)
  const first = roots[0]!
  const files = sh(['git', 'ls-tree', '-r', '--name-only', first], dir)
  expect(files.code).toBe(0)
  expect(files.out.trim()).toBe('')
  const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')
  const notDescendant = all.filter((c) => c !== first && sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code !== 0)
  expect(notDescendant).toEqual([])
  console.log(`61.1: first commit ${first}, ${all.length} commits on main, all descend from it`)

  const install = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(install.code, tail(install.out)).toBe(0)
  const results: Record<string, number> = {}
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir)
    results[target] = r.code
    console.log(`61.1: make ${target} -> ${r.code}\n${tail(r.out, 1500)}`)
  }
  expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })

  const pkg = JSON.parse(sh(['cat', 'package.json'], dir).out)
  expect(pkg.scripts.e2e).toContain('--pass-with-no-tests')
  for (const f of readdirSync(join(dir, 'e2e'))) if (/\.spec\.tsx?$/.test(f)) rmSync(join(dir, 'e2e', f))
  const noSpec = sh(['make', 'e2e'], dir)
  console.log(`61.1: make e2e with no spec -> ${noSpec.code}\n${tail(noSpec.out, 800)}`)
  expect(noSpec.code).toBe(0)
}, 2_400_000)
