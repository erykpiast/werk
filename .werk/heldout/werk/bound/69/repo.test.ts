/** Held-out steps 61.1 to 61.4 and 69.5: each runs in a fresh clone of this checkout. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..')
const MIN = 60_000

let root: string | undefined
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

type R = { code: number; out: string }
function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R {
  const clean = { ...env }
  delete clean.NODE_ENV
  const p = Bun.spawnSync(cmd, { cwd, env: clean, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
function clone(): string {
  root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  const r = sh(root, ['git', 'clone', '--quiet', CHECKOUT, dir])
  if (r.code !== 0) throw new Error(r.out)
  return dir
}
const filesUnder = (dir: string, name: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name === name).map((e) => join(e.parentPath, e.name))
    : []

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const roots = sh(dir, ['git', 'rev-list', '--max-parents=0', 'HEAD']).out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(dir, ['git', 'ls-tree', '-r', '--name-only', first]).out.trim()).toBe('')
  for (const c of sh(dir, ['git', 'rev-list', 'HEAD']).out.trim().split('\n')) {
    expect(sh(dir, ['git', 'merge-base', '--is-ancestor', first, c]).code).toBe(0)
  }
  const results: Record<string, number> = {}
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(dir, ['make', target])
    results[target] = r.code
    if (r.code !== 0) console.error(`make ${target} failed:\n${r.out.slice(-3000)}`)
  }
  expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })
  // The project with no browser spec: the specs are removed from the clone.
  for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) unlinkSync(join(dir, 'e2e', f))
  const noSpec = sh(dir, ['make', 'e2e'])
  if (noSpec.code !== 0) console.error(noSpec.out.slice(-3000))
  expect(noSpec.code).toBe(0)
}, 30 * MIN)

const verbsOf = (help: string) =>
  help
    .split('verbs:')[1]!
    .split('\n')
    .map((l) => /^\s+([a-z][a-z0-9-]*)\s/.exec(l)?.[1])
    .filter((v): v is string => v !== undefined)

test('61.2 help lists every registered verb, and a new verb module appears with no other edit', () => {
  const dir = clone()
  expect(sh(dir, ['bun', 'install', '--frozen-lockfile']).code).toBe(0)
  const help = sh(dir, ['bun', 'src/cli/main.ts', 'help'])
  expect(help.code).toBe(0)
  const before = verbsOf(help.out)
  const registered = readdirSync(join(dir, 'src', 'cli', 'verbs'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => /name: '([a-z0-9-]+)'/.exec(readFileSync(join(dir, 'src', 'cli', 'verbs', f), 'utf8'))?.[1])
  expect(registered.every((v) => v !== undefined)).toBe(true)
  expect(before.toSorted()).toEqual((registered as string[]).toSorted())
  expect(before).toContain('help')

  writeFileSync(
    join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'print pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const after = verbsOf(sh(dir, ['bun', 'src/cli/main.ts', 'help']).out)
  expect(after).toContain('ping')
  for (const v of before) expect(after).toContain(v)
  expect(sh(dir, ['git', 'status', '--porcelain']).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, 5 * MIN)

test('61.3 the tests pass with no real agent on the PATH', () => {
  const dir = clone()
  const path = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
    .join(delimiter)
  const env = { ...process.env, PATH: path }
  expect(sh(dir, ['sh', '-c', 'command -v claude'], env).code).not.toBe(0)
  const r = sh(dir, ['make', 'test'], env)
  if (r.code !== 0) console.error(r.out.slice(-4000))
  expect(r.code).toBe(0)
  // The harness test that replays the fake agent's events and file edit in a temporary project.
  const h = sh(dir, ['bun', 'test', './src/test/harness.test.ts', '-t', 'replays its scripted events and edits a file'], { ...env, CI: 'true' })
  expect(h.code).toBe(0)
  expect(h.out).toMatch(/1 pass/)
  expect(sh(dir, ['git', 'status', '--porcelain'], env).out.trim()).toBe('')
}, 15 * MIN)

test('61.4 the coverage gate fails below 90% on a pure file and passes again', () => {
  const dir = clone()
  expect(sh(dir, ['make', 'test-coverage']).code).toBe(0)
  const testFile = join(dir, 'src', 'ticket', 'spec.test.ts')
  const saved = readFileSync(testFile, 'utf8')
  unlinkSync(testFile)
  expect(sh(dir, ['make', 'test']).code).toBe(0)
  const cov = sh(dir, ['make', 'test-coverage'])
  expect(cov.code).not.toBe(0)
  expect(cov.out).toMatch(/^.*\d+(\.\d+)?%.*src\/ticket\/spec\.ts.*$/m)
  writeFileSync(testFile, saved)
  expect(sh(dir, ['make', 'test-coverage']).code).toBe(0)
}, 20 * MIN)

test('69.5 make e2e runs the browser specs and leaves one screenshot per test', () => {
  const dir = clone()
  const fixtureLog = join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
  const logBefore = readFileSync(fixtureLog, 'utf8')
  const r = sh(dir, ['make', 'e2e'])
  if (r.code !== 0) console.error(r.out.slice(-4000))
  const listed = sh(dir, ['bunx', 'playwright', 'test', '--list']).out
  const names = [...listed.matchAll(/›\s*\S+\.spec\.ts:\d+:\d+\s*›\s*(.+)$/gm)].map((m) => m[1]!.trim())
  expect(names.length).toBeGreaterThan(0)
  for (const n of names) expect(r.out).toMatch(new RegExp(`[✓✘].*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  expect(filesUnder(join(dir, 'test-results'), 'evidence.png')).toHaveLength(names.length)
  expect(readFileSync(fixtureLog, 'utf8')).toBe(logBefore)
  expect(existsSync(join(dir, '.werk'))).toBe(false)
  expect(sh(dir, ['git', 'status', '--porcelain']).out.trim()).toBe('')
}, 15 * MIN)
