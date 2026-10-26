/** Feature 61: the repository, the make targets, the help verb, the fake agent, the coverage gate. Each test works in a fresh clone. */
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = join(import.meta.dir, '..', '..')
const OUT = join(import.meta.dir, 'out')
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

type R = { code: number; out: string }
function sh(cwd: string, cmd: string, env: Record<string, string | undefined> = process.env): R {
  const p = Bun.spawnSync(['sh', '-c', `${cmd} 2>&1`], { cwd, env: { ...env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() }
}
function save(name: string, r: R) {
  Bun.spawnSync(['mkdir', '-p', OUT])
  writeFileSync(join(OUT, name), `exit ${r.code}\n${r.out}`)
}
function clone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(root, `git clone --quiet --branch main ${JSON.stringify(SOURCE)} werk`)
  if (r.code !== 0) throw new Error(r.out)
  return dir
}
const HOUR = 60 * 60_000

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const roots = sh(dir, 'git rev-list --max-parents=0 main').out.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(dir, `git ls-tree -r --name-only ${first}`).out.trim()).toBe('')
  const commits = sh(dir, 'git rev-list main').out.trim().split('\n').filter((c) => c !== first)
  for (const c of commits) expect(sh(dir, `git merge-base --is-ancestor ${first} ${c}`).code).toBe(0)

  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(dir, `make ${target}`)
    save(`61.1-make-${target}.txt`, r)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
  // The project as the step names it, with no browser spec yet: the clone without its spec files.
  for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) unlinkSync(join(dir, 'e2e', f))
  const none = sh(dir, 'make e2e')
  save('61.1-make-e2e-no-specs.txt', none)
  expect(none.code).toBe(0)
}, 3 * HOUR)

test('61.2 the help verb lists every registered verb, and a new verb module appears with no other edit', async () => {
  const dir = clone()
  expect(sh(dir, 'bun install --frozen-lockfile').code).toBe(0)
  const help = sh(dir, 'bun src/cli/main.ts help')
  expect(help.code).toBe(0)
  const { registry } = await import(join(dir, 'src/cli/registry.ts'))
  const { loadVerbs } = await import(join(dir, 'src/cli/load-verbs.ts'))
  await loadVerbs()
  const names: string[] = registry.list().map((v: { name: string }) => v.name)
  expect(names).toContain('help')
  const listed = (out: string) => out.split('\n').flatMap((l) => (/^  ([a-z][a-z0-9-]*)\s/.exec(l) ? [/^  ([a-z][a-z0-9-]*)\s/.exec(l)![1]!] : []))
  expect(listed(help.out).toSorted()).toEqual(names.toSorted())

  const statusBefore = sh(dir, 'git status --porcelain').out
  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
  )
  const again = sh(dir, 'bun src/cli/main.ts help')
  expect(again.code).toBe(0)
  expect(listed(again.out).toSorted()).toEqual([...names, 'ping'].toSorted())
  expect(statusBefore).toBe('')
  expect(sh(dir, 'git status --porcelain').out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, 10 * 60_000)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = clone()
  expect(sh(dir, 'bun install --frozen-lockfile').code).toBe(0)
  const bunDir = join(process.execPath, '..')
  const path = [bunDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  const env = { HOME: process.env.HOME, PATH: path, TMPDIR: tmpdir(), LANG: 'C' }
  expect(sh(dir, 'command -v claude', env).code).not.toBe(0)
  const before = sh(dir, 'git status --porcelain --untracked-files=all').out
  const r = sh(dir, 'make test', env)
  save('61.3-make-test.txt', r)
  expect(r.code).toBe(0)
  // The command-line tests of the build verb read the fake agent's scripted events and file edits.
  expect(r.out).toContain('src/cli/build.test.ts')
  expect(r.out).not.toMatch(/\(fail\)/)
  // The harness: a temporary project, with the fake agent as claude first on its PATH.
  const probe = join(dir, 'src', 'test', 'zz-heldout-probe.test.ts')
  writeFileSync(
    probe,
    [
      "import { expect, test } from 'bun:test'",
      "import { existsSync, readFileSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "import { join } from 'node:path'",
      "import { makeProject } from './harness.ts'",
      "test('probe', () => {",
      '  const p = makeProject()',
      '  expect(p.dir.startsWith(tmpdir())).toBe(true)',
      "  p.scriptAgent({ steps: [{ event: { type: 'result', total_cost_usd: 0.5 } }, { edit: { path: 'made.txt', content: 'hi' } }] })",
      "  const r = p.run(['claude', '-p', 'x'])",
      "  expect(r.stdout).toContain('total_cost_usd')",
      "  expect(readFileSync(join(p.dir, 'made.txt'), 'utf8')).toBe('hi')",
      '  p.cleanup()',
      '})',
    ].join('\n'),
  )
  const pr = sh(dir, `bun test ${probe}`, env)
  unlinkSync(probe)
  save('61.3-probe.txt', pr)
  expect(pr.code).toBe(0)
  expect(sh(dir, 'git status --porcelain --untracked-files=all').out).toBe(before)
}, HOUR)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  const base = sh(dir, 'make test-coverage')
  save('61.4-coverage-before.txt', base)
  expect(base.code).toBe(0)
  const removed = 'src/map/stale-text.test.ts'
  unlinkSync(join(dir, removed))
  const t = sh(dir, 'make test')
  save('61.4-make-test.txt', t)
  expect(t.code).toBe(0)
  const c = sh(dir, 'make test-coverage')
  save('61.4-coverage-low.txt', c)
  expect(c.code).not.toBe(0)
  expect(c.out.split('\n').some((l) => l.includes('src/map/stale-text.ts') && /\d+(\.\d+)?%/.test(l))).toBe(true)
  expect(sh(dir, `git checkout -- ${removed}`).code).toBe(0)
  const again = sh(dir, 'make test-coverage')
  save('61.4-coverage-after.txt', again)
  expect(again.code).toBe(0)
}, HOUR)
