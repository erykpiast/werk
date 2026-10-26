/** Held-out step 95.4: the browser test server refuses to start when the fake agent is not first. Runs in a clone outside the repo. */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, HOURS, personEnv, sh } from './clone.ts'

test(
  '95.4 the browser test server refuses to start when the fake agent is not first',
  async () => {
    const { dir, root } = freshClone()
    const base = personEnv()
    expect((await sh(['bun', 'install', '--frozen-lockfile'], dir, base)).code).toBe(0)
    // The real agent's folder, first on the program search list.
    const realBin = join(root, 'real-bin')
    mkdirSync(realBin)
    writeFileSync(join(realBin, 'claude'), `#!/bin/sh\ntouch ${JSON.stringify(join(root, 'real-agent-ran'))}\necho REAL\n`, { mode: 0o755 })
    const env = { ...base, PATH: `${realBin}:${base.PATH}`, CI: 'true' }
    const r = await sh(['bunx', 'playwright', 'test', 'e2e/map.spec.ts', '--reporter=list', `--output=${join(root, 'out')}`], dir, env)
    console.log(r.out.slice(-2500))
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/fake agent/)
    expect(r.out).toMatch(/PATH/)
    // No browser test ran: the list reporter prints no passed test.
    expect(r.out).not.toMatch(/\d+ passed/)
  },
  HOURS,
)
