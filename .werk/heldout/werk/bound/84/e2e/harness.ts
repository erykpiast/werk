/**
 * The held-out browser harness. Each test gets an empty temporary git project with the fake
 * agent first on the PATH as `claude`. The test seeds the logs, then starts the real werk
 * server on a free port. After the test, the harness saves one screenshot.
 */
import { test as base, expect, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { NewBoardEvent } from '../../src/board/events.ts'
import type { NewEvent } from '../../src/map/events.ts'
import { logOf } from '../../src/test/map-events.ts'

const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')

export type Server = ChildProcessByStdio<null, Readable, Readable> & { out: string; err: string }

export type Proj = {
  dir: string
  env: Record<string, string>
  /** Runs werk in the project. Throws on a non-zero exit. */
  cli: (args: string[]) => string
  /** Runs werk in the project and gives the exit code and both streams. */
  run: (args: string[]) => { code: number | null; stdout: string; stderr: string }
  seed: (...events: NewEvent[]) => void
  board: (...events: (NewBoardEvent & { actor?: 'you' | 'agent' })[]) => void
  script: (script: unknown) => void
  logLines: () => { type: string; actor: string; payload: Record<string, unknown> }[]
  /** Starts a werk server on the project and gives its address. */
  start: () => Promise<string>
  /** Spawns another `werk serve` on the project, with no wait for its address. */
  spawnServe: () => Server
}

export const test = base.extend<{ proj: Proj }>({
  proj: async ({ page }, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
    const dir = join(root, 'project')
    const bin = join(root, 'bin')
    mkdirSync(dir)
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
    chmodSync(join(bin, 'claude'), 0o755)
    const scriptPath = join(root, 'agent-script.json')
    writeFileSync(scriptPath, JSON.stringify({ steps: [] }))
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: root,
      TMPDIR: tmpdir(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      WERK_FAKE_AGENT_SCRIPT: scriptPath,
    }
    const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
    const git = (...args: string[]) => {
      const r = sh('git', ['-c', 'user.name=werk test', '-c', 'user.email=test@werk.invalid', ...args])
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    }
    git('init', '--quiet', '--initial-branch=main')
    git('commit', '--quiet', '--allow-empty', '-m', 'Start with an empty tree')
    const werkDir = join(dir, '.werk')
    mkdirSync(werkDir)
    const servers: Server[] = []
    const spawnServe = (): Server => {
      const s = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }) as Server
      s.out = ''
      s.err = ''
      s.stdout.on('data', (c: Buffer) => (s.out += c.toString()))
      s.stderr.on('data', (c: Buffer) => (s.err += c.toString()))
      servers.push(s)
      return s
    }
    const proj: Proj = {
      dir,
      env,
      run: (args) => {
        const r = sh('bun', [MAIN, ...args])
        return { code: r.status, stdout: r.stdout, stderr: r.stderr }
      },
      cli: (args) => {
        const r = sh('bun', [MAIN, ...args])
        if (r.status !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
        return r.stdout
      },
      seed: (...events) => writeFileSync(join(werkDir, 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n'),
      board: (...events) =>
        writeFileSync(
          join(werkDir, 'board.jsonl'),
          events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n',
        ),
      script: (script) => writeFileSync(scriptPath, JSON.stringify(script)),
      logLines: () =>
        readFileSync(join(werkDir, 'log.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l)),
      start: async () => addressOf(spawnServe()),
      spawnServe,
    }
    try {
      await use(proj)
    } finally {
      await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
      for (const s of servers) await stop(s)
      rmSync(root, { recursive: true, force: true })
    }
  },
})

export { expect }

/** Starts the server and opens the page on it. */
export async function open(page: Page, proj: Proj, hash = ''): Promise<string> {
  const url = await proj.start()
  await page.goto(url + hash)
  return url
}

function addressOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`werk serve printed no address. stderr: ${server.err}`)), 20_000)
    const look = () => {
      const m = server.out.match(/http:\/\/\S+\//)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    server.stdout.on('data', look)
    server.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`werk serve exited ${code}. stderr: ${server.err}`))
    })
    look()
  })
}

async function stop(server: Server): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  const timer = setTimeout(() => server.kill('SIGKILL'), 5_000)
  await exited
  clearTimeout(timer)
}
