/**
 * The held-out browser harness. Each test seeds its own project (a git repository in a
 * temporary folder, with the fake agent first on PATH as `claude`), boots the real werk
 * server on it, and opens the map. It saves one screenshot per test.
 */
import { test as base, expect, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')

type Raw = Record<string, unknown>
export type Server = ChildProcessByStdio<null, Readable, Readable> & { err: () => string }

export type Werk = {
  url: string
  dir: string
  env: Record<string, string>
  server: Server
  cli: (args: string[]) => string
  run: (args: string[]) => { status: number | null; stdout: string; stderr: string }
  logLines: () => Raw[]
  boardLines: () => Raw[]
  scriptAgent: (script: unknown) => void
  /** Starts a server process on the project, the way a person does in a second shell. */
  spawnServer: () => Server
}

export type Boot = (seed?: { log?: Raw[]; board?: Raw[] }) => Promise<Werk>

const stamp = (events: Raw[]) => events.map((e, i) => JSON.stringify({ seq: i + 1, at: new Date(Date.UTC(2026, 9, 21, 0, 0, i)).toISOString(), actor: 'agent', ...e })).join('\n') + '\n'

export const test = base.extend<{ boot: Boot }>({
  boot: async ({ page }, use, testInfo) => {
    const cleanups: (() => Promise<void> | void)[] = []
    const boot: Boot = async (seed = {}) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      mkdirSync(join(dir, '.werk'), { recursive: true })
      mkdirSync(bin)
      if (seed.log) writeFileSync(join(dir, '.werk', 'log.jsonl'), stamp(seed.log))
      if (seed.board) writeFileSync(join(dir, '.werk', 'board.jsonl'), stamp(seed.board))
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      const script = join(root, 'agent-script.json')
      writeFileSync(script, JSON.stringify({ steps: [] }))
      const env: Record<string, string> = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        TMPDIR: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        WERK_FAKE_AGENT_SCRIPT: script,
      }
      const run = (args: string[], cmd = 'bun') => {
        const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
        return { status: r.status, stdout: r.stdout, stderr: r.stderr }
      }
      const git = (args: string[]) => {
        const r = run(['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], 'git')
        if (r.status !== 0) throw new Error(r.stderr)
      }
      git(['init', '--quiet', '--initial-branch=main'])
      git(['add', '.'])
      git(['commit', '--quiet', '--allow-empty', '-m', 'seed'])

      const spawnServer = (): Server => {
        const s = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }) as Server
        let err = ''
        s.stderr.on('data', (c: Buffer) => (err += c.toString()))
        s.err = () => err
        cleanups.push(() => stop(s))
        return s
      }
      const server = spawnServer()
      cleanups.push(() => rmSync(root, { recursive: true, force: true }))
      const url = await addressOf(server)
      const host = new URL(url).host
      await page.context().route('**/*', (route) => (new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient')))
      await page.goto(url)
      const lines = (name: string) => {
        try {
          return readFileSync(join(dir, '.werk', name), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Raw)
        } catch {
          return []
        }
      }
      return {
        url,
        dir,
        env,
        server,
        run: (args) => run([MAIN, ...args]),
        cli: (args) => {
          const r = run([MAIN, ...args])
          if (r.status !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
          return r.stdout
        },
        logLines: () => lines('log.jsonl'),
        boardLines: () => lines('board.jsonl'),
        scriptAgent: (s) => writeFileSync(script, JSON.stringify(s)),
        spawnServer,
      }
    }
    try {
      await use(boot)
    } finally {
      await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
      for (const c of cleanups.reverse()) await c()
    }
  },
})

export { expect, type Page }

export function addressOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`werk serve printed no address. stderr: ${server.err()}`)), 30_000)
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
      reject(new Error(`werk serve exited ${code}. stderr: ${server.err()}`))
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

/** Seed events. */
export const node = (id: string, title: string, fields: Raw = {}): Raw => ({ type: 'node.proposed', payload: { id, kind: 'card', title, ...fields } })
export const accept = (id: string): Raw => ({ type: 'node.accepted', actor: 'you', payload: { id } })
export const real = (id: string, title: string, fields: Raw = {}): Raw[] => [node(id, title, fields), accept(id)]
export const link = (from: string, to: string, type: string): Raw => ({ type: 'edge.linked', payload: { from, to, type } })
export const note = (id: string, text: string): Raw => ({ type: 'note.said', payload: { id, text } })

export const card = (id: string) => `li[data-card-id="${id}"]`
