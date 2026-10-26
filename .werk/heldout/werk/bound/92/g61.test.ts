/** Held-out steps 61.1–61.4. Each step works in a fresh clone in a temporary directory. */
import { afterAll, expect, test } from 'bun:test'
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const tmps: string[] = []
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })))

type R = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const clone = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'werk-ho61-'))
  tmps.push(root)
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', '--branch', 'main', REPO, dir], root)
  if (r.code !== 0) throw new Error('clone failed: ' + r.out)
  return dir
}
const install = (dir: string) => {
  const r = sh(['bun', 'install', '--frozen-lockfile'], dir)
  if (r.code !== 0) throw new Error('install failed: ' + r.out)
}

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const dir = clone()
    const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
    expect(roots.length).toBe(1)
    const first = roots[0]!
    expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
    for (const c of sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')) {
      expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)
    }
    install(dir)
    const results: Record<string, R> = {}
    for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) results[t] = sh(['make', t], dir)
    for (const [t, r] of Object.entries(results)) {
      if (r.code !== 0) console.error(`make ${t} exited ${r.code}\n${r.out.slice(-3000)}`)
    }
    expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
      test: 0,
      'test-coverage': 0,
      typecheck: 0,
      lint: 0,
      e2e: 0,
    })
    // The step also says the project has no browser spec yet. Record what the clone holds.
    const specs = existsSync(join(dir, 'e2e')) ? readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts')) : []
    console.log(`61.1 browser specs in the clone: ${specs.join(', ') || 'none'}`)
  },
  { timeout: 900_000 },
)

test(
  '61.2 help lists every verb, and a new verb module appears with no other edit',
  () => {
    const dir = clone()
    install(dir)
    const help = () => sh(['bun', 'src/cli/main.ts', 'help'], dir)
    const before = help()
    expect(before.code).toBe(0)
    const verbs = readdirSync(join(dir, 'src', 'cli', 'verbs'))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .map((f) => f.replace(/\.tsx?$/, ''))
    expect(verbs).toContain('help')
    for (const v of verbs) expect(before.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))
    const namedBefore = [...before.out.matchAll(/^ {2}([a-z][a-z0-9-]*)\s/gm)].map((m) => m[1]!)
    expect(namedBefore).toContain('help')

    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      `import { registry } from '../registry.ts'\nregistry.register({ name: 'ping', summary: 'answer pong', run: (_a, io) => (io.out('pong'), 0) })\n`,
    )
    const after = help()
    expect(after.code).toBe(0)
    expect(after.out).toMatch(/^\s+ping\s/m)
    for (const v of namedBefore) expect(after.out).toMatch(new RegExp(`^ {2}${v}\\s`, 'm'))
    expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  { timeout: 300_000 },
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const dir = clone()
    install(dir)
    // A PATH with no directory that holds a claude program.
    const path = (process.env.PATH ?? '')
      .split(delimiter)
      .filter((d) => {
        try {
          return !statSync(join(d, 'claude')).isFile()
        } catch {
          return true
        }
      })
      .join(delimiter)
    const env = { ...process.env, PATH: path }
    expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
    const before = sh(['git', 'status', '--porcelain'], dir).out
    const r = sh(['make', 'test'], dir, env)
    if (r.code !== 0) console.error(r.out.slice(-4000))
    expect(r.code).toBe(0)
    // The command-line tests use the harness: a temporary project with the fake agent as claude.
    const text = readFileSync(join(dir, 'src', 'test', 'harness.ts'), 'utf8')
    expect(text).toContain('mkdtempSync')
    expect(text).toContain("join(bin, 'claude')")
    expect(text).toContain('FAKE_AGENT')
    // status --porcelain ignores node_modules (it is in .gitignore) and the coverage folder.
    expect(sh(['git', 'status', '--porcelain'], dir).out).toBe(before)
  },
  { timeout: 600_000 },
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const dir = clone()
    install(dir)
    const base = sh(['make', 'test-coverage'], dir)
    expect(base.code).toBe(0)
    const target = 'src/map/stale-text.ts'
    const deleted = 'src/map/stale-text.test.ts'
    rmSync(join(dir, deleted))
    const t = sh(['make', 'test'], dir)
    expect(t.code).toBe(0)
    const cov = sh(['make', 'test-coverage'], dir)
    console.log(cov.out.split('\n').filter((l) => l.includes('stale-text') || l.includes('gate')).join('\n'))
    expect(cov.code).not.toBe(0)
    expect(cov.out).toMatch(/src\/map\/stale-text\.ts[^\n]*\d+(\.\d+)?%/)
    sh(['git', 'checkout', '--', deleted], dir)
    const again = sh(['make', 'test-coverage'], dir)
    expect(again.code).toBe(0)
    void target
  },
  { timeout: 900_000 },
)
