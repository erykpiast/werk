/** Held-out steps 95.x. */
import { expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { makeProject } from '../src/test/harness.ts'

const ROOT = join(import.meta.dir, '..')
const BUN = process.execPath
const lines = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)

/** A folder whose `claude` stands in for the real agent: it prints REAL and writes a marker. */
function realAgentBin(root: string): string {
  const bin = join(root, 'real-bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${JSON.stringify(join(root, 'real-agent-ran'))}\necho REAL\n`, { mode: 0o755 })
  return bin
}

test(
  '95.1 Two tests that each write a card see only their own card',
  () => {
    // Given two command-line tests in one run, each asks the harness for a project, adds Alpha / Beta;
    // the first test is made to fail after it adds its card
    const out = join(makeProject().dir, 'h95-1.jsonl')
    // When the test writer runs the unit tests
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/h95-fixtures/two-cards.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, H95_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const report = r.stdout.toString() + r.stderr.toString()
    const seen = lines<{ test: string; dir: string; titles: string[]; git: boolean; top: string }>(out)
    const first = seen.find((s) => s.test === 'first')!
    const second = seen.find((s) => s.test === 'second')!
    // Then the first test's map shows only the card "Alpha"
    expect(first.titles).toEqual(['Alpha'])
    // And the second test's map shows only the card "Beta"
    expect(second.titles).toEqual(['Beta'])
    // And each project directory has its own git repository
    expect(first.git && second.git).toBe(true)
    expect(first.dir).not.toBe(second.dir)
    expect(first.top.endsWith('/project')).toBe(true)
    expect(second.top.endsWith('/project')).toBe(true)
    // And the run reports one failed test and one passed test
    expect(report).toContain('1 pass')
    expect(report).toContain('1 fail')
    expect(r.exitCode).not.toBe(0)
    // And neither project directory exists after the run ends
    expect(existsSync(first.dir)).toBe(false)
    expect(existsSync(second.dir)).toBe(false)
  },
  60_000,
)

test(
  '95.2 A server test\'s server stops when the test ends',
  async () => {
    // Given a server test that asks the harness for a project, starts a server and sees an empty map
    const out = join(makeProject().dir, 'h95-2.jsonl')
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/h95-fixtures/server.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, H95_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(r.stderr.toString()).toContain('1 pass')
    const [seen] = lines<{ url: string; dir: string; graph: { nodes: unknown[] } }>(out)
    expect(seen!.graph.nodes).toEqual([])
    // When the test ends: Then a new request to that port gets no answer
    let answered = true
    try {
      await fetch(new URL('api/graph', seen!.url), { signal: AbortSignal.timeout(3000) })
    } catch {
      answered = false
    }
    expect(answered).toBe(false)
    // And the project directory no longer exists
    expect(existsSync(seen!.dir)).toBe(false)
  },
  60_000,
)

test(
  '95.3 A real project setting and a real agent never reach a test',
  () => {
    const p = makeProject()
    // Given a setting in the shell that points at the map the person works in
    const realMap = join(p.dir, 'real', '.werk', 'log.jsonl')
    mkdirSync(join(p.dir, 'real', '.werk'), { recursive: true })
    const event = '{"seq":1,"at":"2026-01-01T00:00:00.000Z","actor":"agent","type":"node.proposed","payload":{"id":"x","kind":"card","title":"X"}}\n'
    writeFileSync(realMap, event)
    // And the real agent program is on the program search list (first)
    const realBin = realAgentBin(p.dir)
    // When the person runs the unit tests from that shell
    const r = Bun.spawnSync([BUN, 'test', './.werk-heldout/h95-fixtures/env.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${realBin}:${process.env.PATH}`, WERK_LOG: realMap },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const report = r.stderr.toString()
    // Then the first test finds no project setting; And the second test gets the fake agent's reply
    expect(report).toContain('2 pass')
    expect(report).toContain('0 fail')
    expect(existsSync(join(p.dir, 'real-agent-ran'))).toBe(false)
    // And the map the person works in has no new events after the run
    expect(readFileSync(realMap, 'utf8')).toBe(event)
  },
  60_000,
)

test(
  '95.4 The browser test server refuses to start when the fake agent is not first',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'h95-4-'))
    try {
      // Given a person puts the real agent's directory first in the program search list
      const realBin = realAgentBin(root)
      // When the person starts the browser tests
      const r = Bun.spawnSync(['bunx', 'playwright', 'test', '.werk-heldout/h95.spec.ts', '--output', join(root, 'results')], {
        cwd: ROOT,
        env: { ...process.env, HOME: userInfo().homedir, CI: 'true', PATH: `${realBin}:${process.env.PATH}` },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const out = r.stdout.toString() + r.stderr.toString()
      console.log(out.slice(-3000))
      // Then the browser test server exits with a non-zero code
      expect(r.exitCode).not.toBe(0)
      // And the message names the fake agent and the program search list as the cause
      expect(out).toMatch(/fake agent/)
      expect(out).toMatch(/PATH/)
      // And no browser test runs
      expect(out).not.toMatch(/\d+ passed/)
      expect(existsSync(join(root, 'real-agent-ran'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  180_000,
)

test(
  '95.5 A fresh clone passes its checks with no manual step',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'h95-5-'))
    try {
      // Given a person makes a fresh clone of the repository
      const dir = join(realpathSync(root), 'werk')
      const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim()
      expect(Bun.spawnSync(['git', 'clone', '--quiet', ROOT, dir]).exitCode).toBe(0)
      expect(Bun.spawnSync(['git', 'checkout', '--quiet', head], { cwd: dir }).exitCode).toBe(0)
      // And v0's directory has no installed packages
      expect(existsSync(join(dir, 'node_modules'))).toBe(false)
      // When the person runs `make test`
      const r = Bun.spawnSync(['make', 'test'], {
        cwd: dir,
        env: { ...process.env, HOME: userInfo().homedir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const out = r.stdout.toString() + r.stderr.toString()
      appendFileSync('/dev/null', '')
      // Then the run installs the locked packages first
      const install = out.indexOf('bun install --frozen-lockfile')
      const tests = out.indexOf('bun run test')
      expect(install).toBeGreaterThanOrEqual(0)
      expect(tests).toBeGreaterThan(install)
      expect(existsSync(join(dir, 'node_modules', '.installed'))).toBe(true)
      // And the tests run inside v0's own directory
      expect(out).toContain(`cd ${dir} && CI=true bun run test`)
      // And the run passes
      if (r.exitCode !== 0) console.error(out.slice(-5000))
      expect(r.exitCode).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  30 * 60_000,
)
