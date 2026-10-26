import { afterAll, afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeBrowser, makeProject, openPage, startServe, testEnv, WERK, type RunningServer, type TempProject } from './lib.ts'
import { FAKE_AGENT_DIR } from '../werk/test/env.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
let copy: string | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  if (copy) rmSync(copy, { recursive: true, force: true })
  server = undefined
  project = undefined
  copy = undefined
})
afterAll(closeBrowser)

/** A copy of the werk product, so a test can edit or delete its files. */
function copyWerk(parts = ['src', 'test', 'tools', 'e2e', 'package.json', 'tsconfig.json', 'bunfig.toml', 'playwright.config.ts']): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'werk-heldout-copy-')))
  for (const part of parts) cpSync(join(WERK, part), join(dir, part), { recursive: true })
  symlinkSync(join(WERK, 'node_modules'), join(dir, 'node_modules'))
  return dir
}
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const run = (cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, CI: 'true', ...env }, encoding: 'utf8', maxBuffer: 64 << 20 })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

test('01.1 a user starts werk in a project and sees the empty map shell', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const printed = server.output().match(/http:\/\/localhost:\d+/)![0]
  const { page, errors } = await openPage(printed)
  await page.getByRole('main', { name: 'map' }).waitFor({ timeout: 15_000 })
  const reactRoot = await page.evaluate(() => {
    const root = document.getElementById('root')!
    return { keys: Object.keys(root).filter((k) => k.startsWith('__react')), children: root.childElementCount }
  })
  expect(reactRoot.keys.length).toBeGreaterThan(0)
  expect(reactRoot.children).toBeGreaterThan(0)
  const detail = (await page.getByRole('region', { name: 'card detail' }).textContent()) ?? ''
  console.log(`01.1 page: "${detail}", react keys ${reactRoot.keys.join(',')}`)
  expect(detail).toContain('The map has no cards yet.')
  expect(await page.getByRole('region', { name: 'sub-cards' }).count()).toBe(0)
  expect(await page.getByRole('alert').count()).toBe(0)
  expect(errors).toEqual([])
  await page.close()
  console.log(`01.1 server output: ${JSON.stringify(server.output())}`)
  expect(server.output()).not.toMatch(/error/i)
}, 60_000)

test('01.2 an agent edits a server module while a live session runs, and the session survives', async () => {
  copy = copyWerk()
  project = makeProject()
  const calls = join(project.dir, 'calls.jsonl')
  server = await startServe(project.dir, { hot: true, entry: join(copy, 'src', 'cli.ts'), env: { WERK_FAKE_CALLS: calls } })
  const notedPid = Number(server.output().match(/\(pid (\d+)\)/)![1])
  // A chat session started before the edit: its agent child is long-lived.
  const res = await fetch(`http://localhost:${server.port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) })
  expect(res.status).toBe(200)
  const agentPid = ((await res.json()) as { pid: number }).pid
  await Bun.sleep(500)
  expect(isAlive(agentPid)).toBe(true)
  const { page } = await openPage(`http://localhost:${server.port}/`)
  const hello = () =>
    page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const s = new EventSource('/api/live')
          s.addEventListener('hello', (e) => {
            s.close()
            resolve(JSON.parse((e as MessageEvent).data))
          })
        }),
    )
  const before = await hello()

  appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an agent edit\n')
  await server.waitFor(/werk: reloaded [^\n]*src\/server\/app\.ts/)
  await server.waitFor(/reusing the live server on port \d+ \(pid \d+\); not listening again/)
  const health = (await (await fetch(`http://localhost:${server.port}/api/health`)).json()) as { pid: number }
  expect(health.pid).toBe(notedPid)
  expect(server.process.pid).toBe(notedPid)
  expect(isAlive(agentPid)).toBe(true)
  const after = await hello()
  console.log(`01.2 hello before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
  expect(after).toEqual(before)
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1)
  expect((after as { children: unknown[] }).children).toHaveLength(1)
  await page.close()
}, 90_000)

test('01.3 the agent runs the unit tests and then the coverage gate', () => {
  copy = copyWerk()
  const unit = run(copy, 'bun', ['test'])
  console.log(`01.3 bun test exit ${unit.code}; tail: ${unit.out.trim().split('\n').slice(-4).join(' / ')}`)
  expect(unit.code).toBe(0)
  // bun test prints no file names when every test passes and no TTY is attached. The run's
  // file count is checked against the test files bun discovers, and a JUnit report of the
  // same run names each file.
  const files = (readdirSync(copy, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => !f.startsWith('node_modules') && /\.test\.tsx?$/.test(f))
  expect(unit.out).toContain(`across ${files.length} files`)
  const junit = join(copy, 'junit.xml')
  run(copy, 'bun', ['test', '--reporter=junit', `--reporter-outfile=${junit}`])
  const report = readFileSync(junit, 'utf8')
  console.log(`01.3 files run: ${files.join(', ')}`)
  expect(report).toMatch(/src\/server\/\w+\.test\.ts/)
  expect(report).toMatch(/src\/client\/\w+\.test\.tsx/)
  expect(unit.out).not.toMatch(/coverage/i)
  expect(unit.out).not.toMatch(/% Lines/)

  const gate = run(copy, 'bun', ['run', 'test:coverage'])
  console.log(`01.3 test:coverage exit ${gate.code}; gate: ${gate.out.trim().split('\n').slice(-2).join(' / ')}`)
  expect(gate.code).toBe(0)

  // Remove the tests of one pure file, so that it falls under 90%.
  unlinkSync(join(copy, 'src', 'map', 'contract.test.ts'))
  const low = run(copy, 'bun', ['run', 'test:coverage'])
  const failLine = low.out.split('\n').find((l) => l.includes('src/map/contract.ts') && l.startsWith('FAIL'))
  console.log(`01.3 after removal: exit ${low.code}; ${failLine}; ${low.out.trim().split('\n').at(-1)}`)
  expect(low.code).not.toBe(0)
  expect(failLine).toBeDefined()
  const again = run(copy, 'bun', ['test'])
  expect(again.code).toBe(0)
  expect(again.out).not.toMatch(/coverage/i)
}, 300_000)

test('01.4 the agent runs the browser tests and gets screenshot evidence without a real agent', () => {
  copy = copyWerk()
  const fixture = join(copy, 'e2e', 'fixtures', 'demo')
  const digest = (dir: string) => {
    const h = createHash('sha256')
    const walk = (d: string) => {
      for (const name of readdirSync(d).sort()) {
        const p = join(d, name)
        if (statSync(p).isDirectory()) walk(p)
        else h.update(p).update(readFileSync(p))
      }
    }
    walk(dir)
    return h.digest('hex')
  }
  const before = digest(fixture)
  // A real-agent decoy on PATH: it records any call. No test may reach it.
  const decoyDir = mkdtempSync(join(tmpdir(), 'werk-decoy-'))
  const decoyLog = join(decoyDir, 'called')
  writeFileSync(join(decoyDir, 'claude'), `#!/bin/sh\necho "$@" >> ${decoyLog}\nexit 1\n`, { mode: 0o755 })
  const e2e = run(copy, 'bun', ['run', 'e2e'], { PATH: `${decoyDir}:${process.env.PATH}`, DEBUG: 'pw:webserver', WERK_E2E_PORT: '4977' })
  const out = e2e.out
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed = Number(out.match(/(\d+) failed/)?.[1] ?? 0)
  const evidence = existsSync(join(copy, 'e2e', 'evidence')) ? readdirSync(join(copy, 'e2e', 'evidence')).filter((f) => f.endsWith('.png')) : []
  console.log(`01.4 e2e exit ${e2e.code}; passed ${passed} failed ${failed}; evidence ${evidence.length}; serving line: ${out.match(/werk: serving [^\n]*/)?.[0]}`)
  expect(e2e.code).toBe(0)
  expect(out).toMatch(/werk: serving \S*werk-e2e-4977\/demo at http:\/\/localhost:4977/)
  expect(digest(fixture)).toBe(before)
  expect(evidence.length).toBe(passed + failed)
  expect(existsSync(decoyLog)).toBe(false)
  rmSync(decoyDir, { recursive: true, force: true })
}, 300_000)

let lastDir: string | undefined
test('01.5 a command-line test runs a werk command against a temporary project', () => {
  project = makeProject()
  lastDir = project.dir
  expect(existsSync(join(project.dir, '.git'))).toBe(true)
  expect(project.git(['rev-parse', 'HEAD']).code).toBe(0)
  const r = project.run(['add', 'a', '--title', 'Use a log'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('added #a')
  const bad = project.run(['decide', 'missing'])
  expect(bad.code).toBe(1)
  expect(bad.stderr).toContain('no card #missing')
  // Any agent the command calls: `claude` on the command's PATH is the fake agent.
  const which = project.run(['help'], {})
  expect(which.code).toBe(0)
  expect(Bun.which('claude', { PATH: testEnv().PATH })).toBe(join(FAKE_AGENT_DIR, 'claude'))
  mkdirSync(join(project.dir, 'probe'), { recursive: true })
})
test('01.5 (after) the temporary project is gone after the test ends', () => {
  expect(lastDir).toBeDefined()
  expect(existsSync(lastDir!)).toBe(false)
})
