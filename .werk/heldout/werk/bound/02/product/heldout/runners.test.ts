import { afterAll, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { WERK_ROOT } from '../test/env.ts'

const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A copy of the werk repository as shipped, without the binder's own test directories. */
function copyRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-repo-')))
  made.push(dir)
  for (const part of readdirSync(WERK_ROOT)) {
    if (['node_modules', 'heldout', 'heldout-e2e', 'coverage', 'test-results'].includes(part)) continue
    cpSync(join(WERK_ROOT, part), join(dir, part), { recursive: true })
  }
  symlinkSync(join(WERK_ROOT, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

/** The parent environment, without the preload's PATH change and without WERK_ variables. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('WERK_')) env[k] = v
  env.PATH = (env.PATH ?? '').split(':').filter((p) => !p.includes('fake-agent')).join(':')
  delete env.CI
  return { ...env, CI: 'true', ...extra }
}

function run(cwd: string, cmd: string[], env = cleanEnv()) {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env, encoding: 'utf8', timeout: 300_000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// ---------- 01.3 ----------
test('01.3 bun test, then the coverage gate, then a pure file under 90%', () => {
  const repo = copyRepo()
  const t1 = run(repo, ['bun', 'test'])
  console.log('--- bun test (tail)\n' + t1.out.slice(-600))
  expect(t1.code).toBe(0)
  // The run includes server tests and React component tests.
  // bun prints only a summary when stdout is not a terminal, so compare its file count with the test files in the repo.
  const files = spawnSync('find', ['.', '-path', './node_modules', '-prune', '-o', '-name', '*.test.ts*', '-print'], { cwd: repo, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
  console.log('test files:', files)
  expect(t1.out).toContain(`across ${files.length} files`)
  expect(files.some((f) => f.startsWith('./src/server/') && f.endsWith('.test.ts'))).toBe(true)
  expect(files.some((f) => f.endsWith('.test.tsx'))).toBe(true)
  // Without a coverage check.
  expect(t1.out).not.toMatch(/% Lines|coverage gate|% Funcs/)

  const c1 = run(repo, ['bun', 'run', 'test:coverage'])
  console.log('--- coverage 1 (tail)\n' + c1.out.slice(-900))
  expect(c1.out).toMatch(/coverage gate passed/)
  expect(c1.code).toBe(0)

  // Remove tests so that a file on the pure-file list falls under 90%.
  rmSync(join(repo, 'src', 'args.test.ts'))
  const c2 = run(repo, ['bun', 'run', 'test:coverage'])
  console.log('--- coverage 2 (tail)\n' + c2.out.slice(-900))
  expect(c2.code).not.toBe(0)
  expect(c2.out).toMatch(/FAIL\s+src\/args\.ts/)

  const t2 = run(repo, ['bun', 'test'])
  console.log('--- bun test 2 (tail)\n' + t2.out.slice(-300))
  expect(t2.code).toBe(0)
  expect(t2.out).not.toMatch(/coverage gate failed|% Lines/)
}, 600_000)

// ---------- 01.4 ----------
function hashDir(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(relative(dir, p)).update(readFileSync(p))
    }
  }
  walk(dir)
  return h.digest('hex')
}

test('01.4 bun run e2e boots a real server on a fixture copy, saves one screenshot per test, and uses only the fake agent', async () => {
  const repo = copyRepo()
  const fixture = join(repo, 'e2e', 'fixtures', 'demo')
  const fixtureHash = hashDir(fixture)

  // No real agent can be reached: the only other `claude` on PATH is a trap that records each call.
  const trapDir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-trap-')))
  made.push(trapDir)
  const trapLog = join(trapDir, 'calls.log')
  writeFileSync(join(trapDir, 'claude'), `#!/bin/sh\necho "$@" >> '${trapLog}'\nexit 1\n`)
  chmodSync(join(trapDir, 'claude'), 0o755)
  const env = cleanEnv()
  env.PATH = `${trapDir}:${env.PATH}`

  const child = spawn('bun', ['run', 'e2e'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (b) => (out += b))
  child.stderr.on('data', (b) => (out += b))

  // While it runs, find the werk server process and its working directory.
  let serverCwd: string | undefined
  let serverCmd: string | undefined
  const done = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  let finished = false
  void done.then(() => (finished = true))
  while (!finished && serverCwd === undefined) {
    const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
    const line = ps.split('\n').find((l) => l.includes(join(repo, 'src', 'cli.ts')) && l.includes(' serve'))
    if (line) {
      const pid = line.trim().split(/\s+/)[0]!
      serverCmd = line.trim()
      const lsof = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout
      serverCwd = lsof.split('\n').find((l) => l.startsWith('n'))?.slice(1)
    }
    await Bun.sleep(100)
  }
  const code = await done
  console.log('--- e2e output\n' + out.slice(-2500))
  console.log('server:', serverCmd, 'cwd:', serverCwd)

  expect(code).toBe(0)
  // A real werk server on a copy of the fixture project.
  expect(serverCmd).toBeDefined()
  expect(serverCwd).toBeDefined()
  expect(realpathSync(fixture)).not.toBe(serverCwd)
  expect(serverCwd!.endsWith('/demo')).toBe(true)
  // The original fixture project stays unchanged.
  expect(hashDir(fixture)).toBe(fixtureHash)
  // One screenshot per test.
  const total = Number(out.match(/(\d+) passed/)?.[1] ?? 0) + Number(out.match(/(\d+) failed/)?.[1] ?? 0)
  const evidence = join(repo, 'e2e', 'evidence')
  const pngs = existsSync(evidence) ? readdirSync(evidence).filter((f) => f.endsWith('.png')) : []
  console.log('tests:', total, 'pngs:', pngs)
  expect(total).toBeGreaterThan(0)
  expect(pngs.length).toBe(total)
  // Each browser test opens the page that werk serves: every test body calls page.goto.
  for (const spec of readdirSync(join(repo, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))) {
    const text = readFileSync(join(repo, 'e2e', spec), 'utf8')
    const bodies = text.split(/\ntest\(/).slice(1)
    for (const body of bodies) expect(body).toContain('page.goto(')
  }
  // Every agent call went to the fake agent: the trap was never called.
  expect(existsSync(trapLog)).toBe(false)
}, 600_000)
