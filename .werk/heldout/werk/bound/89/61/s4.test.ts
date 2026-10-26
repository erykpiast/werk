import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh, tail } from './util.ts'

const FILE = 'src/cli/registry.ts'
const TEST = 'src/cli/registry.test.ts'
// What is left of the own test after the deletion: one test that loads the module and
// makes an empty registry, so most lines of registry.ts do not run.
const CUT = `import { expect, test } from 'bun:test'
import { createRegistry } from './registry.ts'

test('makes an empty registry', () => {
  expect(createRegistry().list()).toEqual([])
})
`

// 61.4
// Scenario: The coverage gate fails below 90% on a pure file and passes again at 90% or above
// Given a person has a copy of the werk project where `make test-coverage` passes
// When the person deletes enough unit tests that one file on the pure-file list drops below 90% coverage
// And the person runs `make test`
// Then `make test` exits with success, because plain unit tests do not check coverage
// When the person runs `make test-coverage`
// Then `make test-coverage` exits with an error
// And the output names that file and its coverage percentage
// When the person restores the deleted tests and runs `make test-coverage` again
// Then `make test-coverage` exits with success
test('61.4', () => {
  const dir = freshClone('s4')
  const install = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(install.code, tail(install.out)).toBe(0)
  const pure = readFileSync(join(dir, 'src/coverage/pure-files.ts'), 'utf8')
  expect(pure).toContain(`'${FILE}'`)

  const base = sh(['make', 'test-coverage'], dir)
  console.log(`61.4: baseline make test-coverage -> ${base.code}\n${tail(base.out, 600)}`)
  expect(base.code).toBe(0)

  const original = readFileSync(join(dir, TEST), 'utf8')
  writeFileSync(join(dir, TEST), CUT)

  const t = sh(['make', 'test'], dir)
  console.log(`61.4: make test after the cut -> ${t.code}\n${tail(t.out, 600)}`)
  const cov = sh(['make', 'test-coverage'], dir)
  const line = cov.out.split('\n').find((l) => l.includes(FILE) && /%/.test(l))
  console.log(`61.4: make test-coverage after the cut -> ${cov.code}; line: ${line}\n${tail(cov.out, 800)}`)

  writeFileSync(join(dir, TEST), original)
  const back = sh(['make', 'test-coverage'], dir)
  console.log(`61.4: make test-coverage after restore -> ${back.code}\n${tail(back.out, 400)}`)

  expect(t.code).toBe(0)
  expect(cov.code).not.toBe(0)
  expect(line).toBeDefined()
  const pct = Number(/(\d+(?:\.\d+)?)%/.exec(line!)?.[1])
  expect(pct).toBeLessThan(90)
  expect(back.code).toBe(0)
  expect(sh(['git', 'status', '--porcelain'], dir).out).toBe('')
}, 1_800_000)
