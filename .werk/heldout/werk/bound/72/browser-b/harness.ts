/**
 * The browser test harness (#werk-test, #werk-v0-seams). Each test gets its own copy of the
 * fixture project, made a git repository, with the fake agent first on the PATH as `claude`.
 * The real werk server runs on it, on a free port. The page may reach only that server.
 * Local storage starts empty. After the test, the harness saves one full-page screenshot as
 * evidence. The assertions read the page's structure; the picture is for a person to look at.
 */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')
const BOOT_TIMEOUT_MS = 20_000

export type Werk = {
  /** The address of the server, with a trailing slash. */
  url: string
  /** The project directory the server serves. */
  dir: string
  /** Runs the werk command line in the project, the way an agent does. Throws on a non-zero exit. */
  cli: (args: string[]) => string
}

export const test = base.extend<{ werk: Werk; boardLog: string | undefined }>({
  boardLog: [undefined, { option: true }],
  werk: [
    async ({ page, boardLog }, use, testInfo) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-e2e-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      cpSync(FIXTURE, dir, { recursive: true })
      if (boardLog !== undefined) cpSync(boardLog, join(dir, '.werk', 'board.jsonl'))
      mkdirSync(bin)
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))

      // A clean environment: an inherited WERK_LOG would point the server at a real map.
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        TMPDIR: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
      }
      const run = (cmd: string, args: string[]) => {
        const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
        if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
        return r.stdout
      }
      run('git', ['init', '--quiet', '--initial-branch=main'])
      run('git', ['-c', 'user.name=werk test', '-c', 'user.email=test@werk.invalid', 'add', '.'])
      run('git', ['-c', 'user.name=werk test', '-c', 'user.email=test@werk.invalid', 'commit', '--quiet', '-m', 'The fixture'])

      const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        const url = await addressOf(server)
        const host = new URL(url).host
        await page.context().route('**/*', (route) =>
          new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient'),
        )
        // Clear local storage before the app's first script runs, once per tab. The flag in
        // session storage survives a reload, so a test that reloads keeps what the page stored.
        await page.addInitScript(() => {
          if (sessionStorage.getItem('werk-test-cleared')) return
          localStorage.clear()
          sessionStorage.setItem('werk-test-cleared', '1')
        })
        await page.goto(url)

        try {
          await use({ url, dir, cli: (args) => run('bun', [MAIN, ...args]) })
        } finally {
          // A failed test keeps its picture too. A page that cannot be drawn must not hide the failure.
          await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
        }
      } finally {
        await stop(server)
        rmSync(root, { recursive: true, force: true })
      }
    },
    // Every test gets the server and the screenshot, also a test that never names the fixture.
    { auto: true },
  ],
})

export { expect }

type Server = ChildProcessByStdio<null, Readable, Readable>

/** Waits for the line where the server prints its address. */
function addressOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error(`werk serve printed no address. stderr: ${err}`)), BOOT_TIMEOUT_MS)
    server.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
    server.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const m = out.match(/http:\/\/\S+\//)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    })
    server.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`werk serve exited ${code}. stderr: ${err}`))
    })
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
