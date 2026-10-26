import { afterAll, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanEnv, copyWerk, isAlive, start, type Proc } from './helpers.ts'

let server: Proc | undefined
const dirs: string[] = []
afterAll(async () => {
  await server?.stop()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

async function hello(port: number) {
  const ac = new AbortController()
  const res = await fetch(`http://localhost:${port}/api/live`, { signal: ac.signal })
  const reader = res.body!.getReader()
  let text = ''
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
  }
  ac.abort()
  return JSON.parse(text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'))
}

test('01.2 an edit to a server module under the dev command keeps the server and the agent child', async () => {
  const werk = copyWerk()
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-proj-')))
  dirs.push(werk, project)
  const env = cleanEnv({ PATH: `${join(werk, 'test', 'fake-agent')}:${process.env.PATH}` })
  // Given the user starts werk with the dev command (`bun --hot src/cli.ts serve`) in a project directory
  server = start(process.execPath, ['--hot', join(werk, 'src', 'cli.ts'), 'serve', '--port', '0'], project, env)
  const port = Number((await server.waitFor(/at http:\/\/localhost:(\d+) /))[1])
  // And the user notes the process id of the server
  const pidBefore = server.child.pid!
  // And a long-lived agent child is running from a chat session that started before the edit
  const chatAttempts: string[] = []
  for (const path of ['/api/chat', '/api/chats', '/api/convo', '/api/session']) {
    const r = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) })
    chatAttempts.push(`${path} -> ${r.status}`)
  }
  const before = await hello(port)
  const childBefore = before.children as { name: string; pid: number }[]
  console.log('chat attempts:', chatAttempts, 'children before edit:', childBefore)
  // When the agent saves a change to a server module
  appendFileSync(join(werk, 'src', 'server', 'app.ts'), '\n// an edit\n')
  // Then the server output shows that the changed module reloaded
  // And the server output says that it reuses the live server and does not listen a second time
  const reuse = await server.waitFor(/reusing the live server on port (\d+) \(pid (\d+)\)/)
  expect(Number(reuse[1])).toBe(port)
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)
  // And the process id of the server is the same as before the edit
  const health = (await (await fetch(`http://localhost:${port}/api/health`)).json()) as { pid: number }
  expect(health.pid).toBe(pidBefore)
  expect(Number(reuse[2])).toBe(pidBefore)
  // And a new browser connection to the live channel sees the same server state as before the edit
  const after = await hello(port)
  expect(after).toEqual(before)
  console.log('server output:\n' + server.output())
  // And the long-lived agent child from before the edit is still alive / no second agent child starts
  expect(childBefore.length).toBe(1)
  expect(isAlive(childBefore[0]!.pid)).toBe(true)
  expect(after.children).toEqual(childBefore)
}, 60_000)
