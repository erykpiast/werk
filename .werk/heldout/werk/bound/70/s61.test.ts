/** The 61.x steps run in a fresh clone of this checkout, so the checkout itself stays as it is. */
import { afterAll, expect, test } from 'bun:test'
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim()
const temps: string[] = []
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

type R = { code: number; out: string }
const run = (cmd: string[], cwd: string, env: Record<string, string | undefined> = { ...process.env, CI: 'true' }): R => {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

function clone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  temps.push(root)
  const dir = join(root, 'werk')
  expect(run(['git', 'clone', '--quiet', ROOT, dir], root).code).toBe(0)
  expect(run(['git', 'checkout', '--quiet', '--detach', HEAD], dir).code).toBe(0)
  return dir
}
const install = (dir: string) => expect(run(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const dir = clone()
    const roots = run(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
    expect(roots).toHaveLength(1)
    const first = roots[0]!
    expect(run(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
    const commits = run(['git', 'rev-list', 'main'], dir).out.trim().split('\n').filter((c) => c !== first)
    for (const c of commits) expect(run(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)

    install(dir)
    const results: Record<string, number> = {}
    const outputs: Record<string, string> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = run(['make', target], dir)
      results[target] = r.code
      outputs[target] = r.out.slice(-1500)
    }
    expect({ results, outputs }).toMatchObject({ results: { test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 } })

    // The project has browser specs now. Take them away to see `make e2e` pass with none.
    for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) unlinkSync(join(dir, 'e2e', f))
    const none = run(['make', 'e2e'], dir)
    expect({ code: none.code, out: none.out.slice(-1500) }).toMatchObject({ code: 0 })
  },
  1_500_000,
)

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears with no other edit',
  () => {
    const dir = clone()
    install(dir)
    const verbsDir = join(dir, 'src', 'cli', 'verbs')
    const registered = readdirSync(verbsDir)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) => [...readFileSync(join(verbsDir, f), 'utf8').matchAll(/registry\.register\(\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]!))
    expect(registered).toContain('help')
    const help = run(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(help.code).toBe(0)
    const named = (out: string) => out.split('\n').map((l) => l.trim().split(/\s+/)[0])
    for (const v of registered) expect(named(help.out)).toContain(v)

    writeFileSync(
      join(verbsDir, 'ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const again = run(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(again.code).toBe(0)
    for (const v of [...registered, 'ping']) expect(named(again.out)).toContain(v)
    expect(run(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  300_000,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const dir = clone()
    install(dir)
    const isExe = (p: string) => {
      try {
        accessSync(p, constants.X_OK)
        return true
      } catch {
        return false
      }
    }
    const path = (process.env.PATH ?? '')
      .split(':')
      .filter((d) => d !== '' && d !== '.' && !isExe(join(d, 'claude')))
      .join(':')
    const env = { ...process.env, PATH: path, CI: 'true' }
    expect(run(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
    const before = run(['git', 'status', '--porcelain'], dir).out
    const r = run(['make', 'test'], dir, env)
    expect({ code: r.code, out: r.out.slice(-2000) }).toMatchObject({ code: 0 })
    // The harness test replays the fake agent's scripted events and its file edit in a temporary project.
    const harness = run(
      ['bun', 'test', '--timeout', '30000', 'src/test/harness.test.ts', '-t', 'the fake agent replays its scripted events and edits a file in the project'],
      dir,
      env,
    )
    expect(harness.code).toBe(0)
    expect(harness.out).toMatch(/\b1 pass\b/)
    expect(run(['git', 'status', '--porcelain'], dir).out).toBe(before)
    expect(before).toBe('')
  },
  600_000,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const dir = clone()
    install(dir)
    expect(run(['make', 'test-coverage'], dir).code).toBe(0)
    // src/ticket/spec.ts is on the pure-file list, and only src/ticket/spec.test.ts loads it.
    unlinkSync(join(dir, 'src', 'ticket', 'spec.test.ts'))
    expect(run(['make', 'test'], dir).code).toBe(0)
    const cov = run(['make', 'test-coverage'], dir)
    expect(cov.code).not.toBe(0)
    const line = cov.out.split('\n').find((l) => l.includes('src/ticket/spec.ts'))
    expect(line).toBeDefined()
    expect(line).toMatch(/FAIL\s+\d+(\.\d+)?%/)
    expect(run(['git', 'checkout', '--', 'src/ticket/spec.test.ts'], dir).code).toBe(0)
    expect(existsSync(join(dir, 'src', 'ticket', 'spec.test.ts'))).toBe(true)
    expect(run(['make', 'test-coverage'], dir).code).toBe(0)
  },
  900_000,
)
