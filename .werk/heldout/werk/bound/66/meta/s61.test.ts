/**
 * The repository steps. Each test works in a fresh clone of this checkout, in a temporary
 * folder, with the merged product as its main branch. The checkout itself is not touched.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProject } from '../../src/test/harness.ts'

const SRC = join(import.meta.dir, '..', '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: SRC }).stdout.toString().trim()
const MIN = 60_000

let roots: string[] = []
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

/** The PATH with no folder that holds a `claude` program. */
const pathWithoutClaude = () =>
  (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d && !existsSync(join(d, 'claude')))
    .join(':')

function clone(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const fullEnv = { ...process.env, ...env } as Record<string, string>
  delete fullEnv.WERK_LOG
  const run = (cmd: string[], extra: Record<string, string> = {}) => {
    const p = Bun.spawnSync(cmd, { cwd: dir, env: { ...fullEnv, ...extra }, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
  }
  const c = Bun.spawnSync(['git', 'clone', '--quiet', SRC, dir])
  if (c.exitCode !== 0) throw new Error(c.stderr.toString())
  const co = run(['git', 'checkout', '--quiet', '-B', 'main', HEAD])
  if (co.code !== 0) throw new Error(co.out)
  return { dir, run }
}

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const { dir, run } = clone({ CI: 'true' })
    const roots = run(['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
    expect(roots.length).toBe(1)
    const first = roots[0]!
    expect(run(['git', 'ls-tree', '-r', '--name-only', first]).out.trim()).toBe('')
    const all = run(['git', 'rev-list', 'main']).out.trim().split('\n')
    for (const c of all) expect(run(['git', 'merge-base', '--is-ancestor', first, c]).code).toBe(0)

    const results: Record<string, number> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = run(['make', target])
      results[target] = r.code
      if (r.code !== 0) console.log(`make ${target} failed:\n${r.out.slice(-4000)}`)
    }
    expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })

    // The project before any browser spec: the e2e folder holds no spec.
    for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) rmSync(join(dir, 'e2e', f))
    const none = run(['make', 'e2e'])
    if (none.code !== 0) console.log(none.out.slice(-3000))
    expect(none.code).toBe(0)
  },
  30 * MIN,
)

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit',
  () => {
    const { dir, run } = clone()
    expect(run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
    const verbsIn = (out: string) => out.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]!)
    const before = verbsIn(run(['bun', 'src/cli/main.ts', 'help']).out)
    const registered = readdirSync(join(dir, 'src', 'cli', 'verbs'))
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .map((f) => {
        const m = /name: '([^']+)'/.exec(Bun.file(join(dir, 'src', 'cli', 'verbs', f)).toString())
        return m?.[1]
      })
    for (const f of readdirSync(join(dir, 'src', 'cli', 'verbs'))) {
      if (!f.endsWith('.ts') || f.includes('.test.')) continue
      const text = require('node:fs').readFileSync(join(dir, 'src', 'cli', 'verbs', f), 'utf8') as string
      const m = /registry\.register\(\{\s*name: '([^']+)'/.exec(text)
      expect(m, f).not.toBeNull()
      expect(before).toContain(m![1]!)
    }
    void registered
    expect(before).toContain('help')

    // git status reads the tree as clean before the edit; node_modules is ignored.
    expect(run(['git', 'status', '--porcelain']).out.trim()).toBe('')
    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'print pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
    )
    const after = verbsIn(run(['bun', 'src/cli/main.ts', 'help']).out)
    expect(after).toContain('ping')
    for (const v of before) expect(after).toContain(v)
    expect(run(['git', 'status', '--porcelain']).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  10 * MIN,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const PATH = pathWithoutClaude()
    const { run } = clone({ PATH, CI: 'true' })
    expect(Bun.spawnSync(['sh', '-c', 'command -v claude'], { env: { PATH } }).exitCode).not.toBe(0)
    const status0 = run(['git', 'status', '--porcelain', '--ignored=no']).out
    const r = run(['make', 'test'])
    if (r.code !== 0) console.log(r.out.slice(-4000))
    expect(r.code).toBe(0)
    expect(run(['git', 'status', '--porcelain']).out).toBe(status0)

    // The command-line tests launch the fake agent from a temporary project: it replays the
    // scripted event and makes the scripted file edit there.
    const p = makeProject()
    try {
      p.scriptAgent({ steps: [{ event: { type: 'hello', n: 1 } }, { edit: { path: 'notes/a.txt', content: 'edited' } }] })
      const env = { ...p.env, PATH: `${p.env.PATH!.split(':')[0]}:${PATH}` }
      const a = Bun.spawnSync(['claude', '-p', 'go'], { cwd: p.dir, env, stdout: 'pipe' })
      expect(a.exitCode).toBe(0)
      expect(JSON.parse(a.stdout.toString().trim())).toEqual({ type: 'hello', n: 1 })
      expect(require('node:fs').readFileSync(join(p.dir, 'notes', 'a.txt'), 'utf8')).toBe('edited')
      expect(p.dir.startsWith(tmpdir()) || p.dir.includes('/T/') || p.dir.startsWith('/tmp')).toBe(true)
    } finally {
      p.cleanup()
    }
  },
  15 * MIN,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const { dir, run } = clone({ CI: 'true' })
    const first = run(['make', 'test-coverage'])
    expect(first.code).toBe(0)

    // src/coverage/gate.ts is on the pure-file list; its unit tests are in gate.test.ts.
    const testFile = join(dir, 'src', 'coverage', 'gate.test.ts')
    const kept = join(dir, '..', 'gate.test.ts.kept')
    renameSync(testFile, kept)
    const t = run(['make', 'test'])
    expect(t.code).toBe(0)
    const cov = run(['make', 'test-coverage'])
    expect(cov.code).not.toBe(0)
    const line = cov.out.split('\n').find((l) => l.includes('src/coverage/gate.ts') && /FAIL/.test(l))
    expect(line, cov.out.slice(-2000)).toBeDefined()
    expect(line).toMatch(/\d+(\.\d+)?%/)

    renameSync(kept, testFile)
    const again = run(['make', 'test-coverage'])
    expect(again.code).toBe(0)
  },
  30 * MIN,
)
