import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
/** The merged product is this checkout's commit. The shared main ref can move under other worktrees. */
const PRODUCT = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO }).stdout.toString().trim()
const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

type R = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
/** A person clones the werk repository. */
const clone = () => {
  const root = mkdtempSync(join(tmpdir(), 'werk-clone-'))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', REPO, dir], root)
  if (r.code !== 0) throw new Error(r.out)
  const co = sh(['git', 'checkout', '--quiet', '-B', 'main', PRODUCT], dir)
  if (co.code !== 0) throw new Error(co.out)
  return dir
}
const install = (dir: string) => expect(sh(['make', 'node_modules/.installed'], dir).code).toBe(0)
const status = (dir: string) => sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out.trim()

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const first = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
  expect(first).toHaveLength(1)
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first[0]!], dir).out.trim()).toBe('')
  const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')
  for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first[0]!, c], dir).code).toBe(0)
  const results: Record<string, number> = {}
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir)
    results[target] = r.code
    if (r.code !== 0) console.error(`make ${target}:\n${r.out.slice(-3000)}`)
  }
  expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })
  // The checkout has browser specs now; the binder removes them in the clone to see the no-spec case.
  const specs = sh(['git', 'ls-files', 'e2e/*.spec.ts'], dir).out.trim().split('\n').filter(Boolean)
  for (const s of specs) unlinkSync(join(dir, s))
  const none = sh(['make', 'e2e'], dir)
  if (none.code !== 0) console.error(none.out.slice(-2000))
  expect(none.code).toBe(0)
}, 1_800_000)

test('61.2 help lists every registered verb, and a new verb module appears with no other edit', () => {
  const dir = clone()
  install(dir)
  const werk = () => sh(['bun', 'src/cli/main.ts', 'help'], dir)
  const before = werk()
  expect(before.code).toBe(0)
  const verbs = sh(['ls', 'src/cli/verbs'], dir).out.trim().split('\n').map((f) => f.replace(/\.tsx?$/, ''))
  for (const v of verbs) expect(before.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))
  expect(before.out).toMatch(/^\s+help\s/m)
  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
  )
  const after = werk()
  expect(after.code).toBe(0)
  expect(after.out).toMatch(/^\s+ping\s/m)
  for (const v of verbs) expect(after.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))
  expect(status(dir)).toBe('?? src/cli/verbs/ping.ts')
}, 600_000)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = clone()
  const bin = join(dir, '..', 'bin')
  mkdirSync(bin)
  symlinkSync(process.execPath, join(bin, 'bun'))
  symlinkSync(process.execPath, join(bin, 'bunx'))
  const PATH = `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`
  expect(sh(['sh', '-c', 'command -v claude'], dir, { ...process.env, PATH }).code).not.toBe(0)
  const before = status(dir)
  const r = sh(['make', 'test'], dir, { HOME: process.env.HOME, PATH, TMPDIR: process.env.TMPDIR })
  if (r.code !== 0) console.error(r.out.slice(-4000))
  expect(r.code).toBe(0)
  expect(r.out).toMatch(/the fake agent replays its scripted events and edits a file in the project/)
  expect(r.out).not.toMatch(/\(fail\)/)
  // node_modules is ignored by git; the run must leave no other new or changed file.
  expect(status(dir)).toBe(before)
}, 900_000)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  expect(sh(['make', 'test-coverage'], dir).code).toBe(0)
  const victim = 'src/map/stale-text.test.ts'
  unlinkSync(join(dir, victim))
  expect(sh(['make', 'test'], dir).code).toBe(0)
  const cov = sh(['make', 'test-coverage'], dir)
  expect(cov.code).not.toBe(0)
  expect(cov.out).toMatch(/src\/map\/stale-text\.ts.*\d+(\.\d+)?%/)
  console.error(cov.out.split('\n').filter((l) => /gate|stale-text|90/.test(l)).slice(-8).join('\n'))
  sh(['git', 'checkout', '--', victim], dir)
  expect(sh(['make', 'test-coverage'], dir).code).toBe(0)
}, 900_000)
