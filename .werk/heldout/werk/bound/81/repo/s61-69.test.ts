/** Held-out repository paths: each test works in its own fresh clone of this checkout. */
import { afterEach, expect, test } from 'bun:test'
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = join(import.meta.dir, '..', '..')
const LONG = 900_000
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type R = { code: number; out: string }

const run = (cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): R => {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

/** A person clones the werk repository. The checkout's HEAD is the main branch of the product. */
function cloneWerk(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  dirs.push(root)
  const dir = join(root, 'werk')
  const head = run(SOURCE, ['git', 'rev-parse', 'HEAD']).out.trim()
  expect(run(root, ['git', 'clone', '--quiet', '--no-local', SOURCE, dir]).code).toBe(0)
  expect(run(dir, ['git', 'checkout', '--quiet', '-B', 'main', head]).code).toBe(0)
  return dir
}

const install = (dir: string) => expect(run(dir, ['bun', 'install', '--frozen-lockfile']).code).toBe(0)
const status = (dir: string) => run(dir, ['git', 'status', '--porcelain', '--untracked-files=all']).out

test(
  '61.1',
  () => {
    const dir = cloneWerk()
    const first = run(dir, ['git', 'rev-list', '--max-parents=0', 'main']).out.trim().split('\n')
    expect(first.length).toBe(1)
    expect(run(dir, ['git', 'ls-tree', '-r', '--name-only', first[0]!]).out).toBe('')
    const all = run(dir, ['git', 'rev-list', 'main']).out.trim().split('\n')
    for (const c of all) expect(run(dir, ['git', 'merge-base', '--is-ancestor', first[0]!, c]).code).toBe(0)

    install(dir)
    const results: Record<string, number> = {}
    let e2eOut = ''
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = run(dir, ['make', target])
      results[target] = r.code
      if (r.code !== 0) console.log(`make ${target} output:\n${r.out.slice(-3000)}`)
      if (target === 'e2e') e2eOut = r.out
    }
    console.log('make e2e tail:\n' + e2eOut.slice(-600))
    expect(results).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })
  },
  LONG,
)

test(
  '61.2',
  () => {
    const dir = cloneWerk()
    install(dir)
    const before = status(dir)
    const help1 = run(dir, ['bun', 'src/cli/main.ts', 'help'])
    expect(help1.code).toBe(0)
    const names = (text: string) => [...text.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]!)
    const verbs1 = names(help1.out)
    // The verbs that the command line registers: one module per verb in the verbs folder.
    const registered = readdirSync(join(dir, 'src', 'cli', 'verbs'))
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .map((f) => f.replace(/\.ts$/, ''))
    expect(verbs1.toSorted()).toEqual(registered.toSorted())
    expect(verbs1).toContain('help')

    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
    )
    const help2 = run(dir, ['bun', 'src/cli/main.ts', 'help'])
    expect(help2.code).toBe(0)
    const verbs2 = names(help2.out)
    expect(verbs2).toContain('ping')
    for (const v of verbs1) expect(verbs2).toContain(v)
    expect(before).toBe('')
    expect(status(dir)).toBe('?? src/cli/verbs/ping.ts\n')
  },
  LONG,
)

/** The PATH of the person's shell, with every folder that holds a `claude` program removed. */
function pathWithoutClaude(): string {
  return (process.env.PATH ?? '')
    .split(':')
    .filter((d) => {
      try {
        accessSync(join(d, 'claude'), constants.X_OK)
        return false
      } catch {
        return true
      }
    })
    .join(':')
}

test(
  '61.3',
  () => {
    const dir = cloneWerk()
    install(dir)
    const env = { ...process.env, PATH: pathWithoutClaude() }
    expect(run(dir, ['/bin/sh', '-c', 'command -v claude'], env).code).not.toBe(0)
    const before = status(dir)
    const r = run(dir, ['make', 'test'], env)
    if (r.code !== 0) console.log(r.out.slice(-3000))
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\b0 fail\b/)
    // The harness test that reads the fake agent's scripted events and file edit ran and passed.
    expect(r.out).not.toMatch(/\(fail\).*fake agent/)
    expect(r.out).toMatch(/src\/test\/harness\.test\.ts/)
    expect(before).toBe('')
    expect(status(dir)).toBe('')
  },
  LONG,
)

test(
  '61.4',
  () => {
    const dir = cloneWerk()
    install(dir)
    expect(run(dir, ['make', 'test-coverage']).code).toBe(0)
    // src/ticket/spec.ts is on the pure-file list, and only its own unit tests load it.
    rmSync(join(dir, 'src', 'ticket', 'spec.test.ts'))
    const t = run(dir, ['make', 'test'])
    expect(t.code).toBe(0)
    const c = run(dir, ['make', 'test-coverage'])
    console.log(c.out.split('\n').filter((l) => /spec\.ts|coverage gate/.test(l)).join('\n'))
    expect(c.code).not.toBe(0)
    expect(c.out).toMatch(/FAIL\s+\d+(\.\d+)?%\s+src\/ticket\/spec\.ts/)
    expect(run(dir, ['git', 'checkout', '--', 'src/ticket/spec.test.ts']).code).toBe(0)
    expect(run(dir, ['make', 'test-coverage']).code).toBe(0)
  },
  LONG,
)

test(
  '69.5',
  () => {
    const dir = cloneWerk()
    install(dir)
    const r = run(dir, ['make', 'e2e'])
    console.log(r.out.slice(-1500))
    const passed = Number(/(\d+) passed/.exec(r.out)?.[1] ?? 0)
    const failed = Number(/(\d+) failed/.exec(r.out)?.[1] ?? 0)
    const ran = passed + failed
    expect(ran).toBeGreaterThan(0)
    // One result line per test, with a pass or fail mark.
    const resultLines = r.out.split('\n').filter((l) => /^\s*[✓✘]\s+\d+ \[chromium\] › e2e\/\S+\.spec\.ts/.test(l))
    expect(resultLines.length).toBe(ran)
    // One screenshot per test that ran.
    const shots: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (e.name.endsWith('.png')) shots.push(join(d, e.name))
      }
    }
    if (existsSync(join(dir, 'test-results'))) walk(join(dir, 'test-results'))
    expect(shots.length).toBe(ran)
    // The project the person works in: no log of its own appears, and the fixture log is unchanged.
    expect(existsSync(join(dir, '.werk'))).toBe(false)
    expect(status(dir)).toBe('')
  },
  LONG,
)
