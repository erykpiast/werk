/**
 * The inner hot-reload test of step 101.5. It runs only when the outer test starts it with
 * HELDOUT_OUT set: it edits a server module of its app copy, records what it started, and fails.
 */
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeAppCopy, makeProject, serveProject } from '../../src/test/harness.ts'

const out = process.env.HELDOUT_OUT

test.skipIf(!out)(
  'a hot-reload test that edits a server module of its copy and then fails',
  async () => {
    const p = makeProject()
    const app = makeAppCopy()
    const server = serveProject(p, ['--port', '0'], { app, hot: true })
    const url = await server.url
    const module = join(app.root, 'src', 'server', 'server.ts')
    writeFileSync(module, readFileSync(module, 'utf8').replace('`werk: no route ${path}`', '`werk: no such route ${path}`'))
    const deadline = Date.now() + 20_000
    while (!server.stderr().includes('reusing the live server') && Date.now() < deadline) await Bun.sleep(50)
    writeFileSync(out!, JSON.stringify({ pid: server.proc.pid, url, appRoot: app.root, project: p.dir }))
    expect('the test fails here').toBe('on purpose')
  },
  60_000,
)
