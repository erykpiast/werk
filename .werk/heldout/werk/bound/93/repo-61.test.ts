import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const LONG = 20 * 60 * 1000

type R = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const ok = (cmd: string[], cwd: string, env?: Record<string, string | undefined>) => {
  const r = sh(cmd, cwd, env)
  if (r.code !== 0) throw new Error(`${cmd.join(' ')} failed (${r.code}):\n${r.out.slice(-4000)}`)
  return r.out
}

/** A person clones the werk repository. */
function cloneRepo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'werk-61-')), 'werk')
  ok(['git', 'clone', '--quiet', '--branch', 'main', ROOT, dir], tmpdir())
  return dir
}

const env = { ...process.env, CI: 'true' }

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const dir = cloneRepo()
    const first = ok(['git', 'rev-list', '--max-parents=0', 'main'], dir).trim().split('\n')
    expect(first.length).toBe(1)
    // The first commit holds no files.
    expect(ok(['git', 'ls-tree', '-r', '--name-only', first[0]!], dir).trim()).toBe('')
    // Every later commit has the first commit as an ancestor.
    const all = ok(['git', 'rev-list', 'main'], dir).trim().split('\n')
    for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first[0]!, c], dir).code).toBe(0)

    const results: Record<string, R> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      results[target] = sh(['make', target], dir, env)
    }
    for (const [t, r] of Object.entries(results)) {
      if (r.code !== 0) console.log(`make ${t} failed:\n${r.out.slice(-3000)}`)
    }
    expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
      test: 0,
      'test-coverage': 0,
      typecheck: 0,
      lint: 0,
      e2e: 0,
    })

    // "make e2e passes although the project has no browser spec yet": checked at the last
    // commit on main before the first e2e spec was added.
    const firstSpec = ok(['git', 'log', 'main', '--diff-filter=A', '--format=%H', '--', 'e2e/*.spec.ts'], dir)
      .trim()
      .split('\n')
      .at(-1)!
    const before = `${firstSpec}^`
    const specs = ok(['git', 'ls-tree', '-r', '--name-only', before], dir)
      .split('\n')
      .filter((f) => /\.spec\.tsx?$/.test(f))
    expect(specs).toEqual([])
    const old = join(mkdtempSync(join(tmpdir(), 'werk-61-old-')), 'werk')
    ok(['git', 'clone', '--quiet', ROOT, old], tmpdir())
    ok(['git', 'checkout', '--quiet', ok(['git', 'rev-parse', before], dir).trim()], old)
    const e2eOld = sh(['make', 'e2e'], old, env)
    if (e2eOld.code !== 0) console.log(e2eOld.out.slice(-3000))
    expect(e2eOld.code).toBe(0)
  },
  LONG,
)

const helpVerbs = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((w): w is string => !!w && /^[a-z][a-z0-9-]*$/.test(w))

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears with no other edit',
  () => {
    const dir = cloneRepo()
    ok(['bun', 'install', '--frozen-lockfile'], dir)
    const before = sh(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(before.code).toBe(0)
    // Every verb the command line registers: one module per verb in src/cli/verbs.
    const registered: string[] = []
    for (const f of readdirSync(join(dir, 'src/cli/verbs')).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
      const m = readFileSync(join(dir, 'src/cli/verbs', f), 'utf8').matchAll(/name:\s*'([a-z][a-z0-9-]*)'/g)
      for (const x of m) registered.push(x[1]!)
    }
    const beforeVerbs = helpVerbs(before.out)
    for (const v of registered) expect(beforeVerbs).toContain(v)
    expect(registered).toContain('help')
    expect(beforeVerbs).toContain('help')

    const statusBefore = ok(['git', 'status', '--porcelain'], dir)
    writeFileSync(
      join(dir, 'src/cli/verbs/ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const after = sh(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(after.code).toBe(0)
    const afterVerbs = helpVerbs(after.out)
    expect(afterVerbs).toContain('ping')
    for (const v of beforeVerbs) expect(afterVerbs).toContain(v)
    expect(statusBefore.trim()).toBe('')
    expect(ok(['git', 'status', '--porcelain'], dir).trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  LONG,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const dir = cloneRepo()
    const path = (process.env.PATH ?? '')
      .split(':')
      .filter((d) => d !== '' && d !== '.' && !existsSync(join(d, 'claude')))
      .join(':')
    const noClaude = { ...process.env, PATH: path, CI: 'true' }
    expect(sh(['/bin/sh', '-c', 'command -v claude'], dir, noClaude).code).not.toBe(0)
    const statusBefore = ok(['git', 'status', '--porcelain', '--ignored=no'], dir)
    const r = sh(['make', 'test'], dir, noClaude)
    if (r.code !== 0) console.log(r.out.slice(-4000))
    expect(r.code).toBe(0)
    // No new or changed files (node_modules is gitignored, so --porcelain does not show it).
    expect(ok(['git', 'status', '--porcelain'], dir)).toBe(statusBefore)

    // The command-line tests use temporary projects with the fake agent first on PATH,
    // and script events and a file edit for it.
    const harness = readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')
    expect(harness).toContain("mkdtempSync(join(tmpdir(), 'werk-project-'))")
    expect(harness).toMatch(/PATH: `\$\{bin\}:/)
    const cliTests = readdirSync(join(dir, 'src/cli')).filter((f) => f.endsWith('.test.ts'))
    const sources = cliTests.map((f) => readFileSync(join(dir, 'src/cli', f), 'utf8'))
    expect(sources.some((s) => s.includes('makeProject'))).toBe(true)
    const scripted = sources.filter((s) => s.includes('scriptAgent'))
    expect(scripted.some((s) => /event:/.test(s))).toBe(true)
    expect(scripted.some((s) => /edit:\s*\{/.test(s))).toBe(true)
  },
  LONG,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const dir = cloneRepo()
    const base = sh(['make', 'test-coverage'], dir, env)
    if (base.code !== 0) console.log(base.out.slice(-3000))
    expect(base.code).toBe(0)

    // Delete every test of src/cli/registry.ts except the first one.
    const file = join(dir, 'src/cli/registry.test.ts')
    const src = readFileSync(file, 'utf8')
    const cut = src.indexOf("  test('finds a verb by name")
    expect(cut).toBeGreaterThan(0)
    writeFileSync(file, src.slice(0, cut) + '})\n')

    const t = sh(['make', 'test'], dir, env)
    if (t.code !== 0) console.log(t.out.slice(-3000))
    expect(t.code).toBe(0)

    const low = sh(['make', 'test-coverage'], dir, env)
    console.log(low.out.split('\n').filter((l) => l.includes('registry') || l.includes('coverage gate')).join('\n'))
    expect(low.code).not.toBe(0)
    const line = low.out.split('\n').find((l) => l.includes('src/cli/registry.ts') && /FAIL/.test(l))
    expect(line).toBeDefined()
    const pct = Number(/(\d+(?:\.\d+)?)%/.exec(line!)![1])
    expect(pct).toBeLessThan(90)

    ok(['git', 'checkout', '--', 'src/cli/registry.test.ts'], dir)
    const again = sh(['make', 'test-coverage'], dir, env)
    if (again.code !== 0) console.log(again.out.slice(-3000))
    expect(again.code).toBe(0)
  },
  LONG,
)
