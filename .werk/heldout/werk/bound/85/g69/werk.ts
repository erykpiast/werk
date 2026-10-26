/** A held-out helper: a temp project with a given log, and a real werk server on it. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')

export type Ev = { type: string; payload: Record<string, unknown>; actor?: 'you' | 'agent' }

export type Proj = {
  dir: string
  env: Record<string, string>
  cli: (args: string[]) => { code: number; stdout: string; stderr: string }
  log: () => { type: string; actor: string; payload: Record<string, unknown> }[]
  serve: () => Promise<Server>
  cleanup: () => void
}
export type Server = { url: string; proc: ChildProcess; out: () => string; err: () => string; stop: () => Promise<void> }

export function project(events: Ev[] = []): Proj {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  mkdirSync(join(dir, '.werk'), { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: e.actor ?? 'agent', type: e.type, payload: e.payload }))
  writeFileSync(join(dir, '.werk', 'log.jsonl'), lines.length ? lines.join('\n') + '\n' : '')
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
  }
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir, env })
  const cli = (args: string[]) => {
    const r = spawnSync('bun', [MAIN, ...args], { cwd: dir, env, encoding: 'utf8' })
    return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
  }
  const servers: Server[] = []
  return {
    dir,
    env,
    cli,
    log: () => readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    serve: async () => {
      const s = await serveIn(dir, env)
      servers.push(s)
      return s
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

export function spawnServe(dir: string, env: Record<string, string>) {
  const proc = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  proc.stdout!.on('data', (c: Buffer) => (out += c.toString()))
  proc.stderr!.on('data', (c: Buffer) => (err += c.toString()))
  const stop = async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    const exited = new Promise((r) => proc.once('exit', r))
    proc.kill('SIGTERM')
    const t = setTimeout(() => proc.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(t)
  }
  return { proc, out: () => out, err: () => err, stop }
}

async function serveIn(dir: string, env: Record<string, string>): Promise<Server> {
  const s = spawnServe(dir, env)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const m = s.out().match(/http:\/\/\S+\//)
    if (m) return { ...s, url: m[0] }
    if (s.proc.exitCode !== null) throw new Error(`serve exited: ${s.err()}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`serve printed no address: ${s.err()}`)
}

// Event builders
export const card = (id: string, title: string, extra: Record<string, unknown> = {}): Ev[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...extra } },
  { type: 'node.accepted', payload: { id }, actor: 'you' },
]
export const ghost = (id: string, title: string, extra: Record<string, unknown> = {}): Ev[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...extra } },
]
export const link = (from: string, to: string, type: string): Ev[] => [{ type: 'edge.linked', payload: { from, to, type } }]
export const say = (id: string, text: string): Ev[] => [{ type: 'note.said', payload: { id, text } }]
