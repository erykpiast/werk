import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WERK_ROOT } from '../test/env.ts'
import { liveHello, makeProject, startServe, type RunningServer, type TempProject } from '../test/harness.ts'

/** The agent edits a server module, so the server runs from a copy of werk. */
function copyWerk(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-werk-copy-')))
  for (const part of ['src', 'test', 'package.json', 'tsconfig.json']) cpSync(join(WERK_ROOT, part), join(dir, part), { recursive: true })
  symlinkSync(join(WERK_ROOT, 'node_modules'), join(dir, 'node_modules'))
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
const health = async (port: number) => (await (await fetch(`http://localhost:${port}/api/health`)).json()) as { pid: number }

let copy: string | undefined
let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  if (copy) rmSync(copy, { recursive: true, force: true })
  server = project = copy = undefined
})

type Check = { name: string; ok: boolean; saw: string }

async function scenario(entryArgs: { entry: string; args?: string[]; env?: Record<string, string> }, editFile: string) {
  const checks: Check[] = []
  const check = (name: string, ok: boolean, saw: string) => checks.push({ name, ok, saw })
  // Given the user starts werk with the dev command (bun --hot ... serve) in a project directory
  server = await startServe(project!.dir, { hot: true, ...entryArgs })
  // And the user notes the process id of the server
  const pidBefore = server.process.pid!
  const healthBefore = await health(server.port)
  const before = await liveHello(server.port)
  // And a long-lived agent child is running from a chat session that started before the edit
  const childBefore = before.children[0]
  check('an agent child runs before the edit', childBefore !== undefined && isAlive(childBefore.pid), JSON.stringify(before.children))
  const outBefore = server.output()
  // When the agent saves a change to a server module
  appendFileSync(join(copy!, 'src', 'server', editFile), '\n// an edit by the agent\n')
  let reuseLine = ''
  try {
    reuseLine = (await server.waitFor(/reusing the live server[^\n]*/, 15_000))[0]
  } catch (e) {
    reuseLine = ''
  }
  await Bun.sleep(300)
  const added = server.output().slice(outBefore.length)
  // Then the server output shows that the changed module reloaded
  check('output shows that the changed module reloaded', added.includes(editFile) || /reload/i.test(added), JSON.stringify(added))
  // And the output says it reuses the live server and does not listen a second time
  check('output says it reuses the live server', reuseLine !== '', reuseLine)
  check('output does not listen a second time', (server.output().match(/werk: serving /g) ?? []).length === 1 && !/EADDRINUSE/.test(server.output()), JSON.stringify(server.output()))
  // And the pid is the same
  const healthAfter = await health(server.port)
  check('pid is the same', healthAfter.pid === healthBefore.pid && healthAfter.pid === pidBefore, `${pidBefore} -> ${healthAfter.pid}`)
  // And the agent child from before is still alive
  check('agent child from before is still alive', childBefore !== undefined && isAlive(childBefore.pid), String(childBefore?.pid))
  // And a new browser connection to the live channel sees the same server state
  const after = await liveHello(server.port)
  check('new live connection sees the same state', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)
  // And no second server or second agent child starts
  check('no second agent child', after.children.length === before.children.length && after.children.every((c, i) => c.pid === before.children[i]?.pid), JSON.stringify(after.children))
  console.log(JSON.stringify(checks, null, 1))
  return checks
}

test('01.2 with the dev command as shipped: bun --hot src/cli.ts serve', async () => {
  copy = copyWerk()
  project = makeProject()
  const checks = await scenario({ entry: join(copy, 'src', 'cli.ts') }, 'app.ts')
  expect(checks.filter((c) => !c.ok)).toEqual([])
}, 60_000)

test('01.2 supplementary: the test entry that holds one long-lived fake agent child', async () => {
  copy = copyWerk()
  project = makeProject()
  const script = join(project.dir, 'hold.json')
  writeFileSync(script, JSON.stringify([{ hold: true }]))
  const checks = await scenario({ entry: join(copy, 'test', 'hot-entry.ts'), args: [], env: { WERK_FAKE_SCRIPT: script } }, 'app.ts')
  expect(checks.filter((c) => !c.ok)).toEqual([])
}, 60_000)
