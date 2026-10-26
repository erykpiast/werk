/** 61.4: the coverage gate fails below 90% on a pure file and passes again at 90% or above. */
import { afterAll, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { clone } from './repo.helpers.ts'

const c = clone()
afterAll(() => c.cleanup())

test('61.4 deleting the unit tests of src/ticket/spec.ts trips the gate; restoring them passes it', () => {
  expect(c.run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
  const base = c.run(['make', 'test-coverage'])
  if (base.code !== 0) console.error(base.out.slice(-3000))
  expect(base.code).toBe(0)

  rmSync(join(c.dir, 'src', 'ticket', 'spec.test.ts'))
  expect(c.run(['make', 'test']).code).toBe(0)
  const cov = c.run(['make', 'test-coverage'])
  console.error(cov.out.split('\n').filter((l) => /spec\.ts|gate/i.test(l)).join('\n'))
  expect(cov.code).not.toBe(0)
  expect(cov.out).toMatch(/^.*\d+(\.\d+)?%\s+src\/ticket\/spec\.ts.*$/m)

  expect(c.run(['git', 'checkout', '--', 'src/ticket/spec.test.ts']).code).toBe(0)
  const again = c.run(['make', 'test-coverage'])
  expect(again.code).toBe(0)
}, 900_000)
