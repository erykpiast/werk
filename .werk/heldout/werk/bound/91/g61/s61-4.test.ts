import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { cloneRepo, sh } from './helpers.ts'

const FILE = 'src/build/usage.ts'
const TESTS = 'src/build/usage.test.ts'

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const { dir, done } = cloneRepo()
  try {
    const base = sh('make test-coverage', dir)
    expect(base.code).toBe(0)

    // Delete the first unit test of the pure file src/build/usage.ts.
    writeFileSync(
      join(dir, TESTS),
      `import { expect, test } from 'bun:test'
import { agentUsage } from './usage.ts'

test('a stream with no result event gives an unknown cost', () => {
  expect(agentUsage('{"type":"assistant"}\\nnull\\n')).toEqual({ costUsd: null, turns: null, reply: null })
})
`,
    )
    const plain = sh('make test', dir)
    expect(plain.code).toBe(0)

    const cov = sh('make test-coverage', dir)
    console.log(cov.out.split('\n').filter((l) => l.includes('usage.ts') || l.includes('coverage gate')).join('\n'))
    expect(cov.code).not.toBe(0)
    const line = cov.out.split('\n').find((l) => l.includes('FAIL') && l.includes(FILE))
    expect(line).toBeDefined()
    const pct = Number(/(\d+\.\d)%/.exec(line!)![1])
    expect(pct).toBeLessThan(90)

    expect(sh(`git checkout -- ${TESTS}`, dir).code).toBe(0)
    const again = sh('make test-coverage', dir)
    expect(again.code).toBe(0)
  } finally {
    done()
  }
}, 2_400_000)
