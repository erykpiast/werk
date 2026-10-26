import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Checks, onCleanup, open, project, serve, startServe, makeProject, testEnv } from './lib.ts'
import { liveHello } from '../v0/test/harness.ts'
import { FAKE_AGENT_DIR, WERK_ROOT } from '../v0/test/env.ts'

const report = (c: Checks, id: string) => {
  console.log(`\n=== ${id}\n${c.report()}`)
  expect(c.misses).toEqual([])
}

function copyV0(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hb-werk-copy-')))
  for (const part of readdirSync(WERK_ROOT)) {
    if (['node_modules', 'coverage', 'test-results', 'playwright-report'].includes(part)) continue
    if (part === 'e2e') {
      cpSync(join(WERK_ROOT, part), join(dir, part), { recursive: true, filter: (src) => !src.includes('/e2e/evidence') })
      continue
    }
    cpSync(join(WERK_ROOT, part), join(dir, part), { recursive: true })
  }
  symlinkSync(join(WERK_ROOT, 'node_modules'), join(dir, 'node_modules'))
  onCleanup(() => rmSync(dir, { recursive: true, force: true }))
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

test('01.1 werk serve in an empty project shows the empty map shell', async () => {
  const c = new Checks()
  const p = project()
  c.ok(!existsSync(join(p.dir, '.werk', 'log.jsonl')), 'the project has no log, so no cards')
  const s = await serve(p.dir)
  c.note(`server printed: ${s.output().trim()}`)
  const { page, errors } = await open(s.port)
  await page.waitForLoadState('networkidle')
  const html = await page.content()
  c.ok(await page.locator('#root').count() === 1, 'the page has the React root element')
  const reactRendered = await page.evaluate(() => {
    const root = document.getElementById('root') as any
    return !!root && root.children.length > 0 && Object.keys(root).some((k) => k.startsWith('__reactContainer'))
  })
  c.ok(reactRendered, 'React rendered into #root (a __reactContainer key is on #root and it has children)')
  const main = page.getByRole('main', { name: 'map' })
  c.ok(await main.isVisible(), 'the map shell (main "map") is visible')
  const empty = await page.locator('.empty').textContent().catch(() => null)
  c.note(`empty text: ${empty}`)
  c.ok(empty?.includes('no cards'), 'the page says the map has no cards')
  c.ok((await page.getByRole('region', { name: 'sub-cards' }).count()) === 0, 'no sub-cards list, so no card on the map')
  c.ok((await page.getByRole('alert').count()) === 0, 'no error alert on the page')
  c.ok(errors.length === 0, `no page or console errors: ${JSON.stringify(errors)}`)
  c.ok(!/error|fail/i.test(s.output()), `no error in the server output: ${s.output()}`)
  c.note(`page html length ${html.length}`)
  report(c, '01.1')
}, 60_000)

test('01.2 an edit to a server module under the dev command keeps the process, the agent child and the live state', async () => {
  const c = new Checks()
  const copy = copyV0()
  const p = project()
  const calls = join(p.dir, 'calls.jsonl')
  const s = await startServe(p.dir, { hot: true, entry: join(copy, 'src', 'cli.ts'), env: { WERK_FAKE_CALLS: calls } })
  onCleanup(() => s.stop())
  const pid = s.process.pid!
  const health = async () => (await (await fetch(`http://localhost:${s.port}/api/health`)).json()) as { pid: number }
  c.ok((await health()).pid === pid, 'the server reports the pid noted at start')
  const res = await fetch(`http://localhost:${s.port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) })
  c.ok(res.status === 200, `a chat turn starts an agent child (status ${res.status})`)
  const agentPid = ((await res.json()) as { pid: number }).pid
  await Bun.sleep(500)
  c.ok(isAlive(agentPid), 'the agent child is alive before the edit')
  const before = await liveHello(s.port)
  c.note(`hello before: ${JSON.stringify(before)}`)

  appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an edit by the agent\n')
  const reloaded = await s.waitFor(/werk: reloaded [^\n]*src\/server\/app\.ts/).then(() => true, () => false)
  c.ok(reloaded, 'the output names the reloaded module src/server/app.ts')
  const reused = await s.waitFor(/reusing the live server[^\n]*not listening again/).then(() => true, () => false)
  c.ok(reused, 'the output says it reuses the live server and does not listen again')
  c.ok((await health()).pid === pid && s.process.exitCode === null, 'the server pid is the same and the process is alive')
  c.ok(isAlive(agentPid), 'the agent child from before the edit is alive')
  const after = await liveHello(s.port)
  c.ok(JSON.stringify(after) === JSON.stringify(before), `a new live connection sees the same state: ${JSON.stringify(after)}`)
  c.ok((s.output().match(/werk: serving /g) ?? []).length === 1, 'only one "serving" line: no second server')
  c.ok(after.children.length === 1 && after.children[0]!.pid === agentPid, 'one agent child, the same pid')
  const callLines = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []
  c.ok(callLines.length === 1, `the fake agent started once (${callLines.length} call lines)`)
  c.note(`server output:\n${s.output()}`)
  report(c, '01.2')
}, 90_000)

test('01.3 bun test runs without a coverage check, and the coverage gate names a file under 90%', async () => {
  const c = new Checks()
  const copy = copyV0()
  const env = testEnv({ CI: 'true' })
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, args, { cwd: copy, env, encoding: 'utf8', timeout: 400_000 })
    return { code: r.status ?? 1, out: `${r.stdout}\n${r.stderr}` }
  }
  const t1 = run(['test'])
  c.ok(t1.code === 0, `bun test passes (exit ${t1.code})`)
  // bun prints only a summary when stdout is not a terminal, so a junit report lists the files the same run loads.
  const junit = join(copy, 'hb-junit.xml')
  run(['test', '--reporter=junit', `--reporter-outfile=${junit}`])
  const files = existsSync(junit) ? [...new Set([...readFileSync(junit, 'utf8').matchAll(/file="([^"]+)"/g)].map((m) => m[1]!))] : []
  c.note(`test files: ${files.join(', ')}`)
  c.ok(files.some((f) => /src\/server\/\w+\.test\.ts$/.test(f)), 'the run includes server tests')
  c.ok(files.some((f) => /src\/client\/\w+\.test\.tsx$/.test(f)), 'the run includes React component tests (.test.tsx)')
  c.ok(!/coverage/i.test(t1.out) && !/% Lines|% Funcs/.test(t1.out), 'bun test prints no coverage check')
  c.note(`bun test tail: ${t1.out.trim().split('\n').slice(-4).join(' | ')}`)

  const t2 = run(['run', 'test:coverage'])
  c.ok(t2.code === 0, `test:coverage passes when every pure file is at 90% or more (exit ${t2.code})`)
  c.note(`gate: ${t2.out.split('\n').filter((l) => /coverage gate|FAIL|^ok  /.test(l)).join(' | ')}`)

  // Remove tests: keep one test of tools/coverage.ts that touches only percent().
  writeFileSync(join(copy, 'tools', 'coverage.test.ts'), "import { expect, test } from 'bun:test'\nimport { percent } from './coverage.ts'\ntest('percent', () => { expect(percent({ linesFound: 2, linesHit: 1 })).toBe(50) })\n")
  const t3 = run(['run', 'test:coverage'])
  c.ok(t3.code !== 0, `test:coverage fails after the tests are removed (exit ${t3.code})`)
  const failLine = t3.out.split('\n').find((l) => l.includes('FAIL') && l.includes('tools/coverage.ts'))
  c.ok(!!failLine, `the gate names tools/coverage.ts: ${failLine}`)
  c.note(`gate after removal: ${t3.out.split('\n').filter((l) => /coverage gate|FAIL/.test(l)).join(' | ')}`)

  const t4 = run(['test'])
  c.ok(t4.code === 0 && !/coverage gate/.test(t4.out), `bun test still passes with no coverage failure (exit ${t4.code})`)
  report(c, '01.3')
}, 900_000)

test('01.4 bun run e2e boots a real server on a fixture copy, saves a screenshot per test and uses the fake agent', async () => {
  const c = new Checks()
  const copy = copyV0()
  const fixtureLog = join(copy, 'e2e', 'fixtures', 'demo', '.werk', 'log.jsonl')
  const hashDir = (d: string) => {
    const h = createHash('sha256')
    const walk = (x: string) => {
      for (const e of readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const f = join(x, e.name)
        h.update(f.slice(d.length))
        if (e.isDirectory()) walk(f)
        else h.update(readFileSync(f))
      }
    }
    walk(d)
    return h.digest('hex')
  }
  const fixtureDir = join(copy, 'e2e', 'fixtures', 'demo')
  const before = hashDir(fixtureDir)
  c.ok(existsSync(fixtureLog), 'the fixture project has a log')
  // A trap: a `claude` that is not the scripted fake. If any call reaches it, it writes a marker.
  const trapDir = realpathSync(mkdtempSync(join(tmpdir(), 'hb-trap-')))
  onCleanup(() => rmSync(trapDir, { recursive: true, force: true }))
  const marker = join(trapDir, 'called')
  writeFileSync(join(trapDir, 'claude'), `#!/bin/sh\necho "$@" >> ${marker}\nexit 3\n`)
  chmodSync(join(trapDir, 'claude'), 0o755)
  const port = String(4990 + Math.floor(Math.random() * 400))
  const env: Record<string, string> = { ...process.env as Record<string, string>, CI: 'true', WERK_E2E_PORT: port, PATH: `${trapDir}:${(process.env.PATH ?? '').split(':').filter((x) => x !== FAKE_AGENT_DIR).join(':')}`, HTTPS_PROXY: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'invalid' }
  const r = spawnSync(process.execPath, ['run', 'e2e'], { cwd: copy, env, encoding: 'utf8', timeout: 400_000 })
  const out = `${r.stdout}\n${r.stderr}`
  c.ok(r.status === 0, `bun run e2e exits 0 (exit ${r.status})`)
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed = Number(out.match(/(\d+) failed/)?.[1] ?? 0)
  c.note(`passed ${passed}, failed ${failed}`)
  c.ok(new RegExp(`werk: serving \\S*werk-e2e-${port}/demo at http://localhost:${port}`).test(out), 'the run boots a real werk server on a copy of the fixture under a temp directory')
  c.ok(hashDir(fixtureDir) === before, 'the original fixture project is unchanged after the run')
  const evidence = join(copy, 'e2e', 'evidence')
  const pngs = existsSync(evidence) ? readdirSync(evidence).filter((f) => f.endsWith('.png')) : []
  c.ok(pngs.length === passed + failed && pngs.length > 0, `one screenshot per test: ${pngs.length} PNGs for ${passed + failed} tests`)
  const specs = readdirSync(join(copy, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))
  const gotos = specs.every((f) => /page\.goto\(/.test(readFileSync(join(copy, 'e2e', f), 'utf8')))
  c.ok(gotos, 'each browser spec file opens the served page with page.goto')
  c.ok(!existsSync(marker), `no agent call reached a non-fake claude (trap marker ${existsSync(marker) ? readFileSync(marker, 'utf8') : 'absent'})`)
  c.note(out.split('\n').filter((l) => /✓|✘|passed|failed|serving/.test(l)).join('\n'))
  report(c, '01.4')
}, 600_000)

test('01.5 the harness gives a temp git project, runs werk with the fake agent, and the project is gone after', async () => {
  const c = new Checks()
  const p = makeProject()
  let dir = p.dir
  try {
    c.ok(existsSync(join(p.dir, '.git')), 'the temp project is a git repository')
    c.ok(p.git(['log', '--oneline']).code === 0, 'git log works in it')
    const r = p.run(['add', 'a', '--title', 'A'])
    c.ok(r.code === 0, `the test reads the exit code (${r.code})`)
    c.ok(r.stdout.includes('added #a'), `the test reads the output: ${r.stdout.trim()}`)
    const bad = p.run(['nope'])
    c.ok(bad.code === 1 && bad.stderr.includes('unknown command'), 'a failing command gives exit 1 and its output')
    const which = spawnSync('sh', ['-c', 'command -v claude'], { env: testEnv(), encoding: 'utf8' }).stdout.trim()
    c.ok(which === join(FAKE_AGENT_DIR, 'claude'), `claude in the harness environment is the fake agent: ${which}`)
  } finally {
    p.cleanup()
  }
  c.ok(!existsSync(dir), 'the temporary project is gone after cleanup')
  c.note('the harness removes the project through cleanup(), which the test calls at its end; it does not remove it by itself')
  report(c, '01.5')
}, 60_000)
