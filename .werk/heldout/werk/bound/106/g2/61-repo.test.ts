/** Group 61: the repository, its verbs, its tests and its coverage gate, each in its own temporary clone. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { CHECKOUT } from '../../src/test/app-copy.ts'

const LONG = 1_500_000
const clones: string[] = []
afterEach(() => {
  for (const c of clones.splice(0)) rmSync(c, { recursive: true, force: true })
})

/** The person's shell: their own home folder, so the package cache is theirs. */
const SHELL_ENV = { ...process.env, HOME: userInfo().homedir }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = SHELL_ENV) => {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() }
}

/** Clones the werk repository, with its main branch at the commit under test. */
function cloneWerk(): string {
  const parent = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  clones.push(parent)
  const dir = join(parent, 'werk')
  const head = sh(['git', 'rev-parse', 'HEAD'], CHECKOUT).out.trim()
  expect(sh(['git', 'clone', '--quiet', '--no-checkout', CHECKOUT, dir], parent).code).toBe(0)
  expect(sh(['git', 'checkout', '--quiet', '-B', 'main', head], dir).code).toBe(0)
  return dir
}

const make = (target: string, dir: string, env?: Record<string, string | undefined>) => sh(['make', target], dir, env)

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = cloneWerk()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
  for (const c of sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')) {
    expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)
  }
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = make(target, dir)
    if (r.code !== 0) throw new Error(`make ${target} exited ${r.code}:\n${(r.out + r.err).slice(-3000)}`)
  }
  // The project has browser specs now. With none, make e2e must still pass.
  for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) rmSync(join(dir, 'e2e', f))
  const none = make('e2e', dir)
  if (none.code !== 0) throw new Error(`make e2e with no spec exited ${none.code}:\n${(none.out + none.err).slice(-3000)}`)
}, LONG)

const registered = (dir: string) => {
  const script = `import { loadVerbs } from './src/cli/load-verbs.ts'; import { registry } from './src/cli/registry.ts'; await loadVerbs(); console.log(JSON.stringify(registry.list().map((v) => v.name)))`
  const r = sh([process.execPath, '-e', script], dir)
  return JSON.parse(r.out) as string[]
}
const helpNames = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]!)

test('61.2 the help verb lists every registered verb, and a new verb module appears with no other edit', () => {
  const dir = cloneWerk()
  expect(sh(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)
  const before = sh([process.execPath, 'src/cli/main.ts', 'help'], dir)
  expect(before.code).toBe(0)
  const names = helpNames(before.out)
  expect(names).toContain('help')
  expect(names.toSorted()).toEqual(registered(dir).toSorted())

  writeFileSync(
    join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const after = sh([process.execPath, 'src/cli/main.ts', 'help'], dir)
  expect(after.code).toBe(0)
  const now = helpNames(after.out)
  expect(now).toContain('ping')
  for (const n of names) expect(now).toContain(n)
  expect(sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, LONG)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = cloneWerk()
  const path = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
    .join(delimiter)
  const env = { ...SHELL_ENV, PATH: path }
  expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
  const r = make('test', dir, env)
  if (r.code !== 0) throw new Error(`make test exited ${r.code}:\n${(r.out + r.err).slice(-3000)}`)
  // The command-line tests of the fake agent ran in that run and passed.
  const fake = sh([process.execPath, 'test', './src/test/fake-agent.test.ts', './src/test/harness.test.ts'], dir, env)
  expect(fake.code).toBe(0)
  expect(fake.err).toMatch(/\d+ pass/)
  expect(fake.err).toContain(' 0 fail')
  const status = sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out
  // The installed packages are ignored by git; nothing else may be new or changed.
  expect(status).toBe('')
}, LONG)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = cloneWerk()
  const pass = make('test-coverage', dir)
  if (pass.code !== 0) throw new Error(`make test-coverage did not pass first:\n${(pass.out + pass.err).slice(-3000)}`)

  const testFile = join(dir, 'src', 'chat', 'convos.test.ts')
  const original = readFileSync(testFile, 'utf8')
  // Delete the unit tests of resolveConvo and recallLines; src/chat/convos.ts is on the pure-file list.
  writeFileSync(testFile, original.slice(0, original.indexOf("describe('resolveConvo'")))

  const unit = make('test', dir)
  expect(unit.code).toBe(0)
  const gate = make('test-coverage', dir)
  expect(gate.code).not.toBe(0)
  const text = gate.out + gate.err
  expect(text).toContain('src/chat/convos.ts')
  const line = text.split('\n').find((l) => l.includes('src/chat/convos.ts')) ?? ''
  expect(line).toMatch(/\d+(\.\d+)?%/)

  writeFileSync(testFile, original)
  const again = make('test-coverage', dir)
  expect(again.code).toBe(0)
}, LONG)
