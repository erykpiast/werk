/** Held-out test helpers. WERK_ROOT names the checkout under test (a temp clone with deps installed). */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const WERK_ROOT = process.env.WERK_ROOT ?? join(import.meta.dir, '..')
export const MAIN = join(WERK_ROOT, 'src', 'cli', 'main.ts')
const BUN = process.execPath

export type RunResult = { code: number; stdout: string; stderr: string; out: string }

export type Proj = {
  dir: string
  root: string
  env: Record<string, string>
  werk: (args: string[]) => RunResult
  sh: (cmd: string) => RunResult
  logPath: string
  logLines: () => string[]
  events: () => any[]
  writeLog: (events: object[]) => void
  cleanup: () => void
}

export function project(): Proj {
  const root = mkdtempSync(join(tmpdir(), 'werk-ho-proj-'))
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  mkdirSync(dir)
  mkdirSync(bin)
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(BUN)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)
  const env: Record<string, string> = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  }
  const run = (cmd: string[]): RunResult => {
    const p = Bun.spawnSync(cmd, { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
    const stdout = p.stdout.toString()
    const stderr = p.stderr.toString()
    return { code: p.exitCode ?? -1, stdout, stderr, out: stdout + stderr }
  }
  run(['git', 'init', '--quiet', '--initial-branch=main'])
  const logPath = join(dir, '.werk', 'log.jsonl')
  const logLines = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : [])
  return {
    dir,
    root,
    env,
    werk: (args) => run([BUN, MAIN, ...args]),
    sh: (cmd) => run(['/bin/sh', '-c', cmd]),
    logPath,
    logLines,
    events: () => logLines().map((l) => JSON.parse(l)),
    writeLog: (events) => {
      mkdirSync(join(dir, '.werk'), { recursive: true })
      const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e }))
      writeFileSync(logPath, lines.join('\n') + '\n')
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

// Event builders for seeding a Given state into the log.
export const proposed = (id: string, fields: Record<string, unknown> = {}) => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title: `title of ${id}`, ...fields },
})
export const accepted = (id: string) => ({ type: 'node.accepted', payload: { id }, actor: 'you' })
export const linked = (from: string, to: string, type: string, why?: string) => ({
  type: 'edge.linked',
  payload: { from, to, type, ...(why !== undefined && { why }) },
})
export const statusSet = (id: string, status: string, unchallenged?: true) => ({
  type: 'node.status_set',
  payload: { id, status, ...(unchallenged && { unchallenged }) },
})
export const edited = (id: string, fields: Record<string, string>) => ({ type: 'node.edited', payload: { id, ...fields } })
export const killed = (id: string) => ({
  type: 'kill.recorded',
  payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } },
})
