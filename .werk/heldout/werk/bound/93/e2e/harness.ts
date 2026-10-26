/**
 * Held-out browser harness. A copy of e2e/harness.ts with two changes:
 * - `seed` option: 'fixture' copies e2e/fixture-project, 'empty' starts with no log.
 * - the page does NOT open automatically. The test calls `await page.goto(werk.url)` when the
 *   person opens the map, so the Given steps can run on the command line first.
 * `werk.cliRaw` runs the command line and returns code/stdout/stderr without throwing.
 */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')
const BOOT_TIMEOUT_MS = 20_000

export type Werk = {
  url: string
  dir: string
  root: string
  env: Record<string, string>
  cli: (args: string[]) => string
  cliRaw: (args: string[]) => { code: number | null; stdout: string; stderr: string }
}

export const test = base.extend<{ seed: 'fixture' | 'empty'; werk: Werk }>({
  seed: ['empty', { option: true }],
  werk: [
    async ({ page, seed }, use, testInfo) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      if (seed === 'fixture') cpSync(FIXTURE, dir, { recursive: true })
      else mkdirSync(join(dir, '.werk'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        TMPDIR: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
      }
      const runRaw = (cmd: string, args: string[]) => {
        const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
        return { code: r.status, stdout: r.stdout, stderr: r.stderr }
      }
      const run = (cmd: string, args: string[]) => {
        const r = runRaw(cmd, args)
        if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
        return r.stdout
      }
      run('git', ['init', '--quiet', '--initial-branch=main'])
      run('git', ['-c', 'user.name=werk test', '-c', 'user.email=test@werk.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'start'])

      const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        const url = await addressOf(server)
        const host = new URL(url).host
        await page.context().route('**/*', (route) =>
          new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient'),
        )
        await page.addInitScript(() => {
          if (sessionStorage.getItem('werk-test-cleared')) return
          localStorage.clear()
          sessionStorage.setItem('werk-test-cleared', '1')
        })
        try {
          await use({ url, dir, root, env, cli: (args) => run('bun', [MAIN, ...args]), cliRaw: (args) => runRaw('bun', [MAIN, ...args]) })
        } finally {
          await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
        }
      } finally {
        await stop(server)
        rmSync(root, { recursive: true, force: true })
      }
    },
    { auto: true },
  ],
})

export { expect }

type Server = ChildProcessByStdio<null, Readable, Readable>

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
