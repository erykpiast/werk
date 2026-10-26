import { afterAll, expect, test } from 'bun:test'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeBrowser, getBrowser, liveHello, makeProject, PRODUCT, startServe } from './lib.ts'

afterAll(closeBrowser)

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

test('01.2 an edit to a server module under the dev command keeps the process, the agent child and the live state', async () => {
  // The edit happens in a copy of werk, so the product tree is never changed.
  const copy = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-werk-copy-')))
  for (const part of ['src', 'test', 'package.json', 'tsconfig.json']) cpSync(join(PRODUCT, part), join(copy, part), { recursive: true })
  symlinkSync(join(PRODUCT, 'node_modules'), join(copy, 'node_modules'))
  const project = makeProject()
  const calls = join(project.dir, 'calls.jsonl')
  // The dev command is `bun --hot src/cli.ts serve`.
  const server = await startServe(project.dir, { hot: true, entry: join(copy, 'src', 'cli.ts'), env: { WERK_FAKE_CALLS: calls } })
  try {
    const serverPid = server.process.pid!
    const health = async () => (await (await fetch(`http://localhost:${server.port}/api/health`)).json()) as { pid: number; bootId: string }
    expect((await health()).pid).toBe(serverPid)
    // A chat session starts the long-lived agent child before the edit.
    const res = await fetch(`http://localhost:${server.port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'before' }) })
    expect(res.status).toBe(200)
    const agentPid = ((await res.json()) as { pid: number }).pid
    expect(isAlive(agentPid)).toBe(true)
    const before = await liveHello(server.port)
    expect(before.children).toEqual([{ name: 'chat', pid: agentPid }])

    appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an edit by the agent\n')
    await server.waitFor(/werk: reloaded [^\n]*src\/server\/app\.ts/)
    await server.waitFor(/reusing the live server on port \d+ \(pid \d+\); not listening again/)

    expect((await health()).pid).toBe(serverPid)
    expect(isAlive(agentPid)).toBe(true)
    // A new browser connection to the live channel.
    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}/`)
    const hello = await page.evaluate(() => new Promise<any>((resolve) => {
      const s = new EventSource('/api/live')
      s.addEventListener('hello', (e) => { s.close(); resolve(JSON.parse((e as MessageEvent).data)) })
    }))
    await page.close()
    expect(hello).toEqual(before)
    expect(server.output().match(/werk: serving /g)).toHaveLength(1)
    expect(hello.children).toHaveLength(1)
    expect(existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0).toBe(1)
  } finally {
    await server.stop()
    project.cleanup()
    rmSync(copy, { recursive: true, force: true })
  }
}, 90_000)
