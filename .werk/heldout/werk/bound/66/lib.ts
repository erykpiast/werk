/** Held-out helpers: a temporary project, the werk command line, and the log. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../src/test/harness.ts'
import type { Event, NewEvent, Actor } from '../src/map/events.ts'
import { fold, type MapState } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import { refinesTree, toGraph, type TreeNode } from '../src/map/graph.ts'

export type P = Project & {
  w: (...args: string[]) => RunResult
  logPath: string
  lines: () => string[]
  events: () => Event[]
  state: () => MapState
  seed: (...events: (NewEvent & { actor?: Actor })[]) => void
  /** Runs a printed command line through sh, with `werk` on the PATH. */
  sh: (cmd: string) => RunResult
}

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

export function project(): P {
  const p = makeProject()
  const logPath = join(p.dir, '.werk', 'log.jsonl')
  const bin = join(dirname(p.dir), 'bin')
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)
  const lines = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : [])
  return {
    ...p,
    logPath,
    w: (...args) => p.werk(args),
    lines,
    events: () => readLog<Event>(logPath),
    state: () => fold(readLog<Event>(logPath)),
    seed: (...events) => {
      mkdirSync(dirname(logPath), { recursive: true })
      const start = lines().length
      const text = events
        .map((e, i) => JSON.stringify({ actor: 'agent', ...e, seq: start + i + 1, at: new Date().toISOString() }))
        .join('\n')
      writeFileSync(logPath, (start ? readFileSync(logPath, 'utf8') : '') + text + '\n')
    },
    sh: (cmd) => p.run(['sh', '-c', cmd]),
  }
}

/** The ids of the children of `id` in the refines tree of the map. */
export function childrenIn(state: MapState, id: string): string[] {
  const find = (trees: TreeNode[]): TreeNode | undefined => {
    for (const t of trees) {
      if (t.node.id === id) return t
      const f = find(t.children)
      if (f) return f
    }
    return undefined
  }
  return find(refinesTree(toGraph(state)))?.children.map((c) => c.node.id) ?? []
}

export const ok = (r: RunResult) => {
  if (r.code !== 0) throw new Error(`exit ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  return r
}
