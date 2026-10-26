import { afterAll, expect, test } from 'bun:test'
import { accessSync, constants, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloneRepo, sh, show } from './clone.ts'

const T = 600_000
const cleanups: (() => void)[] = []
afterAll(() => cleanups.forEach((c) => c()))
const clone = () => {
  const c = cloneRepo()
  cleanups.push(c.cleanup)
  return c.dir
}

test('61.1 fresh clone: empty first commit, every check passes', () => {
  const dir = clone()
  const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).stdout.trim().split('\n')
  expect(roots).toHaveLength(1)
  const first = roots[0]!
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).stdout).toBe('')
  const all = sh(['git', 'rev-list', 'main'], dir).stdout.trim().split('\n')
  for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)
  for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', target], dir)
    if (r.code !== 0) console.log(`make ${target}:\n${show(r)}`)
    expect({ target, code: r.code }).toEqual({ target, code: 0 })
  }
  expect(existsSync(join(dir, 'e2e'))).toBe(true)
  const specs = sh(['git', 'ls-files', 'e2e'], dir).stdout.split('\n').filter((f) => /\.(spec|test)\.[jt]sx?$/.test(f))
  expect(specs).toEqual([])
}, T)

test('61.2 help lists every verb, a new ping module shows with no other edit', () => {
  const dir = clone()
  expect(sh(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)
  // `bun install` must not change tracked files
  const werkHelp = () => sh(['bun', 'src/cli/main.ts', 'help'], dir)
  const r1 = werkHelp()
  expect(r1.code).toBe(0)
  // the verbs the command line registers: every module in src/cli/verbs calls registry.register
  const reg = sh(['bun', '-e', "import {loadVerbs} from './src/cli/load-verbs.ts'; import {registry} from './src/cli/registry.ts'; await loadVerbs(); console.log(registry.list().map(v=>v.name).join('\\n'))"], dir)
  expect(reg.code).toBe(0)
  const names = reg.stdout.trim().split('\n')
  expect(names).toContain('help')
  for (const n of names) expect(r1.stdout).toMatch(new RegExp(`\\b${n}\\b`))
  writeFileSync(
    join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const r2 = werkHelp()
  expect(r2.code).toBe(0)
  expect(r2.stdout).toMatch(/\bping\b/)
  for (const n of names) expect(r2.stdout).toMatch(new RegExp(`\\b${n}\\b`))
  expect(sh(['git', 'status', '--porcelain'], dir).stdout.trim()).toBe('?? src/cli/verbs/ping.ts')
}, T)

test('61.3 make test passes with no claude on PATH and leaves the tree clean', () => {
  const dir = clone()
  const isExe = (p: string) => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const path = (process.env.PATH ?? '').split(':').filter((d) => d && !isExe(join(d, 'claude'))).join(':')
  const env = { ...process.env, PATH: path }
  expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
  const r = sh(['make', 'test'], dir, env)
  if (r.code !== 0) console.log(show(r))
  expect(r.code).toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/ 0 fail/)
  expect(out).toMatch(/across 14 files/)
  // the command-line tests that read the fake agent's events and file edit live in src/test/harness.test.ts
  expect(readFileSync(join(dir, 'src/test/harness.test.ts'), 'utf8')).toContain('the fake agent replays its scripted events and edits a file in the project')
  expect(readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')).toContain("mkdtempSync(join(tmpdir(), 'werk-project-'))")
  expect(sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).stdout).toBe('')
}, T)

test('61.4 coverage gate fails under 90% on a pure file and passes again after restore', () => {
  const dir = clone()
  const pre = sh(['make', 'test-coverage'], dir)
  expect(pre.code).toBe(0)
  const victim = 'src/cli/help-text.test.ts'
  rmSync(join(dir, victim))
  const t = sh(['make', 'test'], dir)
  expect(t.code).toBe(0)
  const c = sh(['make', 'test-coverage'], dir)
  console.log('61.4 gate output after delete:\n' + show(c))
  expect(c.code).not.toBe(0)
  const out = c.stdout + c.stderr
  expect(out).toContain('src/cli/help-text.ts')
  const lcov = readFileSync(join(dir, 'coverage', 'lcov.info'), 'utf8')
  expect(lcov.length).toBeGreaterThan(0)
  expect(out).toMatch(/src\/cli\/help-text\.ts[^\n]*\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*%[^\n]*src\/cli\/help-text\.ts/)
  expect(sh(['git', 'checkout', '--', victim], dir).code).toBe(0)
  const c2 = sh(['make', 'test-coverage'], dir)
  if (c2.code !== 0) console.log(show(c2))
  expect(c2.code).toBe(0)
}, T)
