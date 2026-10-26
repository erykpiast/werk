/** Held-out steps 61.1–61.4: the repository, the make targets, help, and the coverage gate. */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const MIN = 60_000

type R = { code: number; out: string }
const sh = (cmd: string, cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(['/bin/sh', '-c', cmd], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const clone = (): string => {
  const dir = join(mkdtempSync(join(tmpdir(), 'werk-heldout-61-')), 'werk')
  const r = sh(`git clone --quiet --branch main ${JSON.stringify(ROOT)} ${JSON.stringify(dir)}`, tmpdir())
  if (r.code !== 0) throw new Error(`binder: clone failed: ${r.out}`)
  return dir
}
// A make run with no inherited CI flags beyond what the Makefile sets.
const env = { ...process.env, CI: undefined }
const tail = (s: string) => s.slice(-1500)

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  const first = sh('git rev-list --max-parents=0 main', dir).out.trim().split('\n')
  expect(first).toHaveLength(1)
  expect(sh(`git ls-tree -r --name-only ${first[0]}`, dir).out.trim()).toBe('')
  const all = sh('git rev-list main', dir).out.trim().split('\n')
  for (const c of all) expect(sh(`git merge-base --is-ancestor ${first[0]} ${c}`, dir).code).toBe(0)

  const results: Record<string, R> = {}
  for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) results[t] = sh(`make ${t}`, dir, env)
  for (const [t, r] of Object.entries(results)) {
    if (r.code !== 0) console.error(`make ${t} exited ${r.code}:\n${tail(r.out)}`)
  }
  expect(Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.code]))).toEqual({
    test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0,
  })
}, 40 * MIN)

test('61.2 help lists every registered verb, and a new verb module appears with no other edit', () => {
  const dir = clone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const before = sh('bun src/cli/main.ts help', dir)
  expect(before.code).toBe(0)
  const verbFiles = sh('ls src/cli/verbs', dir).out.trim().split('\n').filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''))
  const named = (out: string) => out.split('\n').filter((l) => /^  \S/.test(l)).map((l) => l.trim().split(/\s+/)[0]!)
  const namesBefore = named(before.out)
  expect(namesBefore).toContain('help')
  for (const v of verbFiles) expect(namesBefore).toContain(v)

  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run: (_args, io) => {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const after = sh('bun src/cli/main.ts help', dir)
  expect(after.code).toBe(0)
  const namesAfter = named(after.out)
  expect(namesAfter).toContain('ping')
  for (const v of namesBefore) expect(namesAfter).toContain(v)
  expect(sh('git status --porcelain', dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, 5 * MIN)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = clone()
  // A PATH with every folder that holds a claude program left out.
  const path = (process.env.PATH ?? '').split(':').filter((p) => p && !Bun.spawnSync(['test', '-e', join(p, 'claude')]).success).join(':')
  const noClaude = { ...env, PATH: path }
  expect(sh('command -v claude', dir, noClaude).code).not.toBe(0)
  const before = sh('git status --porcelain --untracked-files=all', dir).out
  const r = sh('make test', dir, noClaude)
  if (r.code !== 0) console.error(tail(r.out))
  expect(r.code).toBe(0)
  expect(sh('git status --porcelain --untracked-files=all', dir).out).toBe(before)

  // The command-line tests run in a temporary project with the fake agent as claude.
  const harness = readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')
  expect(harness).toContain("mkdtempSync(join(tmpdir(), 'werk-project-'))")
  expect(harness).toContain('FAKE_AGENT')
  expect(harness).toContain('PATH: `${bin}:')
  // At least one command-line test scripts the fake agent with an event and an edit.
  const grep = sh(`grep -l "scriptAgent" src/cli/*.test.ts | xargs grep -l "edit:" | xargs grep -l "event:"`, dir)
  expect(grep.out.trim()).not.toBe('')
}, 20 * MIN)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  const pure = 'src/cli/args.ts'
  const own = 'src/cli/args.test.ts'
  expect(readFileSync(join(dir, 'src/coverage/pure-files.ts'), 'utf8')).toContain(`'${pure}'`)
  expect(sh('make test-coverage', dir, env).code).toBe(0)

  // Keep only the first unit test of args.ts.
  const text = readFileSync(join(dir, own), 'utf8')
  writeFileSync(join(dir, own), text.slice(0, text.indexOf("\ntest('a value may start")) + '\n')
  const t = sh('make test', dir, env)
  if (t.code !== 0) console.error(tail(t.out))
  expect(t.code).toBe(0)
  const cov = sh('make test-coverage', dir, env)
  console.error(`coverage output after deletion:\n${tail(cov.out)}`)
  expect(cov.code).not.toBe(0)
  expect(cov.out).toMatch(/src\/cli\/args\.ts[^\n]*\d+(\.\d+)?%/)

  expect(sh(`git checkout -- ${own}`, dir).code).toBe(0)
  expect(sh('make test-coverage', dir, env).code).toBe(0)
}, 20 * MIN)
