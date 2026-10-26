import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI, WERK, cleanup, env, makeProject, serve, werk, type Server } from './helpers'

let dir: string | undefined
let server: Server | undefined
test.afterEach(async () => {
  await server?.stop()
  cleanup(dir)
  server = undefined
  dir = undefined
})

test('01.1 werk serve shows an empty map shell rendered by React', async ({ page }) => {
  dir = makeProject()
  server = await serve(dir)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(server.url)
  // React renders: the root element has React's internal container key.
  await expect(page.getByRole('main', { name: 'map' })).toBeVisible()
  const reactRoot = await page.evaluate(() => {
    const root = document.getElementById('root') ?? document.body.firstElementChild
    return !!root && Object.keys(root).some((k) => k.startsWith('__reactContainer'))
  })
  expect(reactRoot, 'the page root is a React container').toBe(true)
  await expect(page.getByText('The map has no cards yet.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'sub-cards' })).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
  expect(server.output()).not.toMatch(/error|warn|exception/i)
})

test('01.2 a server-module edit under the dev command keeps the process, the agent child and the state', async () => {
  dir = makeProject()
  const appPath = join(WERK, 'src', 'server', 'app.ts')
  const original = readFileSync(appPath, 'utf8')
  try {
    server = await serve(dir, { hot: true })
    const health = async () => (await fetch(`${server!.url}/api/health`)).json() as Promise<{ pid: number; bootId: string }>
    const hello = async () => {
      const ctl = new AbortController()
      const res = await fetch(`${server!.url}/api/live`, { signal: ctl.signal })
      const reader = res.body!.getReader()
      let text = ''
      while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value)
      ctl.abort()
      return JSON.parse(text.split('\n').find((l) => l.startsWith('data: '))!.slice(6))
    }
    const before = await health()
    expect(before.pid).toBe(server.proc.pid)
    const chat = await fetch(`${server.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.url }, body: JSON.stringify({ text: 'hello' }) })
    expect(chat.status).toBe(200)
    const agentPid = ((await chat.json()) as { pid: number }).pid
    const helloBefore = await hello()
    expect(helloBefore.children).toEqual([{ name: 'chat', pid: agentPid }])
    const outBefore = server.output()

    writeFileSync(appPath, original + '\n// heldout edit\n')
    await server.waitFor(/werk: reloaded [^\n]*src\/server\/app\.ts/)
    await server.waitFor(/reusing the live server on port \d+ \(pid \d+\); not listening again/)

    const after = await health()
    expect(after.pid).toBe(before.pid)
    expect(after.bootId).toBe(before.bootId)
    expect(() => process.kill(agentPid, 0)).not.toThrow()
    const helloAfter = await hello()
    expect(helloAfter).toEqual(helloBefore)
    // No second server, no second agent child.
    expect(server.output().match(/werk: serving/g)?.length).toBe(1)
    expect(outBefore.match(/werk: serving/g)?.length).toBe(1)
    expect(helloAfter.children.length).toBe(1)
  } finally {
    await server?.stop()
    writeFileSync(appPath, original)
  }
})

/** A copy of the product to change without touching the original. node_modules is linked. */
function scratchCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-copy-'))
  const copy = join(root, 'v0')
  const skip = ['node_modules', 'coverage', 'test-results', join('e2e', 'evidence')].map((d) => join(WERK, d))
  cpSync(WERK, copy, { recursive: true, filter: (src) => !skip.some((d) => src === d || src.startsWith(d + '/')) })
  symlinkSync(join(WERK, 'node_modules'), join(copy, 'node_modules'))
  return copy
}

test('01.3 bun test runs server and React tests with no coverage check; the coverage gate fails on a pure file under 90%', async () => {
  const copy = scratchCopy()
  try {
    const run = (cmd: string[]) => {
      const e = env()
      for (const k of Object.keys(e)) if (/^(PW_|PLAYWRIGHT|TEST_|FORCE_COLOR)/.test(k)) delete e[k]
      const r = spawnSync('bun', cmd, { cwd: copy, env: e, encoding: 'utf8', timeout: 400_000 })
      return { code: r.status, out: r.stdout + r.stderr }
    }
    const t1 = run(['test'])
    expect(t1.code, t1.out.slice(-2000)).toBe(0)
    // The run's file count equals every test file, among them server tests and .tsx component tests.
    const files = (readdirSync(copy, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => !f.startsWith('node_modules') && !f.startsWith('e2e') && /\.test\.tsx?$/.test(f))
    expect(files.some((f) => f.startsWith('src/server/'))).toBe(true)
    expect(files.some((f) => f.endsWith('.test.tsx'))).toBe(true)
    expect(t1.out).toContain(`across ${files.length} files`)
    expect(t1.out).not.toMatch(/coverage|% Lines/i)

    const c1 = run(['run', 'test:coverage'])
    expect(c1.code, c1.out.slice(-2000)).toBe(0)
    expect(c1.out).toMatch(/coverage gate passed/)

    // args.ts is a pure file. Its unit tests go; the CLI tests run it in a subprocess only.
    rmSync(join(copy, 'src', 'args.test.ts'))
    const c2 = run(['run', 'test:coverage'])
    expect(c2.code, c2.out.slice(-3000)).not.toBe(0)
    const gateLines = c2.out.split('\n').filter((l) => l.includes('src/args.ts'))
    expect(gateLines.join('\n')).toMatch(/src\/args\.ts/)
    const pct = Number(c2.out.match(/^\S+\s+src\/args\.ts\s+([\d.]+)%/m)?.[1])
    expect(pct).toBeLessThan(90)
    expect(c2.out).toMatch(/(FAIL|fail|under)[^\n]*src\/args\.ts|src\/args\.ts[^\n]*(under|below)/i)

    const t2 = run(['test'])
    expect(t2.code, t2.out.slice(-2000)).toBe(0)
    expect(t2.out).not.toMatch(/coverage/i)
  } finally {
    rmSync(join(copy, '..'), { recursive: true, force: true })
  }
})

test('01.4 bun run e2e boots a real server on a fixture copy, saves a PNG per test, and calls only the fake agent', async () => {
  const copy = scratchCopy()
  // A stand-in for a real agent: if anything runs `claude` from here, a marker appears.
  const realDir = mkdtempSync(join(tmpdir(), 'werk-heldout-real-'))
  const marker = join(realDir, 'called')
  writeFileSync(join(realDir, 'claude'), `#!/bin/sh\necho "$@" >> ${marker}\nexit 1\n`)
  chmodSync(join(realDir, 'claude'), 0o755)
  const hashDir = (d: string) => {
    const h = createHash('sha256')
    for (const f of (readdirSync(d, { recursive: true, encoding: 'utf8' }) as string[]).sort()) {
      h.update(f)
      try {
        h.update(readFileSync(join(d, f)))
      } catch {}
    }
    return h.digest('hex')
  }
  const fixture = join(copy, 'e2e', 'fixtures', 'demo')
  const before = hashDir(fixture)
  try {
    const e = { ...process.env, PATH: `${realDir}:${process.env.PATH}`, ANTHROPIC_API_KEY: '' } as Record<string, string>
    for (const k of Object.keys(e)) if (/^(WERK_|PW_|PLAYWRIGHT|TEST_|FORCE_COLOR)/.test(k)) delete e[k]
    const r = spawnSync('bun', ['run', 'e2e'], { cwd: copy, env: e, encoding: 'utf8', timeout: 400_000 })
    const out = r.stdout + r.stderr
    expect(r.status, out.slice(-3000)).toBe(0)
    expect(out).toMatch(/werk: serving \S*werk-e2e-\d+\/demo at http:\/\/localhost:\d+/)
    expect(hashDir(fixture)).toBe(before)
    const passed = Number(out.match(/(\d+) passed/)?.[1])
    expect(passed).toBeGreaterThan(0)
    const pngs = readdirSync(join(copy, 'e2e', 'evidence')).filter((f) => f.endsWith('.png'))
    expect(pngs.length).toBe(passed)
    // Each browser test uses the page fixture against the werk server's baseURL.
    for (const spec of readdirSync(join(copy, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))) {
      const text = readFileSync(join(copy, 'e2e', spec), 'utf8')
      const tests = text.match(/^test\(/gm)?.length ?? 0
      const gotos = text.match(/^test\([^\n]*\{ page[\s\S]*?page\.goto\(/gm)?.length ?? 0
      expect(gotos, spec).toBe(tests)
    }
    expect(existsSync(marker), 'a non-fake claude was called').toBe(false)
  } finally {
    rmSync(join(copy, '..'), { recursive: true, force: true })
    rmSync(realDir, { recursive: true, force: true })
  }
})

test('01.5 a CLI test through the harness gets a temp git project, exit code and output, the fake agent, and cleanup', async () => {
  const work = mkdtempSync(join(tmpdir(), 'werk-heldout-harness-'))
  const record = join(work, 'record.json')
  const testFile = join(WERK, 'test', 'zz-heldout-harness.test.ts')
  writeFileSync(
    testFile,
    `import { afterEach, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeProject, type TempProject } from './harness.ts'
import { testEnv } from './env.ts'
let project: TempProject | undefined
afterEach(() => project?.cleanup())
test('harness', () => {
  project = makeProject()
  const isGit = existsSync(join(project.dir, '.git'))
  const r = project.run(['add', 'a', '--title', 'A'])
  const bad = project.run(['nope'])
  const which = spawnSync('sh', ['-c', 'command -v claude'], { cwd: project.dir, env: testEnv(), encoding: 'utf8' }).stdout.trim()
  writeFileSync(${JSON.stringify(record)}, JSON.stringify({ dir: project.dir, isGit, code: r.code, stdout: r.stdout, badCode: bad.code, badErr: bad.stderr, which }))
  expect(r.code).toBe(0)
})
`,
  )
  try {
    const r = spawnSync('bun', ['test', 'test/zz-heldout-harness.test.ts'], { cwd: WERK, env: env(), encoding: 'utf8' })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const rec = JSON.parse(readFileSync(record, 'utf8'))
    expect(rec.isGit).toBe(true)
    expect(rec.code).toBe(0)
    expect(rec.stdout).toContain('proposed')
    expect(rec.badCode).toBe(1)
    expect(rec.badErr).toContain('unknown command: nope')
    expect(rec.which).toBe(join(WERK, 'test', 'fake-agent', 'claude'))
    expect(existsSync(rec.dir)).toBe(false)
  } finally {
    rmSync(testFile, { force: true })
    rmSync(work, { recursive: true, force: true })
  }
})
