import { afterAll, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { cleanEnv, copyWerk, run } from './helpers.ts'

const werk = copyWerk()
afterAll(() => rmSync(werk, { recursive: true, force: true }))

function treeHash(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, name.name)
      if (name.isDirectory()) walk(p)
      else h.update(relative(dir, p) + '\0' + readFileSync(p).toString('base64') + '\0')
    }
  }
  walk(dir)
  return h.digest('hex')
}

test('01.4 bun run e2e boots werk on a fixture copy, saves a screenshot per test, uses only the fake agent', () => {
  // Given no real agent can be reached: a trap `claude` sits first on the outer PATH and logs any call
  const trapDir = join(werk, '.trap')
  mkdirSync(trapDir)
  const trapLog = join(werk, '.trap-calls')
  writeFileSync(join(trapDir, 'claude'), `#!/bin/sh\necho "$@" >> ${trapLog}\nexit 1\n`)
  chmodSync(join(trapDir, 'claude'), 0o755)
  const fixture = join(werk, 'e2e', 'fixtures', 'demo')
  const before = treeHash(fixture)
  const port = String(20000 + Math.floor(Math.random() * 20000))
  const env = cleanEnv({ PATH: `${trapDir}:${process.env.PATH}`, WERK_E2E_PORT: port })
  delete env.CI
  // When the agent runs `bun run e2e`
  const r = run('bun', ['run', 'e2e'], werk, env)
  console.log(r.out)
  // Then the command boots a real werk server on a copy of the fixture project
  expect(r.out).toMatch(new RegExp(`werk: serving \\S*werk-e2e-[^/\\s]+/demo at http://localhost:${port} `))
  // And the original fixture project stays unchanged after the run
  expect(treeHash(fixture)).toBe(before)
  // And each browser test opens the page that werk serves (all tests pass against it)
  const passed = Number(r.out.match(/(\d+) passed/)?.[1] ?? 0)
  expect(r.code).toBe(0)
  expect(passed).toBeGreaterThan(0)
  // And the run saves one screenshot for each test as evidence
  const evidence = readdirSync(join(werk, 'e2e', 'evidence')).filter((f) => f.endsWith('.png'))
  console.log('evidence:', evidence)
  expect(evidence.length).toBe(passed)
  // And every agent call during the run goes to the scripted fake agent
  expect(existsSync(trapLog)).toBe(false)
}, 300_000)
