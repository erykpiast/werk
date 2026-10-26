// 01.2 .. 01.5 — the infrastructure steps, against werk v0 (v0/ in the repository).
// Each step runs in its own copy of the repository (git HEAD) so the checkout stays unchanged.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { copyRepo } from './infra-copy.ts'

const copies: string[] = []
afterAll(() => {
  for (const c of copies) rmSync(c, { recursive: true, force: true })
})

/** The environment a user's shell has: no WERK_ variables, and none of this test runner's fake bins. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('WERK_') && !k.startsWith('FAKE_')) env[k] = v
  env.PATH = (env.PATH ?? '').split(':').filter((p) => p && !p.includes('werk-test-')).join(':')
  return { ...env, ...extra }
}

/** Reads SSE events from the live channel. */
async function openLive(url: string) {
  const ctl = new AbortController()
  const res = await fetch(url, { signal: ctl.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  return {
    async next(name: string, ms = 5000): Promise<any> {
      const until = Date.now() + ms
      for (;;) {
        while (!buf.includes('\n\n')) {
          const left = until - Date.now()
          if (left <= 0) throw new Error(`no ${name} event`)
          const r = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no ${name} event`)), left))])
          if (r.done) throw new Error('live channel closed')
          buf += dec.decode(r.value, { stream: true })
        }
        const end = buf.indexOf('\n\n')
        const block = buf.slice(0, end)
        buf = buf.slice(end + 2)
        const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7) ?? 'message'
        const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
        if (ev === name) return JSON.parse(data)
      }
    },
    close: () => ctl.abort(),
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const childrenOf = (pid: number) =>
  spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && Number(m[2]) === pid)
    .map((m) => ({ pid: Number(m[1]), command: m[3] }))

describe('01.2 dev command: a server-module edit keeps the live process and the agent child', () => {
  test('edit src/server/app.ts while a chat agent child runs', async () => {
    const { root, v0 } = copyRepo()
    copies.push(root)
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'werk-ho-dev-')))
    copies.push(project)
    const calls = join(project, 'agent-calls.jsonl')
    const port = 5210
    const env = cleanEnv({ PATH: `${join(v0, 'test', 'fake-agent')}:${cleanEnv().PATH}`, WERK_FAKE_CALLS: calls })
    // The dev command, from the project directory (README: `bun --hot /path/to/v0/src/cli.ts serve`).
    const proc = spawn('bun', ['--hot', join(v0, 'src', 'cli.ts'), 'serve', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout!.on('data', (d) => (out += d.toString()))
    proc.stderr!.on('data', (d) => (out += d.toString()))
    const waitOut = async (re: RegExp, ms = 20000) => {
      const until = Date.now() + ms
      while (!re.test(out)) {
        if (proc.exitCode !== null || Date.now() > until) throw new Error(`no ${re} in output:\n${out}`)
        await Bun.sleep(50)
      }
      return out.match(re)!
    }
    try {
      const m = await waitOut(/at http:\/\/localhost:(\d+) \(pid (\d+)\)/)
      const base = `http://localhost:${port}`
      const pidBefore = Number(m[2])
      expect(pidBefore).toBe(proc.pid!)
      const healthBefore = (await (await fetch(`${base}/api/health`)).json()) as any
      expect(healthBefore.pid).toBe(pidBefore)

      // A chat session starts before the edit; its agent child is long-lived.
      const live1 = await openLive(`${base}/api/live`)
      await live1.next('hello')
      const chat = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ text: 'hello before the edit' }) })
      expect(chat.status).toBe(200)
      const agentPid = ((await chat.json()) as any).pid as number
      await live1.next('agent')
      expect(alive(agentPid)).toBe(true)
      live1.close()
      const helloBefore = await (async () => {
        const l = await openLive(`${base}/api/live`)
        const h = await l.next('hello')
        l.close()
        return h
      })()
      expect(helloBefore.children).toEqual([{ name: 'chat', pid: agentPid }])

      // The agent saves a change to a server module.
      await Bun.sleep(300)
      appendFileSync(join(v0, 'src', 'server', 'app.ts'), '\n// held-out edit: a comment, no behaviour change\n')

      await waitOut(/werk: reloaded [^\n]*src\/server\/app\.ts/)
      await waitOut(/reusing the live server[^\n]*not listening again/)
      await Bun.sleep(300)
      console.log('server output:\n' + out)

      const healthAfter = (await (await fetch(`${base}/api/health`)).json()) as any
      expect(healthAfter.pid).toBe(pidBefore)
      expect(proc.exitCode).toBeNull()
      expect(alive(agentPid)).toBe(true)

      const l2 = await openLive(`${base}/api/live`)
      const helloAfter = await l2.next('hello')
      l2.close()
      expect(helloAfter).toEqual(helloBefore)

      // No second server, no second agent child.
      expect(out.match(/werk: serving /g)?.length).toBe(1)
      expect(out).not.toMatch(/EADDRINUSE/)
      const agentCalls = readFileSync(calls, 'utf8').trim().split('\n')
      expect(agentCalls).toHaveLength(1)
      const kids = childrenOf(pidBefore).filter((k) => /fake-agent|claude/.test(k.command))
      console.log('server children:', JSON.stringify(childrenOf(pidBefore)))
      expect(kids.map((k) => k.pid)).toEqual([agentPid])
    } finally {
      proc.kill('SIGTERM')
      await Bun.sleep(500)
    }
  }, 90_000)
})

describe('01.3 unit tests and the coverage gate', () => {
  test('bun test, then bun run test:coverage passing, then failing on a pure file under 90%', () => {
    const { root, v0 } = copyRepo()
    copies.push(root)
    const env = cleanEnv({ CI: 'true' })
    const run = (args: string[]) => {
      const r = spawnSync('bun', args, { cwd: v0, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
    }

    const first = run(['test'])
    expect(first.code).toBe(0)
    expect(first.out).toMatch(/\d+ pass\n\s*0 fail/)
    // A passing non-TTY run prints no file names, so check that the run covers every test file
    // bun discovers, and that those include server tests and React component (.tsx) tests.
    const found = spawnSync('find', ['.', '-path', './node_modules', '-prune', '-o', '(', '-name', '*.test.ts', '-o', '-name', '*.test.tsx', ')', '-print'], { cwd: v0, encoding: 'utf8' })
      .stdout.split('\n').filter(Boolean)
    const ranFiles = Number(first.out.match(/across (\d+) files/)?.[1])
    console.log('test files:', found.join(' '), '| bun test ran', ranFiles)
    expect(ranFiles).toBe(found.length)
    expect(found.some((f) => /^\.\/src\/server\/.+\.test\.ts$/.test(f))).toBe(true)
    const tsx = found.filter((f) => f.endsWith('.test.tsx'))
    expect(tsx.length).toBeGreaterThan(0)
    for (const f of tsx) expect(readFileSync(join(v0, f), 'utf8')).toMatch(/@testing-library\/react|from 'react'/)
    expect(first.out).not.toMatch(/% Lines|coverage gate|% Funcs/)
    console.log('bun test summary:', first.out.split('\n').slice(-6).join(' | '))

    const cov = run(['run', 'test:coverage'])
    expect(cov.code).toBe(0)
    expect(cov.out).toContain('coverage gate passed')

    // Remove the tests of one pure file: src/args.ts loses src/args.test.ts.
    expect(readFileSync(join(v0, 'tools', 'pure-files.ts'), 'utf8')).toContain("'src/args.ts'")
    rmSync(join(v0, 'src', 'args.test.ts'))
    const cov2 = run(['run', 'test:coverage'])
    console.log('gate after removal:', cov2.out.split('\n').filter((l) => /FAIL|gate/.test(l)).join(' | '))
    expect(cov2.code).not.toBe(0)
    expect(cov2.out).toMatch(/FAIL\s+src\/args\.ts\s+\d+(\.\d+)?%/)
    expect(cov2.out).toContain('coverage gate failed')

    const again = run(['test'])
    expect(again.code).toBe(0)
    expect(again.out).toMatch(/\d+ pass\n\s*0 fail/)
    expect(again.out).not.toMatch(/coverage gate|FAIL\s+src\/args/)
  }, 600_000)
})

describe('01.4 bun run e2e with a scripted fake agent and no real agent', () => {
  test('boots a real server on a fixture copy, one screenshot per test, fixture unchanged, no real agent call', async () => {
    const { root, v0 } = copyRepo()
    copies.push(root)
    const port = 5220
    // No real agent can be reached: a `claude` ahead of any real one that records each call and fails.
    const stubDir = mkdtempSync(join(tmpdir(), 'werk-ho-noagent-'))
    copies.push(stubDir)
    const stubCalls = join(stubDir, 'real-claude-calls.txt')
    writeFileSync(join(stubDir, 'claude'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(stubCalls)}\necho "no real agent here" >&2\nexit 1\n`)
    chmodSync(join(stubDir, 'claude'), 0o755)
    const env = cleanEnv({ CI: 'true', WERK_E2E_PORT: String(port), PATH: `${stubDir}:${cleanEnv().PATH}`, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' })

    const fixture = join(v0, 'e2e', 'fixtures', 'demo')
    const snapshot = (dir: string) => {
      const files: Record<string, string> = {}
      const walk = (d: string) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n)
          if (statSync(p).isDirectory()) walk(p)
          else files[relative(dir, p)] = readFileSync(p, 'utf8')
        }
      }
      walk(dir)
      return files
    }
    const before = snapshot(fixture)

    // Watch the processes while the run goes: the server werk boots and the project it serves.
    const seen = new Set<string>()
    let fixtureCopySeen = false
    const watcher = setInterval(() => {
      for (const line of spawnSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8' }).stdout.split('\n')) {
        if (line.includes(join(v0, 'src', 'cli.ts')) || line.includes('fake-agent')) seen.add(line.trim())
      }
      if (existsSync(join(realpathSync(tmpdir()), `werk-e2e-${port}`, 'demo', '.werk', 'log.jsonl'))) fixtureCopySeen = true
    }, 100)

    const proc = spawn('bun', ['run', 'e2e'], { cwd: v0, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout!.on('data', (d) => (out += d.toString()))
    proc.stderr!.on('data', (d) => (out += d.toString()))
    const code = await new Promise<number | null>((r) => proc.on('exit', r))
    clearInterval(watcher)
    console.log(out.split('\n').filter((l) => /✓|✘|passed|failed|Error/.test(l)).join('\n'))
    console.log('processes seen:', [...seen].join(' || '))

    expect(code).toBe(0)
    const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
    expect(passed).toBeGreaterThan(0)
    expect(out).not.toMatch(/\d+ failed/)

    // A real werk server on a copy of the fixture.
    expect([...seen].some((l) => l.includes(`${join(v0, 'src', 'cli.ts')} serve --port ${port}`))).toBe(true)
    expect(fixtureCopySeen).toBe(true)
    // The original fixture stays unchanged.
    expect(snapshot(fixture)).toEqual(before)

    // Each browser test opens the page werk serves.
    const specs = readdirSync(join(v0, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))
    let testCount = 0
    for (const spec of specs) {
      const text = readFileSync(join(v0, 'e2e', spec), 'utf8')
      const blocks = text.split(/\ntest\(/).slice(1)
      testCount += blocks.length
      for (const b of blocks) expect(b, `${spec}: test opens the page`).toMatch(/page\.goto\(/)
    }
    expect(testCount).toBe(passed)

    // One screenshot per test.
    const evidence = readdirSync(join(v0, 'e2e', 'evidence')).filter((f) => f.endsWith('.png'))
    console.log('evidence:', evidence.join(', '))
    expect(evidence).toHaveLength(passed)

    // No call reached a real agent.
    expect(existsSync(stubCalls) ? readFileSync(stubCalls, 'utf8') : '').toBe('')
  }, 600_000)
})

describe('01.5 a command-line test with the harness', () => {
  let harness: any
  let dirs: string[] = []
  let project: any
  // The documented use in v0's own tests: afterEach(() => project?.cleanup()).
  afterEach(() => {
    project?.cleanup()
    project = undefined
  })

  test('the harness gives a git project, runs werk, and the agent is the fake', async () => {
    const { root, v0 } = copyRepo()
    copies.push(root)
    harness = await import(join(v0, 'test', 'harness.ts'))
    project = harness.makeProject()
    dirs.push(project.dir)
    expect(existsSync(join(project.dir, '.git'))).toBe(true)
    expect(project.git(['log', '--oneline']).stdout.trim()).toMatch(/start/)

    // A map whose subtree the plan stage hands to the writer agents.
    const map = [
      { type: 'added', id: 'plan', kind: 'card', title: 'The plan ends in a spec and tickets' },
      { type: 'added', id: 'step', kind: 'card', title: 'One spec per subtree', parent: 'plan' },
      { type: 'decided', id: 'plan' },
      { type: 'decided', id: 'step' },
    ]
    writeFileSync(join(project.dir, '.werk', 'log.jsonl'), map.map((b, i) => JSON.stringify({ ...b, seq: i + 1, at: '' }) + '\n').join(''))
    const calls = join(project.dir, 'calls.jsonl')
    const r = project.run(['plan', 'plan'], { WERK_FAKE_CALLS: calls })
    console.log('exit', r.code, 'stdout', JSON.stringify(r.stdout), 'stderr', JSON.stringify(r.stderr))
    expect(typeof r.code).toBe('number')
    expect(r.stdout + r.stderr).not.toBe('')
    // The agent that werk called is the scripted fake: it recorded its own call.
    expect(existsSync(calls)).toBe(true)
    const recorded = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(recorded.length).toBeGreaterThan(0)
    expect(recorded[0].argv).toContain('-p')

    // A plain command too: exit code and output.
    const show = project.run(['show'])
    expect(show.code).toBe(0)
    expect(JSON.parse(show.stdout)).toBeTruthy()
  }, 120_000)

  test('the temporary project is gone after the test ends', () => {
    expect(dirs).toHaveLength(1)
    expect(existsSync(dirs[0])).toBe(false)
    // Without an explicit cleanup the harness leaves the directory behind.
    const leaked = harness.makeProject()
    const stays = existsSync(leaked.dir)
    console.log('a project with no cleanup() call still exists after creation:', stays, '(the harness registers no automatic removal)')
    leaked.cleanup()
  })
})
