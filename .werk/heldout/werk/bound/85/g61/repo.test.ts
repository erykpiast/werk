import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const T = 30 * 60_000

function sh(cmd: string[], cwd: string, env: Record<string, string> = process.env as Record<string, string>) {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, CI: 'true' }, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
function cloneHead(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'werk-g61-')), 'werk')
  const head = sh(['git', 'rev-parse', 'HEAD'], ROOT).out.trim()
  expect(sh(['git', 'clone', '--quiet', '--no-checkout', ROOT, dir], ROOT).code).toBe(0)
  expect(sh(['git', 'checkout', '--quiet', head], dir).code).toBe(0)
  return dir
}

test('61.1 first commit empty, ancestry, five make targets', () => {
  const first = sh(['git', 'rev-list', '--max-parents=0', 'main'], ROOT).out.trim().split('\n')
  expect(first.length).toBe(1)
  expect(sh(['git', 'ls-tree', '-r', '--name-only', first[0]!], ROOT).out.trim()).toBe('')
  for (const c of sh(['git', 'rev-list', 'main'], ROOT).out.trim().split('\n')) {
    expect(sh(['git', 'merge-base', '--is-ancestor', first[0]!, c], ROOT).code).toBe(0)
  }
  const dir = cloneHead()
  for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(['make', t], dir)
    if (r.code !== 0) console.log(`make ${t} failed:\n${r.out.slice(-4000)}`)
    expect({ t, code: r.code }).toEqual({ t, code: 0 })
  }
  // no browser spec: remove every spec and run make e2e again
  for (const f of readdirSync(join(dir, 'e2e')).filter((f) => f.endsWith('.spec.ts'))) rmSync(join(dir, 'e2e', f))
  const r = sh(['make', 'e2e'], dir)
  if (r.code !== 0) console.log(r.out.slice(-3000))
  expect(r.code).toBe(0)
}, T)

test('61.2 help lists every verb, a new ping module appears', () => {
  const dir = cloneHead()
  expect(sh(['bun', 'install', '--frozen-lockfile'], dir).code).toBe(0)
  const help1 = sh(['bun', 'src/cli/main.ts', 'help'], dir)
  expect(help1.code).toBe(0)
  const verbsDir = join(dir, 'src/cli/verbs')
  const names = readdirSync(verbsDir).flatMap((f) => [...readFileSync(join(verbsDir, f), 'utf8').matchAll(/name: '([a-z-]+)'/g)].map((m) => m[1]!))
  expect(names).toContain('help')
  const words = (s: string) => new Set(s.split(/\s+/))
  const w1 = words(help1.out)
  for (const n of names) expect({ n, named: w1.has(n) }).toEqual({ n, named: true })
  writeFileSync(join(verbsDir, 'ping.ts'), `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`)
  const help2 = sh(['bun', 'src/cli/main.ts', 'help'], dir)
  expect(help2.code).toBe(0)
  const w2 = words(help2.out)
  for (const n of [...names, 'ping']) expect({ n, named: w2.has(n) }).toEqual({ n, named: true })
  expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, T)

test('61.3 make test with no claude on PATH', () => {
  const dir = cloneHead()
  const bin = mkdtempSync(join(tmpdir(), 'werk-g61-bin-'))
  const dirs = (process.env.PATH ?? '').split(':').filter((d) => d && !existsSync(join(d, 'claude')))
  for (const tool of ['bun', 'bunx', 'git', 'make']) {
    const w = sh(['which', tool], ROOT).out.trim()
    if (w && !existsSync(join(bin, tool))) symlinkSync(w, join(bin, tool))
  }
  const PATH = [bin, ...dirs].join(':')
  const env = { ...(process.env as Record<string, string>), PATH }
  expect(sh(['sh', '-c', 'command -v claude'], dir, env).code).not.toBe(0)
  const r = sh(['make', 'test'], dir, env)
  if (r.code !== 0) console.log(r.out.slice(-4000))
  expect(r.code).toBe(0)
  expect(sh(['git', 'status', '--porcelain'], dir).out.trim()).toBe('')
  // the command-line tests use the temp-project harness and its fake agent
  const harness = readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')
  expect(harness).toContain('mkdtempSync')
  expect(harness).toContain('fake-agent.ts')
  const build = readFileSync(join(dir, 'src/cli/build.test.ts'), 'utf8')
  expect(build).toContain('makeProject')
  expect(build).toMatch(/scriptAgent/)
  expect(build).toMatch(/edit/)
}, T)

test('61.4 coverage gate fails below 90% and passes again', () => {
  const dir = cloneHead()
  const victim = 'src/build/usage.test.ts'
  rmSync(join(dir, victim))
  const t = sh(['make', 'test'], dir)
  expect(t.code).toBe(0)
  const c = sh(['make', 'test-coverage'], dir)
  console.log(c.out.split('\n').filter((l) => /usage\.ts|gate|below|%/.test(l)).slice(-20).join('\n'))
  expect(c.code).not.toBe(0)
  const tail = c.out.slice(c.out.lastIndexOf('coverage/lcov.info') > 0 ? 0 : 0)
  expect(tail).toMatch(/src\/build\/usage\.ts[^\n]*\d+(\.\d+)?%/)
  expect(sh(['git', 'checkout', '--', victim], dir).code).toBe(0)
  const c2 = sh(['make', 'test-coverage'], dir)
  if (c2.code !== 0) console.log(c2.out.slice(-3000))
  expect(c2.code).toBe(0)
}, T)
