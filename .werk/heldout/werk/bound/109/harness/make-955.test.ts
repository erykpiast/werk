/** Held-out step 95.5: a fresh clone passes its checks with no manual step. Runs in a clone outside the repo. */
import { expect, test } from 'bun:test'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, HOURS, personEnv, sh } from './clone.ts'

test(
  '95.5 a fresh clone passes its checks with no manual step',
  async () => {
    const { dir } = freshClone()
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)
    const r = await sh(['make', 'test'], dir, personEnv())
    const install = r.out.indexOf('bun install --frozen-lockfile')
    const tests = r.out.indexOf('bun test')
    expect(install).toBeGreaterThanOrEqual(0)
    expect(tests).toBeGreaterThan(install)
    expect(existsSync(join(dir, 'node_modules', '.installed'))).toBe(true)
    // The tests run in the clone's own folder.
    expect(r.out).toContain(`cd ${realpathSync(dir)} && CI=true bun run test`)
    if (r.code !== 0) console.log(r.out.slice(-3000))
    expect(r.code).toBe(0)
  },
  HOURS,
)
