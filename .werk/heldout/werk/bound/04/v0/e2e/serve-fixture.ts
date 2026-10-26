/**
 * Boots the real werk server for the browser tests: on a fresh copy of the fixture project,
 * at the path fixture.ts gives for the port, with the fake agent first on PATH.
 * Usage: bun e2e/serve-fixture.ts <port>
 */
import { spawn } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CLI, FAKE_AGENT_DIR, testEnv } from '../test/env.ts'
import { fixtureProject, fixtureRoot } from './fixture.ts'

const port = process.argv[2] ?? '4951'
const root = fixtureRoot(port)
const project = fixtureProject(port)
rmSync(root, { recursive: true, force: true })
cpSync(join(import.meta.dir, 'fixtures', 'demo'), project, { recursive: true })

const env = testEnv()
if (Bun.which('claude', { PATH: env.PATH }) !== join(FAKE_AGENT_DIR, 'claude')) {
  console.error('serve-fixture: the fake agent is not first on PATH; refusing to start')
  process.exit(1)
}

const server = spawn(process.execPath, [CLI, 'serve', '--port', port], { cwd: project, env, stdio: 'inherit' })
const stop = () => {
  server.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.on('exit', (code) => {
  rmSync(root, { recursive: true, force: true })
  process.exit(code ?? 0)
})
