/** A held-out harness: a temp project with a given log, a real werk server, a screenshot per test. */
import { test as base, expect, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

export const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')

export type Srv = ChildProcessByStdio<null, Readable, Readable> & { out: string; err: string }
export type Proj = {
  dir: string
  env: Record<string, string>
  url: string
  server: Srv
  cli: (args: string[]) => { code: number; stdout: string; stderr: string }
  ok: (args: string[]) => string
  log: () => { seq: number; type: string; actor: string; payload: Record<string, unknown> }[]
  spawnServer: () => Srv
}

type Ev = Record<string, unknown>
export const P = (id: string, extra: Ev = {}): Ev => ({ type: 'node.proposed', payload: { id, kind: 'card', title: `Title ${id}`, ...extra } })
export const A = (id: string): Ev => ({ type: 'node.accepted', actor: 'you', payload: { id } })
export const L = (from: string, to: string, type: string): Ev => ({ type: 'edge.linked', payload: { from, to, type } })
export const real = (id: string, extra: Ev = {}): Ev[] => [P(id, extra), A(id)]

export const test = base.extend<{ boot: (events: Ev[]) => Promise<Proj> }>({
  boot: async ({ page }, use, testInfo) => {
    const cleanups: (() => Promise<void> | void)[] = []
    await use(async (events) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-ho-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      mkdirSync(join(dir, '.werk'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))
      const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e }))
      writeFileSync(join(dir, '.werk', 'log.jsonl'), lines.map((l) => l + '\n').join(''))
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        TMPDIR: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
      }
      const sh = (cmd: string, args: string[]) => {
        const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
        return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
      }
      sh('git', ['init', '--quiet', '--initial-branch=main'])
      sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'add', '.'])
      sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '--quiet', '-m', 'fixture'])
      const spawnServer = (): Srv => {
        const s = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }) as Srv
        s.out = ''
        s.err = ''
        s.stdout.on('data', (c: Buffer) => (s.out += c.toString()))
        s.stderr.on('data', (c: Buffer) => (s.err += c.toString()))
        cleanups.push(() => stop(s))
        return s
      }
      const server = spawnServer()
      const url = await addressOf(server)
      const host = new URL(url).host
      await page.context().route('**/*', (route) =>
        new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient'),
      )
      cleanups.push(() => rmSync(root, { recursive: true, force: true }))
      const cli = (args: string[]) => sh('bun', [MAIN, ...args])
      return {
        dir,
        env,
        url,
        server,
        spawnServer,
        cli,
        ok: (args) => {
          const r = cli(args)
          if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
          return r.stdout
        },
        log: () =>
          readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l)),
      }
    })
    await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
    // stop servers first (cleanups pushed in order: server, root...), reverse would remove root first
    for (const c of cleanups.filter((_, i) => i % 1 === 0)) await c()
  },
})

export { expect, type Page }

function addressOf(server: Srv): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no address. stderr: ${server.err}`)), 20_000)
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
      reject(new Error(`serve exited ${code}: ${server.err}`))
    })
  })
}

export async function stop(server: Srv): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  const t = setTimeout(() => server.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(t)
}

export const tile = (id: string) => `li[data-card-id="${id}"]`
