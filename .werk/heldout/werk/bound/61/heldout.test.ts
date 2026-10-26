/** Held-out tests for ticket 61. Each test works in a fresh clone of the repository. */
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const BUN_DIR = dirname(process.execPath)
const T = 900_000
const temps: string[] = []
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })))

type R = { code: number; out: string }
const sh = (cwd: string, cmd: string, env: Record<string, string> = {}): R => {
  const p = Bun.spawnSync(['/bin/sh', '-c', `${cmd} 2>&1`], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
  })
  const r = { code: p.exitCode ?? -1, out: p.stdout.toString() }
  console.log(`--- [${cwd}] ${cmd} -> ${r.code}\n${r.out.slice(-3000)}`)
  return r
}

// "A person clones the werk repository", main branch checked out.
const clone = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
  temps.push(root)
  const dir = join(root, 'werk')
  expect(sh(root, `git clone --quiet --branch main ${JSON.stringify(REPO)} werk`).code).toBe(0)
  return dir
}
const install = (dir: string) => expect(sh(dir, 'bun install --frozen-lockfile').code).toBe(0)

test('61.1 empty first commit, fresh clone passes every check', () => {
  const dir = clone()
  const root = sh(dir, 'git rev-list --max-parents=0 main')
  expect(root.code).toBe(0)
  const roots = root.out.trim().split('\n')
  expect(roots.length).toBe(1)
  const first = roots[0]!
  expect(sh(dir, `git ls-tree -r --name-only ${first}`).out).toBe('')
  for (const c of sh(dir, 'git rev-list main').out.trim().split('\n')) {
    if (c === first) continue
    expect({ c, code: sh(dir, `git merge-base --is-ancestor ${first} ${c}`).code }).toEqual({ c, code: 0 })
  }
  install(dir)
  const codes: Record<string, number> = {}
  let e2eOut = ''
  for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(dir, `make ${t}`)
    codes[t] = r.code
    if (t === 'e2e') e2eOut = r.out
  }
  expect(codes).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })
  expect(readdirSync(join(dir, 'e2e')).filter((f) => /\.(spec|test)\.[jt]sx?$/.test(f))).toEqual([])
  expect(e2eOut).not.toMatch(/\d+ passed|\d+ failed/)
}, T)

test('61.2 help lists every verb; a new ping module appears with no other edit', () => {
  const dir = clone()
  install(dir)
  const verbsDir = join(dir, 'src/cli/verbs')
  const registered = readdirSync(verbsDir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f))
    .flatMap((f) => [...readFileSync(join(verbsDir, f), 'utf8').matchAll(/name:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!))
  expect(registered).toContain('help')
  const before = sh(dir, 'bun run werk help')
  expect(before.code).toBe(0)
  for (const v of registered) expect(before.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))

  writeFileSync(
    join(verbsDir, 'ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const after = sh(dir, 'bun run werk help')
  expect(after.code).toBe(0)
  expect(after.out).toMatch(/^\s+ping\s/m)
  for (const v of registered) expect(after.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))
  expect(sh(dir, 'git status --porcelain --untracked-files=all').out).toBe('?? src/cli/verbs/ping.ts\n')
}, T)

test('61.3 make test passes with no claude on PATH and leaves the tree clean', () => {
  const dir = clone()
  install(dir)
  const PATH = `${BUN_DIR}:/usr/bin:/bin:/usr/sbin:/sbin`
  expect(sh(dir, 'command -v claude', { PATH }).code).not.toBe(0)
  const r = sh(dir, 'make test', { PATH })
  expect(r.code).toBe(0)
  expect(r.out).toMatch(/ 0 fail/)
  // The command-line tests use the harness: a temporary project with the fake agent as claude.
  const harnessTest = readFileSync(join(dir, 'src/test/harness.test.ts'), 'utf8')
  expect(harnessTest).toContain('the fake agent replays its scripted events and edits a file in the project')
  expect(readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')).toMatch(/mkdtempSync\(join\(tmpdir\(\)/)
  expect(readFileSync(join(dir, 'src/cli/cli.test.ts'), 'utf8')).toContain('makeProject')
  expect(sh(dir, 'git status --porcelain --untracked-files=all').out).toBe('')
}, T)

test('61.4 the coverage gate fails below 90% on a pure file and passes again', () => {
  const dir = clone()
  install(dir)
  expect(sh(dir, 'make test-coverage').code).toBe(0)
  // help-text.ts is on the pure-file list; its only in-process unit tests are in help-text.test.ts.
  expect(readFileSync(join(dir, 'src/coverage/pure-files.ts'), 'utf8')).toContain("'src/cli/help-text.ts'")
  unlinkSync(join(dir, 'src/cli/help-text.test.ts'))
  expect(sh(dir, 'make test').code).toBe(0)
  const bad = sh(dir, 'make test-coverage')
  expect(bad.code).not.toBe(0)
  const line = bad.out.split('\n').find((l) => l.includes('src/cli/help-text.ts') && /FAIL/.test(l))
  expect(line).toBeDefined()
  const pct = Number(line!.match(/(\d+(?:\.\d+)?)%/)![1])
  expect(pct).toBeLessThan(90)
  expect(sh(dir, 'git checkout -- src/cli/help-text.test.ts').code).toBe(0)
  expect(sh(dir, 'make test-coverage').code).toBe(0)
}, T)
