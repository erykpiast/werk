import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

export type P = Project & {
  lines: () => string[]
  events: () => { type: string; payload: Record<string, unknown>; actor: string }[]
  ok: (args: string[]) => string
  show: (id: string) => string
}

export function project(): P {
  const p = makeProject()
  const file = join(p.dir, '.werk', 'log.jsonl')
  const lines = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])
  const ok = (args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
    return r.stdout
  }
  return {
    ...p,
    lines,
    events: () => lines().map((l) => JSON.parse(l)),
    ok,
    show: (id) => {
      const r = p.werk(['show', id])
      return r.stdout + r.stderr
    },
  }
}

/** A real card, proposed and accepted by the person. */
export function realCard(p: P, id: string, title: string, extra: string[] = []) {
  p.ok(['add', id, '--title', title, ...extra])
  p.ok(['accept', id, '--actor', 'you'])
}

import { graphOf } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'
import { rollup } from '../../src/map/derive.ts'
import { fold } from '../../src/map/fold.ts'

/** The graph the server sends to the map view at /api/graph. */
export const graph = (p: P) => graphOf(readLog(join(p.dir, '.werk', 'log.jsonl')))
export const state = (p: P) => fold(readLog(join(p.dir, '.werk', 'log.jsonl')))
export const rollupOf = (p: P, id: string) => rollup(state(p), id)

/** Gives a card every contract fact and decides it: the person decides, no basis applies, no option, a kill criterion. */
export function decide(p: P, id: string) {
  p.ok(['edit', id, '--who', 'you', '--no-basis', 'it is a root decision'])
  p.ok(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  p.ok(['status', id, 'decided', '--unchallenged'])
}
