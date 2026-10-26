/** Run by 101-5.test.ts as its own bun test run: a hot-reload test that edits its copy and then fails. */
import { test } from 'bun:test'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeAppCopy, makeProject, serveProject } from '../../../src/test/harness.ts'

test('a hot-reload test that edits a server module of its copy, then fails', async () => {
  const p = makeProject()
  const app = makeAppCopy()
  const server = serveProject(p, ['--port', '0'], { app, hot: true })
  const url = await server.url
  const module = join(app.root, 'src', 'server', 'server.ts')
  writeFileSync(module, readFileSync(module, 'utf8') + '\n// An edit by the test.\n')
  appendFileSync(process.env.HELDOUT_OUT!, JSON.stringify({ root: app.root, pid: server.proc.pid, url }) + '\n')
  throw new Error('this hot-reload test fails on purpose')
}, 30_000)
