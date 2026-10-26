/** Shared helpers for the held-out command-line tests. */
import { afterEach, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'
import { readLog } from '../../src/map/log.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

export function project(): Project {
  const p = makeProject()
  cleanups.push(p.cleanup)
  return p
}

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')

export const lines = (p: Project): string[] =>
  existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : []

export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; actor: string; payload: Record<string, unknown> })

/** Runs werk and expects exit 0. */
export function ok(p: Project, args: string[]): RunResult {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}

/** Runs a command and checks that it appended exactly one line at the end, with every earlier line unchanged. */
export function appendsOne(p: Project, args: string[]): RunResult {
  const before = lines(p)
  const r = p.werk(args)
  const after = lines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}

/** Runs a command and checks that it failed and appended nothing. */
export function refusesNoEvent(p: Project, args: string[]): RunResult {
  const before = lines(p)
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(lines(p)).toEqual(before)
  return r
}

/** The map as the server sends it: the graph of the log, with its marks. */
export const graph = (p: Project) => graphOf(readLog(logFile(p)) as never)

/** The ids of the children of `id` in the refines tree of the map. */
export function childrenInMap(p: Project, id: string): string[] {
  const find = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const n of nodes) {
      if (n.node.id === id) return n
      const f = find(n.children)
      if (f) return f
    }
    return undefined
  }
  return find(refinesTree(graph(p)))?.children.map((c) => c.node.id) ?? []
}

export const inMap = (p: Project, id: string) => graph(p).nodes.some((n) => n.id === id)
export const markOf = (p: Project, id: string) => graph(p).marks[id]?.mark
export const statusInMap = (p: Project, id: string) => graph(p).nodes.find((n) => n.id === id)?.status
export const proposedInMap = (p: Project, id: string) => graph(p).nodes.find((n) => n.id === id)?.proposed

export const show = (p: Project, id: string) => p.werk(['show', id])

/** A real card: proposed, then accepted by the person. */
export function realCard(p: Project, id: string, title = `Title of ${id}`, parent?: string): void {
  ok(p, ['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
  ok(p, ['accept', id, '--actor', 'you'])
}

/**
 * A real decided card. Its basis is its depends_on targets, or its parent, or a no-basis reason.
 * Its decider is "me", so no option is needed. Its kill criterion is revisit.
 */
export function decidedCard(p: Project, id: string, opts: { dependsOn?: string[]; parent?: string; title?: string } = {}): void {
  realCard(p, id, opts.title ?? `Title of ${id}`, opts.parent)
  ok(p, ['edit', id, '--who', 'me'])
  for (const d of opts.dependsOn ?? []) ok(p, ['link', id, d, '--type', 'depends_on'])
  if (!opts.dependsOn?.length && !opts.parent) ok(p, ['edit', id, '--no-basis', 'a root card'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}
