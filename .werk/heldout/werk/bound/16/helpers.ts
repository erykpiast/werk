// Shared helpers for the held-out tests. Node side (Playwright) and Bun side both import it.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = join(HERE, '..')
export const CLI = join(REPO, 'src', 'cli.ts')

/** A scratch project dir with a .werk/ and a fake `claude` bin dir. */
export function project(prefix = 'werk-heldout-'): { dir: string; log: string; bin: string; fakeLog: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(dir, '.werk'), { recursive: true })
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(join(REPO, 'src', 'test', 'fake-claude.ts'))} "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  return { dir, log: join(dir, '.werk', 'log.jsonl'), bin, fakeLog: join(dir, 'fake.jsonl') }
}

export type Card = { id: string; title?: string; body?: string; why?: string; status?: string; who?: string; parent?: string; dependsOn?: string[]; kind?: string; noBasis?: boolean; extra?: Record<string, unknown> }

/** Write a log of real (accepted) cards: the "Given a map with ..." state. */
export function writeCards(log: string, cards: Card[], extra: Array<{ type: string; payload: unknown; actor?: string }> = []) {
  const events: Array<{ type: string; payload: unknown; actor?: string }> = []
  for (const c of cards) {
    const payload: Record<string, unknown> = { id: c.id, kind: c.kind ?? 'card', title: c.title ?? c.id }
    if (c.body !== undefined) payload.body = c.body
    if (c.why !== undefined) payload.why = c.why
    if ((c.kind ?? 'card') === 'card') payload.status = c.status ?? 'open'
    if (c.who) payload.who = c.who
    if (c.noBasis) payload.noBasis = true
    Object.assign(payload, c.extra ?? {})
    events.push({ type: 'node.added', payload })
    if (c.parent) events.push({ type: 'edge.added', payload: { from: c.id, to: c.parent, type: 'refines' } })
    for (const d of c.dependsOn ?? []) events.push({ type: 'edge.added', payload: { from: c.id, to: d, type: 'depends_on', why: `${c.id} takes from ${d}` } })
  }
  events.push(...extra)
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-01T10:00:00.000Z', actor: e.actor ?? 'agent', type: e.type, payload: e.payload }))
  mkdirSync(dirname(log), { recursive: true })
  writeFileSync(log, lines.join('\n') + '\n')
}

export function events(log: string): any[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export function cli(p: { dir: string; log: string; bin: string; fakeLog?: string }, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bun', [CLI, ...args], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, WERK_LOG: p.log, WERK_BOARD: join(p.dir, '.werk', 'board.jsonl'), WERK_PIPELINE: join(p.dir, '.werk', 'pipeline.jsonl'), PATH: `${p.bin}:${process.env.PATH}`, FAKE_CLAUDE_LOG: p.fakeLog ?? '', ...env },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr }
}

export type Server = { url: string; proc: ChildProcess; out: () => string; stop: () => Promise<void> }

/** `werk serve --port <port>` in the project dir, as a user would start it. */
export async function serve(p: { dir: string; log: string; bin: string; fakeLog?: string }, port: number, opts: { args?: string[]; cmd?: string[]; env?: Record<string, string> } = {}): Promise<Server> {
  let out = ''
  const cmd = opts.cmd ?? ['bun', CLI, 'serve', '--port', String(port), ...(opts.args ?? [])]
  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: p.dir,
    env: { ...process.env, WERK_LOG: p.log, WERK_BOARD: join(p.dir, '.werk', 'board.jsonl'), WERK_PIPELINE: join(p.dir, '.werk', 'pipeline.jsonl'), PATH: `${p.bin}:${process.env.PATH}`, FAKE_CLAUDE_LOG: p.fakeLog ?? '', ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout!.on('data', (d) => (out += d.toString()))
  proc.stderr!.on('data', (d) => (out += d.toString()))
  const until = Date.now() + 15000
  while (!out.includes(`werk map on http://localhost:${port}`)) {
    if (proc.exitCode !== null || Date.now() > until) throw new Error(`server did not start:\n${out}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  return {
    url: `http://localhost:${port}`,
    proc,
    out: () => out,
    stop: async () => {
      if (proc.exitCode !== null) return
      const done = new Promise((r) => proc.on('exit', r))
      proc.kill('SIGTERM')
      await Promise.race([done, new Promise((r) => setTimeout(r, 3000))])
      if (proc.exitCode === null) proc.kill('SIGKILL')
    },
  }
}
