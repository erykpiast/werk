/** Shared helpers for the held-out command-line tests. They use the product's own test harness. */
import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Event, NewEvent } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { logOf } from '../../src/test/map-events.ts'

export { makeProject, type Project }
export * from '../../src/test/map-events.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')

export const logLines = (p: Project): string[] =>
  existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : []

export const events = (p: Project): Event[] => readLog<Event>(logFile(p))

/** Writes a log made of the given events, as a Given. */
export function seed(p: Project, ...evs: (NewEvent & { actor?: 'you' | 'agent' })[]): void {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), logOf(...evs).map((e) => JSON.stringify(e)).join('\n') + '\n')
}

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}

export const state = (p: Project) => fold(events(p))
export const graph = (p: Project) => graphOf(events(p))

/** The ids of the tree nodes directly under `id` in the map's refines tree. */
export function childrenInMap(p: Project, id: string): string[] {
  const find = (trees: TreeNode[]): TreeNode | undefined => {
    for (const t of trees) {
      if (t.node.id === id) return t
      const f = find(t.children)
      if (f) return f
    }
    return undefined
  }
  return find(refinesTree(graph(p)))?.children.map((c) => c.node.id) ?? []
}

/** Asserts that a call appended exactly one line at the end and left every earlier line unchanged. */
export function expectOneMore(before: string[], after: string[]) {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}
