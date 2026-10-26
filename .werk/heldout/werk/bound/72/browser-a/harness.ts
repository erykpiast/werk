/** Held-out harness: like e2e/harness.ts, but a test may give its own log before the server starts. */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')

export type Ev = { type: string; actor?: 'you' | 'agent'; payload: Record<string, unknown> }
export type Server = ChildProcessByStdio<null, Readable, Readable>
export type Werk = {
  url: string
  dir: string
  env: Record<string, string>
  pid: number
  cli: (args: string[]) => string
  logLines: () => { type: string; actor: string; payload: Record<string, unknown> }[]
}

export const test = base.extend<{ log: { events: Ev[] } | undefined; werk: Werk }>({
  log: [undefined, { option: true }],
  werk: [
    async ({ page, log }, use, testInfo) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      cpSync(FIXTURE, dir, { recursive: true })
      if (log) {
        const lines = log.events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: e.actor ?? 'agent', type: e.type, payload: e.payload }))
        writeFileSync(join(dir, '.werk', 'log.jsonl'), lines.join('\n') + '\n')
      }
      mkdirSync(bin)
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))
      const env: Record<string, string> = {
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
      run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'add', '.'])
      run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '--quiet', '-m', 'fixture'])
      const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        const url = await addressOf(server)
        await page.goto(url)
        try {
          await use({
            url,
            dir,
            env,
            pid: server.pid!,
            cli: (args) => run('bun', [MAIN, ...args]),
            logLines: () =>
              readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)),
          })
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

export function addressOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error(`no address. stderr: ${err}`)), 20_000)
    server.stderr.on('data', (c: Buffer) => (err += c.toString()))
    server.stdout.on('data', (c: Buffer) => {
      out += c.toString()
      const m = out.match(/http:\/\/\S+\//)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    })
    server.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`serve exited ${code}. stderr: ${err}`))
    })
  })
}

export async function stop(server: Server): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  const t = setTimeout(() => server.kill('SIGKILL'), 5_000)
  await exited
  clearTimeout(t)
}

/** Events for a real card, proposed then accepted. */
export const real = (id: string, title: string, extra: Record<string, unknown> = {}): Ev[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...extra } },
  { type: 'node.accepted', actor: 'you', payload: { id } },
]
export const ghost = (id: string, title: string, extra: Record<string, unknown> = {}): Ev[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...extra } },
]
export const dep = (from: string, to: string): Ev => ({ type: 'edge.linked', payload: { from, to, type: 'depends_on' } })
export const card = (id: string) => `li[data-card-id="${id}"]`
