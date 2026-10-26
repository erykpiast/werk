import { afterAll, expect, test } from 'bun:test'
import { existsSync, readdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { REPO } from './helpers.ts'

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

type R = { code: number; out: string }
const sh = (cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const cleanEnv = () => {
  const env = { ...process.env }
  delete env.CI
  delete env.WERK_LOG
  return env
}
const clone = () => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(root, ['git', 'clone', '-q', '--branch', 'main', REPO, dir])
  if (r.code !== 0) throw new Error(r.out)
  return dir
}
const T = 900_000

test('61.1', () => {
  const dir = clone()
  const first = sh(dir, ['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
  expect(first.length).toBe(1)
  expect(sh(dir, ['git', 'ls-tree', '-r', '--name-only', first[0]!]).out).toBe('')
  const all = sh(dir, ['git', 'rev-list', 'main']).out.trim().split('\n')
  for (const c of all) expect(sh(dir, ['git', 'merge-base', '--is-ancestor', first[0]!, c]).code).toBe(0)
  expect(existsSync(join(dir, 'e2e'))).toBe(true)
  const specs = sh(dir, ['sh', '-c', 'find . -path ./node_modules -prune -o -name "*.spec.ts" -print']).out.trim()
  console.log('61.1 spec files:', JSON.stringify(specs))
  const env = cleanEnv()
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(dir, ['make', target], env)
    if (r.code !== 0) console.log(`61.1 make ${target} failed:\n${r.out.slice(-3000)}`)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
}, T)

test('61.2', () => {
  const dir = clone()
  expect(sh(dir, ['bun', 'install', '--frozen-lockfile']).code).toBe(0)
  const werk = (...a: string[]) => sh(dir, ['bun', 'src/cli/main.ts', ...a], cleanEnv())
  const h1 = werk('help')
  expect(h1.code).toBe(0)
  const before = sh(dir, ['git', 'status', '--porcelain']).out
  // The verbs the command line registers: one module per file in src/cli/verbs.
  const verbs = readdirSync(join(dir, 'src', 'cli', 'verbs')).filter((f) => !f.includes('.test.')).map((f) => f.replace(/\.tsx?$/, ''))
  expect(verbs).toContain('help')
  for (const v of verbs) expect(h1.out).toMatch(new RegExp(`^\\s+${v}\\b`, 'm'))
  writeFileSync(
    join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\nregistry.register({ name: 'ping', summary: 'answer pong', run: (_a, io) => (io.out('pong'), 0) })\n`,
  )
  const h2 = werk('help')
  expect(h2.code).toBe(0)
  expect(h2.out).toMatch(/^\s+ping\b/m)
  for (const v of verbs) expect(h2.out).toMatch(new RegExp(`^\\s+${v}\\b`, 'm'))
  expect(before).toBe('')
  expect(sh(dir, ['git', 'status', '--porcelain']).out).toBe('?? src/cli/verbs/ping.ts\n')
}, T)

test('61.3', () => {
  const dir = clone()
  const env = cleanEnv()
  env.PATH = (env.PATH ?? '').split(delimiter).filter((d) => !existsSync(join(d, 'claude'))).join(delimiter)
  expect(sh(dir, ['sh', '-c', 'command -v claude'], env).code).not.toBe(0)
  const r = sh(dir, ['make', 'test'], env)
  if (r.code !== 0) console.log(`61.3 make test failed:\n${r.out.slice(-3000)}`)
  expect(r.code).toBe(0)
  expect(r.out).toMatch(/ 0 fail/)
  const h = sh(dir, ['bun', 'test', 'src/test/harness.test.ts', '-t', 'replays its scripted events and edits a file'], { ...env, CI: 'true' })
  expect(h.code).toBe(0)
  expect(h.out).toMatch(/ 1 pass/)
  expect(sh(dir, ['git', 'status', '--porcelain'], env).out).toBe('')
}, T)

test('61.4', () => {
  const dir = clone()
  const env = cleanEnv()
  const c0 = sh(dir, ['make', 'test-coverage'], env)
  expect(c0.code).toBe(0)
  unlinkSync(join(dir, 'src', 'map', 'transcript.test.ts'))
  const t = sh(dir, ['make', 'test'], env)
  expect(t.code).toBe(0)
  const c1 = sh(dir, ['make', 'test-coverage'], env)
  console.log('61.4 gate output:', c1.out.split('\n').filter((l) => /transcript\.ts|gate/i.test(l)).join('\n'))
  expect(c1.code).not.toBe(0)
  expect(c1.out).toMatch(/^.*\d+(\.\d+)?%.*src\/map\/transcript\.ts.*$/m)
  expect(sh(dir, ['git', 'checkout', '--', 'src/map/transcript.test.ts']).code).toBe(0)
  const c2 = sh(dir, ['make', 'test-coverage'], env)
  expect(c2.code).toBe(0)
}, T)
