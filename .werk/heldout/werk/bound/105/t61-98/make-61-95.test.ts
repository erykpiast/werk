/**
 * Steps that clone the repository, edit it, or run make. Each works on its own clone in a
 * temporary folder; the checkout is never touched.
 */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const LONG = 40 * 60_000
const fakeBin = (process.env.PATH ?? '').split(':')[0]!
/** The person's shell: the run's PATH without the preload's fake agent folder, and the real home (for the package and browser caches). */
const shellPath = () => (process.env.PATH ?? '').split(':').filter((d) => d !== fakeBin).join(':')
const realHome = `/Users/${process.env.USER}`
const shellEnv = (path = shellPath()): Record<string, string> => ({ PATH: path, HOME: realHome, TMPDIR: tmpdir(), USER: process.env.USER ?? '', LANG: 'en_US.UTF-8' })

const sh = (cmd: string[], cwd: string, env = shellEnv()) => {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}
const HEAD = sh(['git', 'rev-parse', 'HEAD'], ROOT).out.trim()

/** A fresh clone of the werk repository, with the merged product checked out on main. */
function clone(): string {
  const parent = mkdtempSync(join(tmpdir(), 'heldout-clone-'))
  const dir = join(parent, 'werk')
  expect(sh(['git', 'clone', '--quiet', '--no-local', ROOT, dir], parent).code).toBe(0)
  expect(sh(['git', 'checkout', '--quiet', '-B', 'main', HEAD], dir).code).toBe(0)
  return dir
}
const done = (dir: string) => rmSync(join(dir, '..'), { recursive: true, force: true })
const status = (dir: string) => sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out.trim()

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
  const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n').filter((c) => c !== first)
  for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)

  const results: Record<string, { code: number | null; tail: string }> = {}
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir)
    results[target] = { code: r.code, tail: r.out.slice(-1500) }
  }
  console.log(JSON.stringify(results, null, 1))
  for (const target of Object.keys(results)) expect({ target, code: results[target]!.code }).toEqual({ target, code: 0 })

  // e2e with no browser spec: the project as it was before the first spec.
  for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) rmSync(join(dir, 'e2e', f))
  const none = sh(['make', 'e2e'], dir)
  console.log('e2e with no spec:', none.out.slice(-500))
  expect(none.code).toBe(0)
  done(dir)
}, LONG)

test('61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit', () => {
  const dir = clone()
  expect(sh(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)
  const help = () => sh(['bun', 'src/cli/main.ts', 'help'], dir)
  const before = help()
  expect(before.code).toBe(0)
  const registered = readdirSync(join(dir, 'src/cli/verbs'))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .flatMap((f) => [...readFileSync(join(dir, 'src/cli/verbs', f), 'utf8').matchAll(/registry\.register\(\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]!))
  expect(registered).toContain('help')
  const named = (out: string) => [...out.matchAll(/^ {2}([a-z][a-z0-9-]*)\s/gm)].map((m) => m[1]!)
  expect(named(before.out).toSorted()).toEqual(registered.toSorted())

  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
  )
  const after = help()
  expect(after.code).toBe(0)
  expect(named(after.out).toSorted()).toEqual([...registered, 'ping'].toSorted())
  expect(status(dir)).toBe('?? src/cli/verbs/ping.ts')
  done(dir)
}, LONG)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = clone()
  const noAgent = shellPath().split(':').filter((d) => !existsSync(join(d, 'claude'))).join(':')
  expect(sh(['/bin/sh', '-c', 'command -v claude || echo none'], dir, shellEnv(noAgent)).out.trim()).toBe('none')
  sh(['bun', 'install', '--frozen-lockfile'], dir, shellEnv(noAgent))
  const clean = status(dir)
  const r = sh(['make', 'test'], dir, shellEnv(noAgent))
  console.log(r.out.slice(-1500))
  expect(r.code).toBe(0)
  // the command-line tests script the fake agent with events and a file edit, in a temporary project (makeProject)
  const cliTests = readdirSync(join(dir, 'src/cli')).filter((f) => f.endsWith('.test.ts')).map((f) => readFileSync(join(dir, 'src/cli', f), 'utf8'))
  expect(cliTests.some((t) => t.includes('makeProject(') && t.includes('scriptAgent(') && /\{ edit: \{ path/.test(t) && /\{ event: \{/.test(t))).toBe(true)
  expect(status(dir)).toBe(clean)
  done(dir)
}, LONG)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  const pre = sh(['make', 'test-coverage'], dir)
  expect(pre.code).toBe(0)
  const testFile = join(dir, 'src/cli/args.test.ts')
  const text = readFileSync(testFile, 'utf8')
  // keep only the first unit test of the pure file src/cli/args.ts
  writeFileSync(testFile, text.slice(0, text.indexOf("\ntest('a value may start")) + '\n')
  const plain = sh(['make', 'test'], dir)
  expect(plain.code).toBe(0)
  const gated = sh(['make', 'test-coverage'], dir)
  console.log(gated.out.slice(-2500))
  expect(gated.code).not.toBe(0)
  expect(gated.out).toMatch(/FAIL\s+\d+(\.\d+)?%\s+src\/cli\/args\.ts/)
  expect(sh(['git', 'checkout', '--', 'src/cli/args.test.ts'], dir).code).toBe(0)
  const restored = sh(['make', 'test-coverage'], dir)
  expect(restored.code).toBe(0)
  done(dir)
}, LONG)

test('95.4 the browser test server refuses to start when the fake agent is not first', () => {
  const dir = clone()
  sh(['bun', 'install', '--frozen-lockfile'], dir)
  const realDir = shellPath().split(':').find((d) => existsSync(join(d, 'claude')))!
  expect(realDir).toBeDefined()
  const env = { ...shellEnv(`${realDir}:${shellPath()}`), CI: 'true' }
  const r = sh(['bunx', 'playwright', 'test', 'e2e/map.spec.ts', '--reporter=list'], dir, env)
  console.log(r.out.slice(-3000))
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/fake agent/)
  expect(r.out).toMatch(/PATH/)
  expect(r.out).not.toMatch(/\d+ passed/)
  done(dir)
}, LONG)

test('95.5 a fresh clone passes its checks with no manual step', () => {
  const dir = clone()
  expect(existsSync(join(dir, 'node_modules'))).toBe(false)
  const r = sh(['make', 'test'], dir)
  console.log(r.out.slice(0, 800), '\n...\n', r.out.slice(-800))
  expect(r.out).toMatch(/bun install --frozen-lockfile/)
  expect(r.out.indexOf('bun install')).toBeLessThan(r.out.indexOf('bun test'))
  expect(existsSync(join(dir, 'node_modules', '.installed'))).toBe(true)
  expect(r.out).toContain(`cd ${dir} && CI=true bun run test`)
  expect(r.code).toBe(0)
  done(dir)
}, LONG)
