/** A werk server on a copy of the fixture project, run from a copy of the app, optionally under bun --hot (dev mode). */
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { copyApp, type AppCopy } from '../../src/test/app-copy.ts'
import type { FakeScript } from '../../src/test/fake-agent.ts'
import { writeFakeAgent } from '../../src/test/fake-bin.ts'

const FIXTURE = join(import.meta.dirname, '..', '..', 'e2e', 'fixture-project')

export type DevServer = { url: string; port: number; pid: number; stderr: () => string; stop: () => Promise<void> }

export type Dev = {
  dir: string
  app: AppCopy
  scriptAgent: (s: FakeScript) => void
  launches: () => { argv: string[]; role?: string; pid: number }[]
  start: (opts: { hot?: boolean; port?: number }) => Promise<DevServer>
  cleanup: () => Promise<void>
}

export function makeDev(): Dev {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-dev-'))
  const app = copyApp()
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  cpSync(FIXTURE, dir, { recursive: true })
  writeFakeAgent(bin, app.fakeAgent)
  const scriptPath = join(root, 'agent-script.json')
  const launchLog = join(root, 'agent-launches.jsonl')
  writeFileSync(launchLog, '')
  writeFileSync(join(root, 'agent-input.jsonl'), '')
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: scriptPath,
    WERK_FAKE_AGENT_LOG: launchLog,
    WERK_FAKE_AGENT_INPUT: join(root, 'agent-input.jsonl'),
  }
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, env })
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'werk test')
  git('config', 'user.email', 'test@werk.invalid')
  git('add', '.')
  git('commit', '--quiet', '-m', 'The fixture')
  const servers: DevServer[] = []
  const start = ({ hot = false, port = 0 }: { hot?: boolean; port?: number }) =>
    new Promise<DevServer>((resolve, reject) => {
      const proc: ChildProcessByStdio<null, Readable, Readable> = spawn(
        'bun',
        [...(hot ? ['--hot'] : []), app.main, 'serve', '--port', String(port)],
        { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let out = ''
      let err = ''
      const stop = async () => {
        if (proc.exitCode !== null || proc.signalCode !== null) return
        const exited = new Promise((r) => proc.once('exit', r))
        proc.kill('SIGTERM')
        const t = setTimeout(() => proc.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(t)
      }
      const timer = setTimeout(() => reject(new Error(`no address. stderr: ${err}`)), 30_000)
      proc.stderr.on('data', (c: Buffer) => (err += c.toString()))
      proc.stdout.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) {
          clearTimeout(timer)
          const s = { url: m[0], port: Number(new URL(m[0]).port), pid: proc.pid!, stderr: () => err, stop }
          servers.push(s)
          resolve(s)
        }
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`serve exited ${code}: ${err}`))
      })
    })
  return {
    dir,
    app,
    scriptAgent: (s) => writeFileSync(scriptPath, JSON.stringify(s)),
    launches: () =>
      readFileSync(launchLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    start,
    cleanup: async () => {
      for (const s of servers) await s.stop()
      rmSync(root, { recursive: true, force: true })
      app.remove()
    },
  }
}
