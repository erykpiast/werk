/**
 * Held-out steps 61.1-61.4, 95.1-95.5, 96.1-96.5: the repository shape, the help verb, the
 * coverage gate, the test harness and the fake agent. A step that needs a fresh clone, a new
 * module or deleted tests works in a clone in a temporary folder, never in this checkout.
 */
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fold } from '../src/map/fold.ts'
import { makeProject } from '../src/test/harness.ts'

const ROOT = join(import.meta.dir, '..')
const BUN = process.execPath
const LONG = 900_000
// The preload gives the test run a fresh home. Playwright's browsers and bun's cache live in the person's home.
const REAL_HOME = dirname(dirname(dirname(BUN)))

type Out = { code: number; out: string }
const sh = (cmd: string[], cwd: string, env: Record<string, string | undefined> = { ...process.env, HOME: REAL_HOME }): Out => {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}
const HEAD = sh(['git', 'rev-parse', 'HEAD'], ROOT).out.trim()

/** A clone of this checkout at its HEAD, in a temporary folder that the caller removes. */
function cloneHere(): { dir: string; done: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'heldout-clone-'))
  const dir = join(realpathSync(tmp), 'werk')
  const c = sh(['git', 'clone', '--quiet', '--no-local', ROOT, dir], tmp)
  if (c.code !== 0) throw new Error(`binder: clone failed: ${c.out}`)
  sh(['git', 'checkout', '--quiet', HEAD], dir)
  return { dir, done: () => rmSync(tmp, { recursive: true, force: true }) }
}

/** A PATH with bun, make and git, and no `claude` in any folder of it. */
function pathWithoutClaude(): string {
  const bin = mkdtempSync(join(tmpdir(), 'heldout-bin-'))
  symlinkSync(BUN, join(bin, 'bun'))
  symlinkSync(BUN, join(bin, 'bunx'))
  const dirs = [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  for (const d of dirs) if (existsSync(join(d, 'claude'))) throw new Error(`binder: ${d} holds claude`)
  return dirs.join(':')
}

const lines = (text: string) => text.split('\n').filter(Boolean)
const titlesOf = (log: string) => [...fold(lines(log).map((l) => JSON.parse(l))).nodes.values()].map((n) => (n as { title?: string }).title)

// 61.1
test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const c = cloneHere()
    try {
      const roots = lines(sh(['git', 'rev-list', '--max-parents=0', 'origin/main'], c.dir).out)
      expect(roots).toHaveLength(1)
      const first = roots[0]!
      expect(sh(['git', 'ls-tree', '-r', '--name-only', first], c.dir).out.trim()).toBe('')
      for (const commit of lines(sh(['git', 'rev-list', 'origin/main'], c.dir).out)) {
        expect(sh(['git', 'merge-base', '--is-ancestor', first, commit], c.dir).code).toBe(0)
      }
      for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
        const r = sh(['make', target], c.dir)
        if (r.code !== 0) console.error(`make ${target} failed:\n${r.out.slice(-3000)}`)
        expect({ target, code: r.code }).toEqual({ target, code: 0 })
      }
    } finally {
      c.done()
    }
  },
  LONG,
)

// 61.2
test(
  '61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit',
  () => {
    const c = cloneHere()
    try {
      expect(sh([BUN, 'install', '--frozen-lockfile'], c.dir).code).toBe(0)
      const before = sh([BUN, 'src/cli/main.ts', 'help'], c.dir)
      expect(before.code).toBe(0)
      const verbFiles = readdirSync(join(c.dir, 'src/cli/verbs')).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      const registered = verbFiles.map((f) => {
        const m = readFileSync(join(c.dir, 'src/cli/verbs', f), 'utf8').match(/name: '([a-z][a-z0-9-]*)'/)
        return m?.[1]
      })
      const named = (out: string) => lines(out).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0])
      const beforeNames = named(before.out)
      for (const v of registered) expect(beforeNames).toContain(v!)
      expect(beforeNames).toContain('help')

      writeFileSync(
        join(c.dir, 'src/cli/verbs/ping.ts'),
        "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
      )
      const after = sh([BUN, 'src/cli/main.ts', 'help'], c.dir)
      expect(after.code).toBe(0)
      const afterNames = named(after.out)
      expect(afterNames).toContain('ping')
      for (const v of beforeNames) expect(afterNames).toContain(v)
      expect(sh(['git', 'status', '--porcelain'], c.dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
    } finally {
      c.done()
    }
  },
  LONG,
)

// 61.3
test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const c = cloneHere()
    try {
      const env = { ...process.env, HOME: REAL_HOME, PATH: pathWithoutClaude() }
      expect(sh(['sh', '-c', 'command -v claude'], c.dir, env).code).not.toBe(0)
      // The tests that run the command line with the fake agent's events and file edit.
      const harnessTest = readFileSync(join(c.dir, 'src/test/harness.test.ts'), 'utf8')
      expect(harnessTest).toMatch(/edit/)
      const r = sh(['make', 'test'], c.dir, env)
      if (r.code !== 0) console.error(r.out.slice(-4000))
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/src\/test\/harness\.test\.ts|harness\.test\.ts/)
      expect(sh(['git', 'status', '--porcelain'], c.dir).out.trim()).toBe('')
    } finally {
      c.done()
    }
  },
  LONG,
)

// 61.4
test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const c = cloneHere()
    try {
      expect(sh(['make', 'test-coverage'], c.dir).code).toBe(0)
      // Delete every test of src/coverage/gate.test.ts but the first.
      const file = join(c.dir, 'src/coverage/gate.test.ts')
      const text = readFileSync(file, 'utf8')
      const second = text.indexOf("\ntest('a listed file at 90% passes")
      expect(second).toBeGreaterThan(0)
      writeFileSync(file, text.slice(0, second) + '\n')
      const test1 = sh(['make', 'test'], c.dir)
      expect(test1.code).toBe(0)
      const cov = sh(['make', 'test-coverage'], c.dir)
      expect(cov.code).not.toBe(0)
      const line = lines(cov.out).find((l) => l.includes('src/coverage/gate.ts') && l.includes('FAIL'))
      expect(line).toBeDefined()
      expect(line!).toMatch(/\d+\.\d%/)
      sh(['git', 'checkout', '--', 'src/coverage/gate.test.ts'], c.dir)
      expect(sh(['make', 'test-coverage'], c.dir).code).toBe(0)
    } finally {
      c.done()
    }
  },
  LONG,
)

// 95.1
test(
  '95.1 two tests that each write a card see only their own card',
  () => {
    const out = join(makeProject().dir, 'out.jsonl')
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/fixtures/two-cards.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, HELDOUT_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const report = r.stderr.toString()
    const used = lines(readFileSync(out, 'utf8')).map((l) => JSON.parse(l) as { test: number; dir: string; log: string; gitTop: string })
    expect(used).toHaveLength(2)
    const [a, b] = [used.find((u) => u.test === 1)!, used.find((u) => u.test === 2)!]
    expect(titlesOf(a.log)).toEqual(['Alpha'])
    expect(titlesOf(b.log)).toEqual(['Beta'])
    expect(a.gitTop).not.toBe(b.gitTop)
    expect(a.gitTop.endsWith('/project')).toBe(true)
    expect(b.gitTop.endsWith('/project')).toBe(true)
    expect(report).toContain('1 pass')
    expect(report).toContain('1 fail')
    expect(existsSync(a.dir)).toBe(false)
    expect(existsSync(b.dir)).toBe(false)
  },
  60_000,
)

// 95.2
test(
  "95.2 a server test's server stops when the test ends",
  async () => {
    const out = join(makeProject().dir, 'out.jsonl')
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/fixtures/server.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, HELDOUT_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(r.exitCode).toBe(0)
    const used = JSON.parse(readFileSync(out, 'utf8').trim()) as { url: string; dir: string; nodes: number }
    expect(used.nodes).toBe(0)
    let answered = true
    try {
      await fetch(`${used.url}api/graph`, { signal: AbortSignal.timeout(3000) })
    } catch {
      answered = false
    }
    expect(answered).toBe(false)
    expect(existsSync(used.dir)).toBe(false)
  },
  60_000,
)

// 95.3
test(
  '95.3 a real project setting and a real agent never reach a test',
  () => {
    const real = makeProject()
    expect(real.werk(['add', 'mine', '--title', 'My card']).code).toBe(0)
    const realLog = join(real.dir, '.werk', 'log.jsonl')
    const before = readFileSync(realLog, 'utf8')
    const realBin = join(dirname(real.dir), 'real-bin')
    mkdirSync(realBin)
    writeFileSync(join(realBin, 'claude'), '#!/bin/sh\necho \'{"type":"real-reply"}\'\n')
    chmodSync(join(realBin, 'claude'), 0o755)
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/fixtures/env.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, WERK_LOG: realLog, PATH: `${realBin}:${process.env.PATH}` },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const report = r.stderr.toString()
    if (r.exitCode !== 0) console.error(report)
    expect(report).toContain('2 pass')
    expect(r.exitCode).toBe(0)
    expect(readFileSync(realLog, 'utf8')).toBe(before)
  },
  60_000,
)

// 95.4
test(
  '95.4 the browser test server refuses to start when the fake agent is not first',
  () => {
    const realBin = mkdtempSync(join(tmpdir(), 'heldout-real-'))
    writeFileSync(join(realBin, 'claude'), '#!/bin/sh\necho real\n')
    chmodSync(join(realBin, 'claude'), 0o755)
    const outDir = join(ROOT, '.werk-heldout', 'test-results', 'g-infra-95-4')
    try {
      const r = sh(
        [BUN, 'x', 'playwright', 'test', 'e2e/map.spec.ts', '--output', outDir],
        ROOT,
        { ...process.env, HOME: REAL_HOME, CI: 'true', PATH: `${realBin}:${process.env.PATH}` },
      )
      console.error(`95.4 playwright exit ${r.code}\n${r.out.slice(-800)}`)
      expect(r.code).not.toBe(0)
      expect(r.out).toMatch(/fake agent/)
      expect(r.out).toMatch(/PATH/)
      expect(r.out).not.toMatch(/✓/)
      expect(r.out).not.toMatch(/\d+ passed/)
    } finally {
      rmSync(realBin, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  },
  LONG,
)

// 95.5
test(
  '95.5 a fresh clone passes its checks with no manual step',
  () => {
    const c = cloneHere()
    try {
      expect(existsSync(join(c.dir, 'node_modules'))).toBe(false)
      const r = sh(['make', 'test'], c.dir)
      if (r.code !== 0) console.error(r.out.slice(-4000))
      expect(r.out).toMatch(/bun install --frozen-lockfile/)
      expect(r.out.indexOf('bun install')).toBeLessThan(r.out.indexOf('bun run test') === -1 ? r.out.indexOf('bun test') : r.out.indexOf('bun run test'))
      expect(r.out).toContain(`cd ${c.dir}`)
      expect(existsSync(join(c.dir, 'node_modules'))).toBe(true)
      expect(r.code).toBe(0)
    } finally {
      c.done()
    }
  },
  LONG,
)

// 96.1
test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { name: 'first' } }, { edit: { path: 'notes/plan.md', content: '# Plan\n' } }, { event: { name: 'second' } }], exit: 0 })
  const target = join(p.dir, 'notes/plan.md')
  const agent = Bun.spawn(['claude'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const seen: { line: string; exists: boolean; content: string | null }[] = []
  let rest = ''
  for await (const chunk of agent.stdout) {
    const parts = (rest + new TextDecoder().decode(chunk)).split('\n')
    rest = parts.pop()!
    for (const line of parts) {
      const exists = existsSync(target)
      seen.push({ line, exists, content: exists ? readFileSync(target, 'utf8') : null })
    }
  }
  expect(await agent.exited).toBe(0)
  expect(rest).toBe('')
  expect(seen.map((s) => JSON.parse(s.line))).toEqual([{ name: 'first' }, { name: 'second' }])
  expect(seen[0]!.exists).toBe(false)
  expect(seen[1]!.exists).toBe(true)
  expect(seen[1]!.content).toBe('# Plan\n')
})

// 96.2
test('96.2 the fake agent exits with the exit code of its script after the last step', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { n: 1 } }, { event: { n: 2 } }], exit: 3 })
  const r = p.run(['claude'])
  expect(r.code).toBe(3)
  expect(r.stdout).toBe('{"n":1}\n{"n":2}\n')
})

// 96.3
test('96.3 an edit that leads outside the project fails and writes nothing there', () => {
  const p = makeProject()
  const parent = dirname(p.dir)
  // The harness keeps its own launch record beside the project; the fake agent appends to it on each launch.
  const harnessFiles = new Set(['agent-launches.jsonl', 'agent-input.jsonl'])
  const snapshot = () =>
    readdirSync(parent)
      .filter((f) => f !== 'project' && !harnessFiles.has(f))
      .map((f) => [f, statSync(join(parent, f)).mtimeMs])
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out' } }], exit: 0 })
  const before = snapshot()
  const r = p.run(['claude'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/escaped\.txt/)
  expect(r.stderr).toMatch(/outside the project/)
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  expect(snapshot()).toEqual(before)
})

// 96.4
test('96.4 two launches are recorded in order with their arguments', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'ok' } }], exit: 0 })
  expect(p.run(['claude', '-p', 'first request']).code).toBe(0)
  expect(p.run(['claude', '-p', 'second request']).code).toBe(0)
  const launches = p.agentLaunches()
  expect(launches).toHaveLength(2)
  expect(launches[0]).toContain('first request')
  expect(launches[1]).toContain('second request')
})

// 96.5
test('96.5 the fake agent refuses to run when no script is installed', () => {
  const p = makeProject()
  const r = p.run(['claude', '-p', 'x'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/no script is installed/)
  expect(r.stdout).toBe('')
})
