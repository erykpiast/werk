import { afterAll, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUN, cloneRepo, sh } from './helpers.ts'

const T = 20 * 60 * 1000
const clones: string[] = []
afterAll(() => clones.forEach((d) => rmSync(dirname(d), { recursive: true, force: true })))
const clone = () => {
  const d = cloneRepo()
  clones.push(d)
  return d
}

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const d = clone()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'HEAD'], d).stdout.trim().split('\n')
  expect(roots).toHaveLength(1)
  const root = roots[0]!
  expect(sh(['git', 'ls-tree', '-r', '--name-only', root], d).stdout.trim()).toBe('')
  for (const c of sh(['git', 'rev-list', 'HEAD'], d).stdout.trim().split('\n')) {
    expect(sh(['git', 'merge-base', '--is-ancestor', root, c], d).code).toBe(0)
  }
  expect(sh([BUN, 'install', '--frozen-lockfile'], d).code).toBe(0)
  const results: Record<string, number> = {}
  for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', t], d)
    results[t] = r.code
    if (r.code !== 0) console.error(`make ${t} failed:\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-3000)}`)
  }
  expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })
  const specs = readdirSync(join(d, 'e2e')).filter((f) => /\.(spec|test)\.[jt]sx?$/.test(f))
  expect(specs).toEqual([])
}, T)

test('61.2 help lists every verb, and a new verb module appears with no other edit', () => {
  const d = clone()
  expect(sh([BUN, 'install', '--frozen-lockfile'], d).code).toBe(0)
  const werk = (a: string[]) => sh([BUN, 'src/cli/main.ts', ...a], d)
  const h1 = werk(['help'])
  expect(h1.code).toBe(0)
  const registered = readdirSync(join(d, 'src', 'cli', 'verbs'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f))
    .map((f) => f.replace(/\.tsx?$/, ''))
  expect(registered).toContain('help')
  const named = (out: string, v: string) => new RegExp(`^\\s+${v}\\s`, 'm').test(out)
  for (const v of registered) expect(named(h1.stdout, v)).toBe(true)

  writeFileSync(
    join(d, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\nregistry.register({ name: 'ping', summary: 'reply pong', run: (_a, io) => (io.out('pong'), 0) })\n`,
  )
  const h2 = werk(['help'])
  expect(h2.code).toBe(0)
  expect(named(h2.stdout, 'ping')).toBe(true)
  for (const v of registered) expect(named(h2.stdout, v)).toBe(true)
  expect(sh(['git', 'status', '--porcelain', '--untracked-files=all'], d).stdout.trim()).toBe('?? src/cli/verbs/ping.ts')
}, T)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const d = clone()
  const dirs = [dirname(BUN), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const tools = ['git', 'make']
  for (const t of tools) {
    const p = sh(['/usr/bin/which', t], d).stdout.trim()
    if (p) dirs.push(dirname(p))
  }
  const PATH = [...new Set(dirs)].filter((x) => !existsSync(join(x, 'claude'))).join(':')
  const env = { ...process.env, PATH }
  expect(sh(['/bin/sh', '-c', 'command -v claude'], d, env).code).not.toBe(0)
  const before = sh(['git', 'status', '--porcelain', '--untracked-files=all'], d).stdout
  const r = sh(['make', 'test'], d, env)
  if (r.code !== 0) console.error(r.stdout.slice(-3000), r.stderr.slice(-3000))
  expect(r.code).toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/\b0 fail\b/)
  expect(out).toMatch(/across \d+ files/)
  const harness = readFileSync(join(d, 'src', 'test', 'harness.test.ts'), 'utf8')
  expect(harness).toContain('the fake agent replays its scripted events and edits a file in the project')
  expect(readFileSync(join(d, 'src', 'test', 'harness.ts'), 'utf8')).toContain('mkdtempSync(join(tmpdir()')
  expect(sh(['git', 'status', '--porcelain', '--untracked-files=all'], d).stdout).toBe(before)
}, T)

test('61.4 the coverage gate fails below 90% on a pure file and passes again', () => {
  const d = clone()
  expect(sh(['make', 'test-coverage'], d).code).toBe(0)
  rmSync(join(d, 'src', 'cli', 'args.test.ts'))
  expect(sh(['make', 'test'], d).code).toBe(0)
  const cov = sh(['make', 'test-coverage'], d)
  expect(cov.code).not.toBe(0)
  const line = (cov.stdout + cov.stderr).split('\n').find((l) => l.includes('src/cli/args.ts') && /FAIL/.test(l))
  expect(line).toBeDefined()
  const pct = Number(line!.match(/(\d+(?:\.\d+)?)%/)![1])
  expect(pct).toBeLessThan(90)
  expect(sh(['git', 'checkout', '--', 'src/cli/args.test.ts'], d).code).toBe(0)
  expect(sh(['make', 'test-coverage'], d).code).toBe(0)
}, T)
