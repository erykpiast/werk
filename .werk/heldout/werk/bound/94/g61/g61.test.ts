import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { makeProject } from '../../src/test/harness.ts'

const WT = join(import.meta.dir, '..', '..')
const HOUR = 60 * 60 * 1000
const temps: string[] = []
afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }) })

const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env) => {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const headSha = sh(['git', 'rev-parse', 'HEAD'], WT).out.trim()

/** A person clones the werk repository: a fresh clone, at the merged product commit. */
function clone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-g61-'))
  temps.push(root)
  const dir = join(root, 'werk')
  expect(sh(['git', 'clone', '--quiet', WT, dir], root).code).toBe(0)
  expect(sh(['git', 'checkout', '--quiet', headSha], dir).code).toBe(0)
  return dir
}
// Strip the CI env so make sets it itself, and run with the person's env otherwise.
const makeEnv = (extra: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, ...extra }
  delete e.CI
  return e
}
const tail = (s: string) => s.slice(-1500)

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n').filter(Boolean)
  expect(roots.length).toBe(1)
  const first = roots[0]!
  // The first commit holds no files.
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
  // Every later commit on main has the first commit as an ancestor.
  const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')
  for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)

  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir, makeEnv())
    if (r.code !== 0) console.error(`make ${target} failed:\n${tail(r.out)}`)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
}, 2 * HOUR)

test('61.2 the help verb lists every verb, and a new verb module shows with no other edit', () => {
  const dir = clone()
  const install = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(install.code).toBe(0)
  const help = () => sh(['bun', 'src/cli/main.ts', 'help'], dir)
  const before = help()
  expect(before.code).toBe(0)
  // Every verb the command line registers: one module per verb in src/cli/verbs.
  const registered = sh(['bun', '-e', `
    import { loadVerbs } from './src/cli/load-verbs.ts'
    import { registry } from './src/cli/registry.ts'
    await loadVerbs(); console.log(JSON.stringify(registry.list().map(v => v.name)))`], dir)
  const names: string[] = JSON.parse(registered.out.trim().split('\n').at(-1)!)
  expect(names).toContain('help')
  const verbLine = (out: string, n: string) => new RegExp(`^\\s+${n}\\s`, 'm').test(out)
  for (const n of names) expect({ n, shown: verbLine(before.out, n) }).toEqual({ n, shown: true })

  writeFileSync(join(dir, 'src/cli/verbs/ping.ts'), `import { registry } from '../registry.ts'

registry.register({
  name: 'ping',
  summary: 'print pong',
  run(_args, io) {
    io.out('pong')
    return 0
  },
})
`)
  const after = help()
  expect(after.code).toBe(0)
  expect(verbLine(after.out, 'ping')).toBe(true)
  for (const n of names) expect(verbLine(after.out, n)).toBe(true)
  expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, 10 * 60 * 1000)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = clone()
  // No claude program on the PATH of the person's shell.
  const path = (process.env.PATH ?? '').split(delimiter).filter((d) => d && !existsSync(join(d, 'claude'))).join(delimiter)
  const env = makeEnv({ PATH: path })
  expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
  const r = sh(['make', 'test'], dir, env)
  if (r.code !== 0) console.error(tail(r.out))
  expect(r.code).toBe(0)

  // A command-line test reads the scripted events and the file edit of the fake agent from a temporary project.
  const p = makeProject()
  try {
    expect(relative(tmpdir(), p.dir).startsWith('..')).toBe(false)
    p.scriptAgent({ steps: [{ event: { type: 'hello' } }, { edit: { path: 'edited.txt', content: 'by the fake agent' } }] })
    const a = p.run(['claude', '-p', 'x'])
    expect(a.code).toBe(0)
    expect(a.stdout).toContain('"hello"')
    expect(readFileSync(join(p.dir, 'edited.txt'), 'utf8')).toBe('by the fake agent')
  } finally {
    p.cleanup()
  }
  // The working tree has no new or changed files after the run (ignored build output aside).
  expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('')
}, 30 * 60 * 1000)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  const env = makeEnv()
  const cov0 = sh(['make', 'test-coverage'], dir, env)
  expect(cov0.code).toBe(0) // the copy where make test-coverage passes

  // Delete unit tests of the pure file src/build/usage.ts: keep only its second test.
  const testFile = join(dir, 'src/build/usage.test.ts')
  const original = readFileSync(testFile, 'utf8')
  const lines = original.split('\n')
  const second = lines.findIndex((l, i) => i > 3 && l.startsWith('test('))
  const firstTest = lines.findIndex((l) => l.startsWith('test('))
  writeFileSync(testFile, [...lines.slice(0, firstTest), ...lines.slice(second)].join('\n'))

  const t = sh(['make', 'test'], dir, env)
  expect(t.code).toBe(0)
  const cov = sh(['make', 'test-coverage'], dir, env)
  console.log(tail(cov.out))
  expect(cov.code).not.toBe(0)
  expect(cov.out).toMatch(/src\/build\/usage\.ts[^\n]*\d+(\.\d+)?%/)

  writeFileSync(testFile, original)
  const cov2 = sh(['make', 'test-coverage'], dir, env)
  expect(cov2.code).toBe(0)
}, 60 * 60 * 1000)
