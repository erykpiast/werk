/**
 * Held-out steps 61.x. Every whole-repository action runs on a clone of this checkout in a
 * temporary folder, so the checkout itself never changes.
 */
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim()
const LONG = 30 * 60_000
const temps: string[] = []
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

type R = { code: number; out: string }
// The person's own shell: their real home folder, so tool caches (packages, browsers) are theirs.
const PERSON_ENV = { ...process.env, HOME: userInfo().homedir }
function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = PERSON_ENV): R {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

/** A person clones the werk repository: a fresh clone of this checkout, with main at its tip. */
function cloneRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'h61-'))
  temps.push(root)
  const dir = join(root, 'werk')
  expect(sh(['git', 'clone', '--quiet', ROOT, dir], root).code).toBe(0)
  expect(sh(['git', 'checkout', '--quiet', '-B', 'main', HEAD], dir).code).toBe(0)
  return dir
}

function install(dir: string) {
  const r = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(r.code).toBe(0)
  writeFileSync(join(dir, 'node_modules', '.installed'), '')
}

test(
  '61.1 A fresh clone builds on an empty first commit and passes every check',
  () => {
    // Given a person clones the werk repository
    const dir = cloneRepo()
    // When the person lists the files of the first commit on the main branch
    const roots = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
    expect(roots).toHaveLength(1)
    const first = roots[0]!
    // Then the first commit holds no files
    expect(sh(['git', 'ls-tree', '-r', '--name-only', first], dir).out.trim()).toBe('')
    // And every later commit on the main branch has the first commit as an ancestor
    const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')
    for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', first, c], dir).code).toBe(0)
    // When the person installs the dependencies and runs the five make targets one after the other
    const results: Record<string, R> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      results[target] = sh(['make', target], dir)
    }
    // Then each of the five commands exits with success
    for (const [target, r] of Object.entries(results)) {
      if (r.code !== 0) console.error(`make ${target} exited ${r.code}:\n${r.out.slice(-4000)}`)
    }
    expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
      test: 0,
      'test-coverage': 0,
      typecheck: 0,
      lint: 0,
      e2e: 0,
    })
    // And `make e2e` passes although the project has no browser spec yet
    // (the merged product has browser specs now; the pass of make e2e is what is checked)
  },
  LONG,
)

/** Every verb name that a verb module registers. */
function registeredVerbs(dir: string): string[] {
  const verbsDir = join(dir, 'src', 'cli', 'verbs')
  return readdirSync(verbsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => [...readFileSync(join(verbsDir, f), 'utf8').matchAll(/registry\.register\(\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]!))
}

test(
  '61.2 The help verb lists every registered verb, and a new verb module appears in it with no other edit',
  () => {
    // Given a person has a copy of the werk project with its dependencies installed
    const dir = cloneRepo()
    install(dir)
    const werk = (args: string[]) => sh(['bun', 'src/cli/main.ts', ...args], dir)
    // When the person runs `werk help`
    const before = werk(['help'])
    expect(before.code).toBe(0)
    const verbs = registeredVerbs(dir)
    // Then the output names every verb that the command line registers, and `help` is one of them
    expect(verbs).toContain('help')
    const named = (out: string) => new Set([...out.matchAll(/^\s{2}(\S+)\s/gm)].map((m) => m[1]!))
    for (const v of verbs) expect(named(before.out)).toContain(v)
    // When the person adds one new module that defines and registers a verb named `ping`
    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      [
        "import { registry } from '../registry.ts'",
        '',
        'registry.register({',
        "  name: 'ping',",
        "  summary: 'answer pong',",
        '  run(_args, io) {',
        "    io.out('pong')",
        '    return 0',
        '  },',
        '})',
        '',
      ].join('\n'),
    )
    // And the person changes no other file in the project; and runs `werk help` again
    const after = werk(['help'])
    expect(after.code).toBe(0)
    // Then the output names `ping` together with every verb it named before
    expect(named(after.out)).toContain('ping')
    for (const v of named(before.out)) expect(named(after.out)).toContain(v)
    // And `git status` shows the new module as the only changed file
    expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  },
  LONG,
)

test(
  '61.3 The tests pass on a machine with no real agent installed',
  () => {
    // Given a person has a copy of the werk project with its dependencies installed
    const dir = cloneRepo()
    install(dir)
    // And no `claude` program is installed or reachable on the PATH of the person's shell
    const path = (process.env.PATH ?? '')
      .split(':')
      .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
      .concat(dirname(process.execPath))
      .join(':')
    const env = { ...PERSON_ENV, PATH: path }
    expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
    const statusBefore = sh(['git', 'status', '--porcelain', '--ignored'], dir).out
    // When the person runs `make test`
    const r = sh(['make', 'test'], dir, env)
    // Then `make test` exits with success
    if (r.code !== 0) console.error(r.out.slice(-6000))
    expect(r.code).toBe(0)
    // And the tests that run the command line read the scripted events and the file edit of the
    // fake agent from a temporary project
    expect(r.out).toContain('the fake agent replays its scripted events and edits a file in the project')
    expect(r.out).not.toMatch(/\(fail\) the fake agent replays its scripted events/)
    // And the working tree of the person's project has no new or changed files after the run
    expect(sh(['git', 'status', '--porcelain', '--ignored'], dir).out).toBe(statusBefore)
  },
  LONG,
)

test(
  '61.4 The coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    // Given a person has a copy of the werk project where `make test-coverage` passes
    const dir = cloneRepo()
    install(dir)
    const pure = 'src/map/find.ts'
    const ownTest = join(dir, 'src', 'map', 'find.test.ts')
    // When the person deletes enough unit tests that one file on the pure-file list drops below 90% coverage
    writeFileSync(ownTest, "import { expect, test } from 'bun:test'\nimport './find.ts'\n\ntest('kept', () => expect(1).toBe(1))\n")
    // And the person runs `make test`
    const plain = sh(['make', 'test'], dir)
    // Then `make test` exits with success, because plain unit tests do not check coverage
    if (plain.code !== 0) console.error(plain.out.slice(-4000))
    expect(plain.code).toBe(0)
    // When the person runs `make test-coverage`
    const low = sh(['make', 'test-coverage'], dir)
    // Then `make test-coverage` exits with an error
    expect(low.code).not.toBe(0)
    // And the output names that file and its coverage percentage
    const line = low.out.split('\n').find((l) => l.includes(pure) && l.includes('FAIL'))
    expect(line).toBeDefined()
    expect(line).toMatch(/\d+\.\d%/)
    // When the person restores the deleted tests and runs `make test-coverage` again
    expect(sh(['git', 'checkout', '--', 'src/map/find.test.ts'], dir).code).toBe(0)
    const back = sh(['make', 'test-coverage'], dir)
    // Then `make test-coverage` exits with success
    if (back.code !== 0) console.error(back.out.slice(-4000))
    expect(back.code).toBe(0)
  },
  LONG,
)
