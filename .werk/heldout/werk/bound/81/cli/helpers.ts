/** Held-out helpers. They use the product's own command-line harness, and read the log as a file. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'

const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export type P = Project & {
  logFile: string
  lines: () => string[]
  events: () => any[]
  show: (id: string) => RunResult
  sh: (cmd: string) => RunResult
  claudeDir: string
}

/** A project. `log` is written as the Given state, one event per line. */
export function project(log: object[] = []): P {
  const p = makeProject()
  const logFile = join(p.dir, '.werk', 'log.jsonl')
  if (log.length > 0) {
    mkdirSync(dirname(logFile), { recursive: true })
    const at = '2026-10-21T00:00:00.000Z'
    writeFileSync(logFile, log.map((e, i) => JSON.stringify({ seq: i + 1, at, actor: 'agent', ...e })).join('\n') + '\n')
  }
  // A `werk` program on the PATH, so a printed `werk ...` command runs as printed.
  const bin = p.env.PATH!.split(':')[0]!
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)
  const lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l !== '') : [])
  return {
    ...p,
    logFile,
    lines,
    events: () => lines().map((l) => JSON.parse(l)),
    show: (id) => p.werk(['show', id]),
    sh: (cmd) => p.run(['/bin/sh', '-c', cmd]),
    claudeDir: join(p.env.HOME!, '.claude'),
  }
}

export const prop = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title, ...extra },
})
export const acc = (id: string) => ({ type: 'node.accepted', payload: { id } })
export const lnk = (from: string, to: string, type: string) => ({ type: 'edge.linked', payload: { from, to, type } })
export const kil = (id: string) => ({ type: 'kill.recorded', payload: { id, criterion: { form: 'revisit' } } })
export const stat = (id: string, status: string) => ({ type: 'node.status_set', payload: { id, status } })

/** Soft checks: each failed check is recorded, and the test fails at the end with all of them. */
export function soft() {
  const problems: string[] = []
  return {
    problems,
    check(ok: boolean, what: string) {
      if (!ok) problems.push(what)
    },
  }
}

export const out = (r: RunResult) => r.stdout + r.stderr
