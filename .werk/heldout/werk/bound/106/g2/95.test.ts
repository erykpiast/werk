/** Group 95: the test store, the clean environment and the fresh clone. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { CHECKOUT } from '../../src/test/app-copy.ts'

const temps: string[] = []
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'werk-heldout-95-'))
  temps.push(d)
  return d
}
const jsonLines = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)
const runFixture = (fixture: string, env: Record<string, string | undefined>) => {
  const p = Bun.spawnSync([process.execPath, 'test', fixture], { cwd: CHECKOUT, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const answers = (url: string) => fetch(url, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false)

/** The folder of the real `claude` on the person's PATH, not the fake one. */
const realClaudeDir = () =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .find((d) => d !== '' && existsSync(join(d, 'claude')) && !readFileSync(join(d, 'claude'), 'utf8').includes('fake-agent'))

test('95.1 two tests that each write a card see only their own card', () => {
  const out = join(tempDir(), 'out.jsonl')
  const r = runFixture('./.werk-heldout/g2/fixtures/two-cards.fixture.ts', { ...process.env, HELDOUT_OUT: out })
  const [first, second] = jsonLines<{ name: string; dir: string; titles: string[]; top: string; real: string }>(out)
  expect(first!.name).toBe('first')
  expect(first!.titles).toEqual(['Alpha'])
  expect(second!.titles).toEqual(['Beta'])
  expect(first!.dir).not.toBe(second!.dir)
  expect(first!.top).toBe(first!.real)
  expect(second!.top).toBe(second!.real)
  expect(r.out).toMatch(/\b1 pass\b/)
  expect(r.out).toMatch(/\b1 fail\b/)
  expect(r.code).toBe(1)
  expect(existsSync(first!.dir)).toBe(false)
  expect(existsSync(second!.dir)).toBe(false)
}, 60_000)

test('95.2 a server test\'s server stops when the test ends', async () => {
  const out = join(tempDir(), 'out.jsonl')
  const r = runFixture('./.werk-heldout/g2/fixtures/server-scope.fixture.ts', { ...process.env, HELDOUT_OUT: out })
  expect(r.code).toBe(0)
  const [seen] = jsonLines<{ url: string; dir: string; graph: Record<string, unknown> }>(out)
  // The map was empty: the graph holds no card.
  expect(JSON.stringify(seen!.graph)).not.toMatch(/"id":"[^"]+"/)
  expect(await answers(seen!.url)).toBe(false)
  expect(existsSync(seen!.dir)).toBe(false)
}, 60_000)

test('95.3 a real project setting and a real agent never reach a test', () => {
  const realDir = realClaudeDir()
  expect(realDir).toBeDefined()
  // The map the person works in, named by WERK_LOG in their shell.
  const work = tempDir()
  mkdirSync(join(work, '.werk'))
  const log = join(work, '.werk', 'log.jsonl')
  writeFileSync(log, '')
  const before = readFileSync(log, 'utf8')
  const path = [realDir!, ...(process.env.PATH ?? '').split(delimiter).filter((d) => d !== '' && !(existsSync(join(d, 'claude')) && readFileSync(join(d, 'claude'), 'utf8').includes('fake-agent')))].join(delimiter)
  const shellEnv = { ...process.env, PATH: path, HOME: userInfo().homedir, WERK_LOG: log }
  expect(Bun.spawnSync(['sh', '-c', 'command -v claude'], { env: shellEnv as Record<string, string>, stdout: 'pipe' }).stdout.toString().trim()).toBe(join(realDir!, 'claude'))
  const r = runFixture('./.werk-heldout/g2/fixtures/real-env.fixture.ts', shellEnv)
  if (r.code !== 0) throw new Error(`the unit tests failed:\n${r.out.slice(-3000)}`)
  expect(r.out).toMatch(/\b2 pass\b/)
  expect(readFileSync(log, 'utf8')).toBe(before)
}, 60_000)

test('95.4 the browser test server refuses to start when the fake agent is not first', () => {
  const realDir = realClaudeDir()
  expect(realDir).toBeDefined()
  const results = join(tempDir(), 'results')
  const env = { ...process.env, HOME: userInfo().homedir, PATH: [realDir!, ...(process.env.PATH ?? '').split(delimiter)].join(delimiter), CI: 'true' }
  const p = Bun.spawnSync(['bunx', 'playwright', 'test', 'e2e/map.spec.ts', '--output', results, '--reporter', 'list'], {
    cwd: CHECKOUT,
    env: env as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const text = p.stdout.toString() + p.stderr.toString()
  if (p.exitCode === 0) throw new Error(`the browser tests ran and passed with the real agent first on PATH:\n${text.slice(-2000)}`)
  expect(text).toMatch(/fake agent/)
  expect(text).toMatch(/PATH/)
  expect(text).not.toMatch(/\b\d+ passed\b/)
}, 300_000)

test('95.5 a fresh clone passes its checks with no manual step', () => {
  const parent = tempDir()
  const dir = join(parent, 'werk')
  const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: CHECKOUT, stdout: 'pipe' }).stdout.toString().trim()
  const env = { ...process.env, HOME: userInfo().homedir } as Record<string, string>
  expect(Bun.spawnSync(['git', 'clone', '--quiet', CHECKOUT, dir], { env }).exitCode).toBe(0)
  expect(Bun.spawnSync(['git', 'checkout', '--quiet', head], { cwd: dir, env }).exitCode).toBe(0)
  expect(existsSync(join(dir, 'node_modules'))).toBe(false)
  // The person runs make from another folder; the run must still happen in v0's own folder.
  const p = Bun.spawnSync(['make', '-f', join(dir, 'Makefile'), 'test'], { cwd: parent, env, stdout: 'pipe', stderr: 'pipe' })
  const text = p.stdout.toString() + p.stderr.toString()
  const install = text.indexOf('bun install --frozen-lockfile')
  const tests = text.indexOf('bun run test')
  expect(install).toBeGreaterThanOrEqual(0)
  expect(tests).toBeGreaterThan(install)
  expect(text).toContain(`cd ${dir} && CI=true bun run test`)
  expect(existsSync(join(dir, 'node_modules', 'react'))).toBe(true)
  if (p.exitCode !== 0) throw new Error(`make test failed in the fresh clone:\n${text.slice(-3000)}`)
}, 1_500_000)
