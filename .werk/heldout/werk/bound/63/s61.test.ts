import { afterAll, expect, test } from 'bun:test'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

type R = { code: number; out: string }

/** The environment of a person's shell, without what the outer test run sets. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('BUN_') || k === 'NODE_ENV' || k === 'WERK_LOG') continue
    env[k] = v
  }
  return env
}

function sh(cwd: string, cmd: string[], env = baseEnv()): R {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

function clone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(root, ['git', 'clone', '--quiet', REPO, dir])
  if (r.code !== 0) throw new Error(`clone failed: ${r.out}`)
  return dir
}

const install = (dir: string) => {
  const r = sh(dir, ['bun', 'install', '--frozen-lockfile'])
  if (r.code !== 0) throw new Error(`install failed: ${r.out}`)
}

const LONG = 900_000

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const dir = clone()
    const roots = sh(dir, ['git', 'rev-list', '--max-parents=0', 'origin/main']).out.trim().split('\n')
    expect(roots.length).toBe(1)
    const first = roots[0]!
    expect(sh(dir, ['git', 'ls-tree', '-r', '--name-only', first]).out).toBe('')
    const all = sh(dir, ['git', 'rev-list', 'origin/main']).out.trim().split('\n')
    for (const c of all) {
      if (c === first) continue
      expect(sh(dir, ['git', 'merge-base', '--is-ancestor', first, c]).code).toBe(0)
    }

    install(dir)
    const results: Record<string, R> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) results[target] = sh(dir, ['make', target])
    for (const [target, r] of Object.entries(results)) {
      if (r.code !== 0) console.error(`make ${target} failed:\n${r.out.slice(-3000)}`)
    }
    expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
      test: 0,
      'test-coverage': 0,
      typecheck: 0,
      lint: 0,
      e2e: 0,
    })
    const specs = existsSync(join(dir, 'e2e'))
      ? readdirSync(join(dir, 'e2e'), { recursive: true }).filter((f) => /\.(spec|test)\.[jt]sx?$/.test(String(f)))
      : []
    expect(specs).toEqual([])
  },
  LONG,
)

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit',
  () => {
    const dir = clone()
    install(dir)
    const help1 = sh(dir, ['bun', 'src/cli/main.ts', 'help'])
    expect(help1.code).toBe(0)
    const registered = readdirSync(join(dir, 'src/cli/verbs'))
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .map((f) => sh(dir, ['sh', '-c', `grep -o "name: '[a-z-]*'" src/cli/verbs/${f}`]).out.trim().replace(/name: '(.*)'/, '$1'))
    expect(registered).toContain('help')
    for (const v of registered) expect(help1.out).toMatch(new RegExp(`\\b${v}\\b`))

    writeFileSync(
      join(dir, 'src/cli/verbs/ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const help2 = sh(dir, ['bun', 'src/cli/main.ts', 'help'])
    expect(help2.code).toBe(0)
    expect(help2.out).toMatch(/\bping\b/)
    for (const v of registered) expect(help2.out).toMatch(new RegExp(`\\b${v}\\b`))
    expect(sh(dir, ['git', 'status', '--porcelain']).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  LONG,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const dir = clone()
    install(dir)
    // A shell PATH with no directory that holds a claude program. Tools that share a
    // directory with claude get a symlink in a clean bin folder.
    const clean = join(dirname(dir), 'clean-bin')
    mkdirSync(clean)
    const hasClaude = (d: string) => {
      try {
        accessSync(join(d, 'claude'), constants.X_OK)
        return true
      } catch {
        return false
      }
    }
    const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
    for (const tool of ['bun', 'bunx', 'node', 'git', 'make']) {
      const home = parts.find((d) => existsSync(join(d, tool)))
      if (home && hasClaude(home)) symlinkSync(join(home, tool), join(clean, tool))
    }
    const env = { ...baseEnv(), PATH: [clean, ...parts.filter((d) => !hasClaude(d))].join(':') }
    expect(sh(dir, ['sh', '-c', 'command -v claude'], env).code).not.toBe(0)

    const before = sh(dir, ['git', 'status', '--porcelain', '--untracked-files=all']).out
    expect(before).toBe('')
    const r = sh(dir, ['make', 'test'], env)
    if (r.code !== 0) console.error(r.out.slice(-3000))
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\b0 fail\b/)
    // The command-line tests run the fake agent in a temporary project that the harness makes.
    const harness = sh(dir, ['bun', 'test', 'src/test/harness.test.ts', '-t', 'replays its scripted events'], env)
    expect(harness.code).toBe(0)
    expect(harness.out).toMatch(/\b1 pass\b/)
    expect(sh(dir, ['git', 'status', '--porcelain', '--untracked-files=all']).out).toBe('')
  },
  LONG,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const dir = clone()
    install(dir)
    expect(sh(dir, ['make', 'test-coverage']).code).toBe(0)

    rmSync(join(dir, 'src/map/transcript.test.ts'))
    const t = sh(dir, ['make', 'test'])
    expect(t.code).toBe(0)
    const cov = sh(dir, ['make', 'test-coverage'])
    expect(cov.code).not.toBe(0)
    const line = cov.out.split('\n').find((l) => l.includes('src/map/transcript.ts') && /%/.test(l) && !l.includes('|'))
    expect(line).toBeDefined()
    expect(line!).toMatch(/\d+(\.\d+)?%/)
    console.error(`gate line: ${line}`)

    expect(sh(dir, ['git', 'checkout', '--', 'src/map/transcript.test.ts']).code).toBe(0)
    expect(sh(dir, ['make', 'test-coverage']).code).toBe(0)
  },
  LONG,
)
