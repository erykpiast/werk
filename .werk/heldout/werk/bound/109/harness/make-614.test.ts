/** Held-out step 61.4: the coverage gate fails below 90% on a pure file and passes again. Runs in a clone outside the repo. */
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, git, HOURS, personEnv, sh } from './clone.ts'

const PURE = 'src/cli/args.ts'
const OWN_TEST = 'src/cli/args.test.ts'

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  async () => {
    const { dir } = freshClone()
    const env = personEnv()
    const given = await sh(['make', 'test-coverage'], dir, env)
    expect(given.code).toBe(0)

    // Delete every unit test of args.ts but the first one.
    const path = join(dir, OWN_TEST)
    const parts = readFileSync(path, 'utf8').split('\n\ntest(')
    writeFileSync(path, `${parts[0]}\n\ntest(${parts[1]}\n`)

    const plain = await sh(['make', 'test'], dir, env)
    if (plain.code !== 0) console.log(plain.out.slice(-3000))
    expect(plain.code).toBe(0)

    const gate = await sh(['make', 'test-coverage'], dir, env)
    expect(gate.code).not.toBe(0)
    const line = gate.out.split('\n').find((l) => l.includes(PURE))
    expect(line).toBeDefined()
    const pct = Number(/(\d+(?:\.\d+)?)%/.exec(line!)?.[1])
    expect(pct).toBeLessThan(90)

    git(dir, 'checkout', '--', OWN_TEST)
    const again = await sh(['make', 'test-coverage'], dir, env)
    expect(again.code).toBe(0)
  },
  HOURS,
)
