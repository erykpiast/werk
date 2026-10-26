/**
 * Held-out steps 61.1 - 61.4 and 69.5. Each step works in its own fresh `git clone` of this
 * checkout, in a temporary directory, so no make run writes into the checkout itself.
 */
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const SOURCE = join(import.meta.dir, '..')
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

type R = { code: number; out: string }
const sh = (cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

function freshClone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(root, ['git', 'clone', '--quiet', SOURCE, dir])
  if (r.code !== 0) throw new Error(`clone failed: ${r.out}`)
  sh(dir, ['git', 'checkout', '--quiet', 'main'])
  return dir
}

/** A PATH with every directory that holds a `claude` program taken out. */
const pathWithoutClaude = () =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
    .join(delimiter)

const LONG = 30 * 60_000

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const dir = freshClone()
    const first = sh(dir, ['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
    expect(first).toHaveLength(1)
    expect(sh(dir, ['git', 'ls-tree', '-r', '--name-only', first[0]!]).out.trim()).toBe('')
    const all = sh(dir, ['git', 'rev-list', 'main']).out.trim().split('\n')
    for (const c of all) {
      expect(sh(dir, ['git', 'merge-base', '--is-ancestor', first[0]!, c]).code).toBe(0)
    }
    const results: Record<string, R> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      results[target] = sh(dir, ['make', target])
    }
    for (const [target, r] of Object.entries(results)) {
      if (r.code !== 0) console.log(`make ${target} exited ${r.code}:\n${r.out.slice(-3000)}`)
    }
    expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
      test: 0,
      'test-coverage': 0,
      typecheck: 0,
      lint: 0,
      e2e: 0,
    })

    // The project has browser specs now. So the "no browser spec yet" clause runs on a second
    // fresh clone with the specs taken out, which is the state the step describes.
    const bare = freshClone()
    for (const f of readdirSync(join(bare, 'e2e'))) if (f.endsWith('.spec.ts')) rmSync(join(bare, 'e2e', f))
    const e2e = sh(bare, ['make', 'e2e'])
    if (e2e.code !== 0) console.log(e2e.out.slice(-3000))
    expect(e2e.code).toBe(0)
  },
  LONG,
)

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears with no other edit',
  () => {
    const dir = freshClone()
    expect(sh(dir, ['bun', 'install', '--frozen-lockfile']).code).toBe(0)
    const help = () => {
      const r = sh(dir, ['bun', 'src/cli/main.ts', 'help'])
      expect(r.code).toBe(0)
      return new Set(r.out.split('\n').flatMap((l) => /^  ([a-z][a-z0-9-]*)\s/.exec(l)?.[1] ?? []))
    }
    const before = help()
    const registered = readdirSync(join(dir, 'src', 'cli', 'verbs'))
      .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
      .flatMap((f) => [...readFileSync(join(dir, 'src', 'cli', 'verbs', f), 'utf8').matchAll(/name: '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]!))
    expect(registered.length).toBeGreaterThan(0)
    for (const name of registered) expect(before.has(name)).toBe(true)
    expect(before.has('help')).toBe(true)

    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      [
        "import { registry } from '../registry.ts'",
        '',
        "registry.register({ name: 'ping', summary: 'answer pong', run: (_args, io) => { io.out('pong'); return 0 } })",
        '',
      ].join('\n'),
    )
    const after = help()
    expect(after.has('ping')).toBe(true)
    for (const name of before) expect(after.has(name)).toBe(true)
    const status = sh(dir, ['git', 'status', '--porcelain']).out.trim().split('\n')
    expect(status).toEqual(['?? src/cli/verbs/ping.ts'])
  },
  LONG,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const dir = freshClone()
    const env = { ...process.env, PATH: pathWithoutClaude() }
    expect(sh(dir, ['sh', '-c', 'command -v claude'], env).code).not.toBe(0)
    // The install runs once first, so that the status check below reads only what the tests leave.
    expect(sh(dir, ['make', 'node_modules/.installed'], env).code).toBe(0)
    const statusBefore = sh(dir, ['git', 'status', '--porcelain', '--ignored']).out
    const tmpBefore = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith('werk-project-')))
    const r = sh(dir, ['make', 'test'], env)
    if (r.code !== 0) console.log(r.out.slice(-4000))
    expect(r.code).toBe(0)
    // The command-line tests run in temporary projects with the fake agent as `claude`.
    const harness = readFileSync(join(dir, 'src', 'test', 'harness.ts'), 'utf8')
    expect(harness).toContain("mkdtempSync(join(tmpdir(), 'werk-project-'))")
    expect(harness).toContain('fake-agent.ts')
    expect(harness).toContain("join(bin, 'claude')")
    const cliTests = readdirSync(join(dir, 'src', 'cli')).filter((f) => f.endsWith('.test.ts'))
    const usesHarness = cliTests.filter((f) => readFileSync(join(dir, 'src', 'cli', f), 'utf8').includes('makeProject'))
    expect(usesHarness.length).toBeGreaterThan(0)
    const scripted = cliTests.filter((f) => /scriptAgent\(/.test(readFileSync(join(dir, 'src', 'cli', f), 'utf8')))
    expect(scripted.length).toBeGreaterThan(0)
    // The temporary projects are gone after the run.
    const tmpAfter = readdirSync(tmpdir()).filter((f) => f.startsWith('werk-project-') && !tmpBefore.has(f))
    expect(tmpAfter.filter((f) => statSync(join(tmpdir(), f)).mtimeMs > 0)).toEqual([])
    expect(sh(dir, ['git', 'status', '--porcelain', '--ignored']).out).toBe(statusBefore)
    expect(sh(dir, ['git', 'status', '--porcelain']).out).toBe('')
  },
  LONG,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const dir = freshClone()
    const first = sh(dir, ['make', 'test-coverage'])
    expect(first.code).toBe(0)
    const pure = 'src/ticket/spec.ts'
    expect(readFileSync(join(dir, 'src', 'coverage', 'pure-files.ts'), 'utf8')).toContain(`'${pure}'`)
    const testFile = join(dir, 'src', 'ticket', 'spec.test.ts')
    const original = readFileSync(testFile, 'utf8')
    // Keep the imports and the first test, delete every later test.
    const second = original.indexOf('\ntest(', original.indexOf('test(') + 1)
    writeFileSync(testFile, original.slice(0, second) + '\n')

    const t = sh(dir, ['make', 'test'])
    expect(t.code).toBe(0)
    const cov = sh(dir, ['make', 'test-coverage'])
    console.log(cov.out.split('\n').filter((l) => l.includes(pure) || l.includes('coverage gate')).join('\n'))
    expect(cov.code).not.toBe(0)
    const line = cov.out.split('\n').find((l) => l.includes(pure) && /\d+(\.\d+)?%/.test(l))
    expect(line).toBeDefined()
    expect(line).toContain('FAIL')
    const percent = Number(/(\d+(?:\.\d+)?)%/.exec(line!)![1])
    expect(percent).toBeLessThan(90)

    writeFileSync(testFile, original)
    const again = sh(dir, ['make', 'test-coverage'])
    expect(again.code).toBe(0)
  },
  LONG,
)

test(
  '69.5 the person runs the browser tests and gets one screenshot per test',
  () => {
    const dir = freshClone()
    const fixtureLog = join(dir, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
    const logBefore = readFileSync(fixtureLog, 'utf8')
    const r = sh(dir, ['make', 'e2e'])
    console.log(r.out.split('\n').filter((l) => /[✓✘]|passed|failed|skipped/.test(l)).slice(-80).join('\n'))
    // Every spec reports a pass or fail line in the list reporter.
    const specs = readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) expect(r.out).toMatch(new RegExp(`[✓✘]\\s+\\d+\\s+.*${s.replace('.', '\\.')}`))
    const summary = /(\d+) passed/.exec(r.out)
    const failed = /(\d+) failed/.exec(r.out)
    const ran = Number(summary?.[1] ?? 0) + Number(failed?.[1] ?? 0)
    expect(ran).toBeGreaterThan(0)
    // One screenshot per test that ran.
    const results = join(dir, 'test-results')
    const shots = readdirSync(results, { recursive: true }).filter((f) => String(f).endsWith('evidence.png'))
    expect(shots).toHaveLength(ran)
    // The real server ran on a copy of the fixture project, not on the checkout.
    expect(readFileSync(join(dir, 'e2e', 'harness.ts'), 'utf8')).toContain('cpSync(FIXTURE, dir')
    expect(readFileSync(fixtureLog, 'utf8')).toBe(logBefore)
    expect(sh(dir, ['git', 'status', '--porcelain']).out).toBe('')
    expect(r.code).toBe(0)
  },
  LONG,
)
