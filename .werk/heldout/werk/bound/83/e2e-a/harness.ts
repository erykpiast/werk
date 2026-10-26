/**
 * Held-out harness. Like e2e/harness.ts, but a test can seed its own log (JSON lines), and the
 * server's pid is exposed. The project is a temporary git repository with the fake agent on PATH.
 */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

export const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')

export type Server = ChildProcessByStdio<null, Readable, Readable>

export type Werk = {
  url: string
  dir: string
  env: Record<string, string>
  pid: number
  cli: (args: string[]) => string
  cliRaw: (args: string[]) => { status: number | null; stdout: string; stderr: string }
  log: () => { seq: number; type: string; actor: string; payload: Record<string, unknown> }[]
}

type Ev = { type: string; payload: Record<string, unknown>; actor?: string }

/** Turns events into log lines with seq and time. */
export function seedLog(events: Ev[]): string {
  return events
    .map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: e.actor ?? 'agent', type: e.type, payload: e.payload }))
    .join('\n') + '\n'
}

export const prop = (id: string, title: string, extra: Record<string, unknown> = {}): Ev => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title, ...extra },
})
export const acc = (id: string): Ev => ({ type: 'node.accepted', payload: { id }, actor: 'you' })
export const lnk = (from: string, to: string, type: string): Ev => ({ type: 'edge.linked', payload: { from, to, type } })
/** A real decided card with every contract fact. */
export const decidedCard = (id: string, title: string, extra: Record<string, unknown> = {}): Ev[] => [
  prop(id, title, { status: 'decided', who: 'me', ...extra }),
  acc(id),
  { type: 'kill.recorded', payload: { id, criterion: { form: 'revisit' } } },
]

export const test = base.extend<{ seed: string | null; werk: Werk }>({
  seed: [null, { option: true }],
  werk: [
    async ({ page, seed }, use, testInfo) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      if (seed) {
        mkdirSync(join(dir, '.werk'), { recursive: true })
        writeFileSync(join(dir, '.werk', 'log.jsonl'), seed)
      } else cpSync(FIXTURE, dir, { recursive: true })
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
      const cliRaw = (args: string[]) => {
        const r = spawnSync('bun', [MAIN, ...args], { cwd: dir, env, encoding: 'utf8' })
        return { status: r.status, stdout: r.stdout, stderr: r.stderr }
      }
      const cli = (args: string[]) => {
        const r = cliRaw(args)
        if (r.status !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
        return r.stdout
      }
      const g = (args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: dir, env })
      g(['init', '--quiet', '--initial-branch=main'])
      g(['add', '.'])
      g(['commit', '--quiet', '-m', 'fixture'])

      const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        const url = await addressOf(server)
        const host = new URL(url).host
        await page.context().route('**/*', (route) =>
          new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient'),
        )
        await page.goto(url)
        const log = () =>
          readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
        try {
          await use({ url, dir, env, pid: server.pid!, cli, cliRaw, log })
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
  const t = setTimeout(() => server.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(t)
}
