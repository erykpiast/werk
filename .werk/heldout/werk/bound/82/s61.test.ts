import { expect, test } from 'bun:test'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { freshClone, sh } from './util.ts'

const T = 20 * 60_000

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = freshClone(false)
  const first = sh('git rev-list --max-parents=0 main', dir).out.trim().split('\n')
  expect(first).toHaveLength(1)
  expect(sh(`git ls-tree -r --name-only ${first[0]}`, dir).out.trim()).toBe('')
  const all = sh('git rev-list main', dir).out.trim().split('\n')
  for (const c of all) expect(sh(`git merge-base --is-ancestor ${first[0]} ${c}`, dir).code).toBe(0)
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(`make ${target}`, dir)
    if (r.code !== 0) console.log(`make ${target} failed:\n${r.out.slice(-3000)}`)
    expect(`${target}:${r.code}`).toBe(`${target}:0`)
  }
  // The project now has browser specs. Check the no-spec case too: a clone with no spec file.
  for (const f of readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))) rmSync(join(dir, 'e2e', f))
  const r = sh('make e2e', dir)
  if (r.code !== 0) console.log(r.out.slice(-2000))
  expect(r.code).toBe(0)
}, T)

test('61.2 help lists every verb, and a new ping module appears with no other edit', () => {
  const dir = freshClone()
  const verbsDir = join(dir, 'src', 'cli', 'verbs')
  const names = readdirSync(verbsDir).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''))
  const h1 = sh('bun src/cli/main.ts help', dir)
  expect(h1.code).toBe(0)
  for (const n of names) expect(h1.out).toMatch(new RegExp(`\\b${n}\\b`))
  expect(h1.out).toMatch(/\bhelp\b/)
  writeFileSync(
    join(verbsDir, 'ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const h2 = sh('bun src/cli/main.ts help', dir)
  expect(h2.code).toBe(0)
  expect(h2.out).toMatch(/\bping\b/)
  for (const n of names) expect(h2.out).toMatch(new RegExp(`\\b${n}\\b`))
  expect(sh('git status --porcelain', dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, T)

test('61.3 the tests pass with no claude on the PATH, and leave the tree clean', () => {
  const dir = freshClone()
  const path = (process.env.PATH ?? '').split(delimiter).filter((d) => !existsSync(join(d, 'claude'))).join(delimiter)
  const env = { ...process.env, PATH: path }
  expect(sh('command -v claude', dir, env).code).not.toBe(0)
  const before = sh('git status --porcelain --untracked-files=all', dir).out
  const r = sh('make test', dir, env)
  if (r.code !== 0) console.log(r.out.slice(-3000))
  expect(r.code).toBe(0)
  // The command-line tests ran the fake agent's scripted events and edits in temporary projects.
  expect(sh('grep -l "scriptAgent" src/cli/*.test.ts', dir).out.trim()).not.toBe('')
  expect(sh('git status --porcelain --untracked-files=all', dir).out).toBe(before)
}, T)

test('61.4 the coverage gate fails below 90% on a pure file and passes again', () => {
  const dir = freshClone()
  expect(sh('make test-coverage', dir).code).toBe(0)
  rmSync(join(dir, 'src', 'map', 'stale-text.test.ts'))
  const t = sh('make test', dir)
  expect(t.code).toBe(0)
  const c = sh('make test-coverage', dir)
  expect(c.code).not.toBe(0)
  const line = c.out.split('\n').find((l) => l.includes('FAIL') && l.includes('src/map/stale-text.ts'))
  console.log('61.4 gate line:', line)
  expect(line).toBeDefined()
  expect(line!).toMatch(/\d+\.\d%/)
  expect(sh('git checkout -- src/map/stale-text.test.ts', dir).code).toBe(0)
  expect(sh('make test-coverage', dir).code).toBe(0)
}, T)
