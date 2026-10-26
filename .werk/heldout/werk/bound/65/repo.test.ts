/**
 * The repo-level steps. Each test clones this checkout into a temporary directory and runs
 * the make targets there, so the checkout itself never changes.
 */
import { expect, test } from 'bun:test'
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: SRC }).stdout.toString().trim()
const LONG = 1_800_000

type R = { code: number; out: string }

function clone(): { dir: string; run: (cmd: string[], env?: Record<string, string>) => R; sh: (c: string, env?: Record<string, string>) => R } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-repo-'))
  const dir = join(root, 'werk')
  const run = (cmd: string[], env?: Record<string, string>, cwd = dir): R => {
    const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
  }
  const c = run(['git', 'clone', '--quiet', '--no-local', SRC, dir], undefined, root)
  if (c.code !== 0) throw new Error(c.out)
  run(['git', 'checkout', '--quiet', '-B', 'main', HEAD])
  return { dir, run: (cmd, env) => run(cmd, env), sh: (s, env) => run(['/bin/sh', '-c', s], env) }
}

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const c = clone()
    const first = c.run(['git', 'rev-list', '--reverse', 'main']).out.split('\n')[0]!.trim()
    expect(c.run(['git', 'ls-tree', '-r', '--name-only', first]).out.trim()).toBe('')
    const roots = c.run(['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
    expect(roots).toEqual([first])
    const results: Record<string, number> = {}
    const outputs: Record<string, string> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = c.run(['make', target])
      results[target] = r.code
      outputs[target] = r.out.slice(-3000)
    }
    // make e2e with no browser spec: the specs move aside in the clone.
    for (const f of readdirSync(join(c.dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))) {
      renameSync(join(c.dir, 'e2e', f), join(c.dir, `${f}.aside`))
    }
    const noSpec = c.run(['make', 'e2e'])
    results['e2e-no-spec'] = noSpec.code
    outputs['e2e-no-spec'] = noSpec.out.slice(-1500)
    console.log('61.1 RESULTS', JSON.stringify(results))
    for (const [k, v] of Object.entries(results)) if (v !== 0) console.log(`61.1 OUTPUT ${k}:\n${outputs[k]}`)
    expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0, 'e2e-no-spec': 0 })
  },
  LONG,
)

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears with no other edit',
  () => {
    const c = clone()
    expect(c.run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
    const scriptDir = mkdtempSync(join(tmpdir(), 'werk-heldout-script-'))
    const script = join(scriptDir, 'list.ts')
    writeFileSync(
      script,
      `import { loadVerbs } from ${JSON.stringify(join(c.dir, 'src/cli/load-verbs.ts'))}\n` +
        `import { registry } from ${JSON.stringify(join(c.dir, 'src/cli/registry.ts'))}\n` +
        `await loadVerbs()\nconsole.log(JSON.stringify(registry.list().map((v) => v.name)))\n`,
    )
    const registered = JSON.parse(c.run(['bun', script]).out.trim()) as string[]
    const helpNames = (out: string) =>
      out
        .split('\n')
        .map((l) => /^ {2}(\S+)/.exec(l)?.[1])
        .filter((x): x is string => x !== undefined)
    const h1 = c.run(['bun', 'src/cli/main.ts', 'help'])
    expect(h1.code).toBe(0)
    const before = helpNames(h1.out)
    expect(before.toSorted()).toEqual(registered.toSorted())
    expect(before).toContain('help')

    writeFileSync(
      join(c.dir, 'src/cli/verbs/ping.ts'),
      "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
    )
    const h2 = c.run(['bun', 'src/cli/main.ts', 'help'])
    expect(h2.code).toBe(0)
    const after = helpNames(h2.out)
    expect(after).toContain('ping')
    for (const v of before) expect(after).toContain(v)
    expect(c.run(['git', 'status', '--porcelain']).out.trim().split('\n')).toEqual(['?? src/cli/verbs/ping.ts'])
  },
  LONG,
)

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const c = clone()
    const path = (process.env.PATH ?? '').split(':').filter((d) => {
      try {
        accessSync(join(d, 'claude'), constants.X_OK)
        return false
      } catch {
        return true
      }
    })
    const env = { PATH: path.join(':') }
    expect(c.sh('command -v claude', env).code).not.toBe(0)
    expect(c.run(['make', 'node_modules/.installed'], env).code).toBe(0)
    const statusBefore = c.run(['git', 'status', '--porcelain', '--ignored']).out
    const r = c.run(['make', 'test'], env)
    if (r.code !== 0) console.log('61.3 make test OUTPUT\n' + r.out.slice(-3000))
    expect(r.code).toBe(0)
    const h = c.run(['bun', 'test', 'src/test/harness.test.ts'], { ...env, CI: 'true' })
    expect(h.out).toContain('the fake agent replays its scripted events and edits a file in the project')
    expect(h.code).toBe(0)
    expect(c.run(['git', 'status', '--porcelain', '--ignored']).out).toBe(statusBefore)
  },
  LONG,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const c = clone()
    const first = c.run(['make', 'test-coverage'])
    if (first.code !== 0) console.log('61.4 GIVEN OUTPUT\n' + first.out.slice(-3000))
    expect(first.code).toBe(0)
    // src/map/stale-text.ts is on the pure-file list; its only unit tests are in this file.
    const test = join(c.dir, 'src/map/stale-text.test.ts')
    const aside = join(c.dir, '..', 'stale-text.test.ts.aside')
    renameSync(test, aside)
    const t = c.run(['make', 'test'])
    const cov = c.run(['make', 'test-coverage'])
    renameSync(aside, test)
    const again = c.run(['make', 'test-coverage'])
    console.log('61.4 RESULTS', JSON.stringify({ test: t.code, cov: cov.code, again: again.code }))
    if (t.code !== 0) console.log('61.4 make test OUTPUT\n' + t.out.slice(-3000))
    console.log('61.4 cov OUTPUT\n' + cov.out.slice(-1500))
    if (again.code !== 0) console.log('61.4 again OUTPUT\n' + again.out.slice(-3000))
    expect(t.code).toBe(0)
    expect(cov.code).not.toBe(0)
    expect(cov.out).toMatch(/src\/map\/stale-text\.ts/)
    expect(cov.out).toMatch(/\d+(\.\d+)?%[^\n]*src\/map\/stale-text\.ts|src\/map\/stale-text\.ts[^\n]*\d+(\.\d+)?%/)
    expect(again.code).toBe(0)
  },
  LONG,
)

test(
  '69.5 the person runs the browser tests and gets one screenshot per test',
  () => {
    const c = clone()
    const logBefore = existsSync(join(c.dir, '.werk', 'log.jsonl')) ? readFileSync(join(c.dir, '.werk', 'log.jsonl'), 'utf8') : null
    const fixtureBefore = readFileSync(join(c.dir, 'e2e/fixture-project/.werk/log.jsonl'), 'utf8')
    const r = c.run(['make', 'e2e'])
    const results = r.out.split('\n').filter((l) => /^\s+[✓✘-]\s+\d+ \[chromium\]/.test(l))
    console.log('69.5 RESULT LINES', results.length, 'exit', r.code)
    if (r.code !== 0) console.log(r.out.slice(-3000))
    const specs = readdirSync(join(c.dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))
    for (const s of specs) expect(results.some((l) => l.includes(`${s}:`))).toBe(true)
    const out = join(c.dir, 'test-results')
    const dirs = readdirSync(out).filter((d) => statSync(join(out, d)).isDirectory())
    const shots = dirs.map((d) => readdirSync(join(out, d)).filter((f) => f.endsWith('.png')).length)
    expect(results.length).toBeGreaterThan(0)
    expect(dirs.length).toBe(results.length)
    expect(shots.every((n) => n === 1)).toBe(true)
    const logAfter = existsSync(join(c.dir, '.werk', 'log.jsonl')) ? readFileSync(join(c.dir, '.werk', 'log.jsonl'), 'utf8') : null
    expect(logAfter).toBe(logBefore)
    expect(readFileSync(join(c.dir, 'e2e/fixture-project/.werk/log.jsonl'), 'utf8')).toBe(fixtureBefore)
    expect(r.code).toBe(0)
  },
  LONG,
)
