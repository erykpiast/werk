/** Held-out steps 61.x: the project set-up, run in fresh clones of this checkout. */
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

type R = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, CI: 'true' } as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

const clone = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'heldout-61-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', '--branch', 'main', REPO, dir], root)
  if (r.code !== 0) throw new Error(r.out)
  return dir
}

const MIN = 60_000

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
  for (const c of sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')) {
    expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)
  }
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir)
    if (r.code !== 0) console.log(`make ${target} failed:\n${r.out.slice(-3000)}`)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
  // "passes although the project has no browser spec yet": the same clone, with no spec file.
  for (const f of readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))) unlinkSync(join(dir, 'e2e', f))
  const r = sh(['make', 'e2e'], dir)
  if (r.code !== 0) console.log(r.out.slice(-2000))
  expect(r.code).toBe(0)
}, 30 * MIN)

test('61.2 help lists every registered verb, and a new ping module shows with no other edit', () => {
  const dir = clone()
  expect(sh(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)
  const werk = (args: string[]) => sh(['bun', 'src/cli/main.ts', ...args], dir)
  const before = werk(['help'])
  expect(before.code).toBe(0)
  const verbsBefore = [...before.out.matchAll(/^ {2}([a-z][a-z0-9-]*) /gm)].map((m) => m[1]!)
  // Every verb that the command line registers: one module per verb in the verbs folder.
  const registered = readdirSync(join(dir, 'src/cli/verbs'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f))
    .map((f) => f.replace(/\.tsx?$/, ''))
  expect(verbsBefore.toSorted()).toEqual(registered.toSorted())
  expect(verbsBefore).toContain('help')

  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({ name: 'ping', summary: 'answer pong', run: (_args, io) => (io.out('pong'), 0) })\n`,
  )
  const after = werk(['help'])
  expect(after.code).toBe(0)
  const verbsAfter = [...after.out.matchAll(/^ {2}([a-z][a-z0-9-]*) /gm)].map((m) => m[1]!)
  expect(verbsAfter).toContain('ping')
  for (const v of verbsBefore) expect(verbsAfter).toContain(v)
  const status = sh(['git', 'status', '--porcelain'], dir).out.trim().split('\n')
  expect(status).toEqual(['?? src/cli/verbs/ping.ts'])
}, 5 * MIN)

test('61.3 make test passes with no claude on PATH, and leaves the working tree clean', () => {
  const dir = clone()
  const path = [join(homedir(), '.bun', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  const env = { HOME: process.env.HOME, PATH: path, TMPDIR: tmpdir() }
  expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
  const r = sh(['make', 'test'], dir, env)
  if (r.code !== 0) console.log(r.out.slice(-3000))
  expect(r.code).toBe(0)
  // The command-line tests use the harness: a temporary project with the fake agent as claude.
  const harness = Bun.file(join(dir, 'src/test/harness.ts'))
  expect(existsSync(join(dir, 'src/test/fake-agent.ts'))).toBe(true)
  expect(harness.size).toBeGreaterThan(0)
  // No new or changed files in the working tree (node_modules is ignored by the project).
  expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('')
}, 15 * MIN)

test('61.4 the coverage gate fails below 90% on a pure file and passes again', () => {
  const dir = clone()
  const victim = 'src/cli/help-text.test.ts'
  unlinkSync(join(dir, victim))
  const t = sh(['make', 'test'], dir)
  expect(t.code).toBe(0)
  const c = sh(['make', 'test-coverage'], dir)
  expect(c.code).not.toBe(0)
  const line = c.out.split('\n').find((l) => l.includes('src/cli/help-text.ts') && l.includes('FAIL'))
  console.log(`61.4 gate line: ${line}`)
  expect(line).toMatch(/\d+(\.\d+)?%/)
  expect(sh(['git', 'checkout', '--', victim], dir).code).toBe(0)
  const again = sh(['make', 'test-coverage'], dir)
  if (again.code !== 0) console.log(again.out.slice(-2000))
  expect(again.code).toBe(0)
}, 15 * MIN)
