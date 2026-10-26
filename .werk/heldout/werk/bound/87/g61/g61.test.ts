/** Held-out steps 61.1 to 61.4. Each test works on a fresh clone of this checkout's HEAD in a temp dir. */
import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const LONG = 1_200_000

type R = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

function clone(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-g61-'))
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', '--branch', 'main', REPO, dir], root)
  if (r.code !== 0) throw new Error(r.out)
  return dir
}
const install = (dir: string, env?: Record<string, string | undefined>) => {
  const r = sh(['bun', 'install', '--frozen-lockfile'], dir, env)
  if (r.code !== 0) throw new Error(r.out)
}

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const dir = clone()
  try {
    const first = sh(['git', 'rev-list', '--max-parents=0', 'main'], dir).out.trim().split('\n')
    expect(first.length).toBe(1)
    const root = first[0]!
    expect(sh(['git', 'ls-tree', '-r', '--name-only', root], dir).out.trim()).toBe('')
    const all = sh(['git', 'rev-list', 'main'], dir).out.trim().split('\n')
    for (const c of all) expect(sh(['git', 'merge-base', '--is-ancestor', root, c], dir).code).toBe(0)

    install(dir)
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = sh(['make', target], dir)
      if (r.code !== 0) console.error(`make ${target} failed:\n${r.out.slice(-3000)}`)
      expect({ target, code: r.code }).toEqual({ target, code: 0 })
    }
    // "make e2e passes although the project has no browser spec yet": remove every spec in the clone and run it again.
    for (const f of readdirSync(join(dir, 'e2e'))) if (f.endsWith('.spec.ts')) rmSync(join(dir, 'e2e', f))
    const noSpec = sh(['make', 'e2e'], dir)
    if (noSpec.code !== 0) console.error(noSpec.out.slice(-3000))
    expect(noSpec.code).toBe(0)
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
}, LONG)

test('61.2 help lists every registered verb, and a new ping module appears with no other edit', () => {
  const dir = clone()
  try {
    install(dir)
    const verbsDir = join(dir, 'src', 'cli', 'verbs')
    const registered = readdirSync(verbsDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .flatMap((f) => [...readFileSync(join(verbsDir, f), 'utf8').matchAll(/registry\.register\(\{\s*name:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!))
    expect(registered).toContain('help')
    const words = (out: string) => new Set(out.split(/\s+/))
    const before = sh(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(before.code).toBe(0)
    for (const v of registered) expect(words(before.out).has(v) || before.out.includes(v)).toBe(true)
    const named = registered.filter((v) => new RegExp(`(^|\\s)${v}(\\s|$)`, 'm').test(before.out))
    expect(named.sort()).toEqual([...registered].sort())

    writeFileSync(
      join(verbsDir, 'ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const after = sh(['bun', 'src/cli/main.ts', 'help'], dir)
    expect(after.code).toBe(0)
    expect(after.out).toMatch(/(^|\s)ping(\s|$)/m)
    for (const v of registered) expect(after.out).toMatch(new RegExp(`(^|\\s)${v}(\\s|$)`, 'm'))
    expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
}, LONG)

test('61.3 the tests pass with no claude on the PATH and leave the tree clean', () => {
  const dir = clone()
  try {
    install(dir)
    // A PATH with every folder that holds a `claude` program taken out.
    const path = (process.env.PATH ?? '')
      .split(delimiter)
      .filter((d) => d && !Bun.spawnSync(['test', '-e', join(d, 'claude')]).success)
      .join(delimiter)
    const env = { ...process.env, PATH: path }
    expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
    const r = sh(['make', 'test'], dir, env)
    if (r.code !== 0) console.error(r.out.slice(-4000))
    expect(r.code).toBe(0)
    // The command-line tests use the harness: a temp project, the fake agent as claude, and a scripted file edit.
    const harness = readFileSync(join(dir, 'src', 'test', 'harness.ts'), 'utf8')
    expect(harness).toContain('mkdtempSync(join(tmpdir()')
    expect(harness).toContain("join(bin, 'claude')")
    const build = readFileSync(join(dir, 'src', 'cli', 'build.test.ts'), 'utf8')
    expect(build).toMatch(/edit:/)
    expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('')
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
}, LONG)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = clone()
  try {
    install(dir)
    const file = 'src/cli/args.ts'
    const testPath = join(dir, 'src', 'cli', 'args.test.ts')
    const original = readFileSync(testPath, 'utf8')
    expect(sh(['make', 'test-coverage'], dir).code).toBe(0)
    // Keep only the first test: delete the tests of the refusals and the switches.
    const cut = original.indexOf("test('refuses an unknown flag")
    expect(cut).toBeGreaterThan(0)
    writeFileSync(testPath, original.slice(0, cut))

    const plain = sh(['make', 'test'], dir)
    if (plain.code !== 0) console.error(plain.out.slice(-3000))
    expect(plain.code).toBe(0)
    const gate = sh(['make', 'test-coverage'], dir)
    console.log(gate.out.slice(-2000))
    expect(gate.code).not.toBe(0)
    const line = gate.out.split('\n').find((l) => l.includes(file))
    expect(line).toBeDefined()
    expect(line!).toMatch(/\d+(\.\d+)?%/)

    writeFileSync(testPath, original)
    expect(sh(['make', 'test-coverage'], dir).code).toBe(0)
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
}, LONG)
