/** Shared helpers for the held-out command-line tests. They drive the real `werk` process. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../src/test/harness.ts'
import type { Event } from '../src/map/events.ts'

export const ROOT = join(import.meta.dir, '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

export type P = Project & {
  logPath: string
  lines: () => string[]
  events: () => Event[]
  writeLog: (events: object[]) => void
  sh: (command: string) => RunResult
}

export function project(): P {
  const p = makeProject()
  // A `werk` program on the project's PATH, so a printed `werk ...` command runs as printed.
  const bin = p.env.PATH!.split(':')[0]!
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)
  const logPath = join(p.dir, '.werk', 'log.jsonl')
  const lines = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : [])
  return {
    ...p,
    logPath,
    lines,
    events: () => lines().map((l) => JSON.parse(l) as Event),
    writeLog(events) {
      mkdirSync(join(p.dir, '.werk'), { recursive: true })
      const withSeq = events.map((e, i) => ({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e }))
      writeFileSync(logPath, withSeq.map((e) => JSON.stringify(e)).join('\n') + '\n')
    },
    sh: (command) => p.run(['sh', '-c', command]),
  }
}

/** Event builders for a Given state. */
export const proposed = (id: string, fields: Record<string, unknown> = {}) => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title: `title of ${id}`, ...fields },
})
export const accepted = (id: string) => ({ type: 'node.accepted', actor: 'you', payload: { id } })
export const linked = (from: string, to: string, type: string) => ({ type: 'edge.linked', payload: { from, to, type } })
export const killed = (id: string) => ({
  type: 'kill.recorded',
  payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } },
})

/** Starts `werk serve` on the project, reads GET /api/graph, and stops the server. */
export async function graphOf(p: Project): Promise<{ nodes: any[]; edges: any[]; ghostEdges: any[] }> {
  const server = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  try {
    const reader = server.stdout.getReader()
    let out = ''
    const deadline = Date.now() + 20_000
    let url: string | undefined
    while (!url && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
      url = out.match(/http:\/\/\S+\//)?.[0]
    }
    if (!url) throw new Error(`werk serve printed no address: ${out}`)
    const res = await fetch(url + 'api/graph')
    return (await res.json()) as any
  } finally {
    server.kill('SIGTERM')
    await server.exited
  }
}
