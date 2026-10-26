import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../../src/map/events.ts'
import type { Event } from '../../src/map/events.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, killed, logOf, noBasis, proposed, statusSet, whoSet } from '../../src/test/map-events.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])
export const events = (p: Project) => logLines(p).map((l) => JSON.parse(l) as Event)

/** A project whose log starts with the given events (the Given part). */
export function projectWith(...evs: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), logOf(...evs).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

/** A real card, optionally under a parent, with status. Decided cards get the four facts first. */
export function realCard(id: string, title: string, opts: { parent?: string; status?: 'open' | 'proto' | 'decided' } = {}): NewEvent[] {
  const evs: NewEvent[] = [proposed(id, { title, ...(opts.parent && { parent: opts.parent }) }), accepted(id)]
  if (opts.status === 'decided') evs.push(whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided'))
  else if (opts.status) evs.push(statusSet(id, opts.status))
  return evs
}

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect({ args, code: r.code, stderr: r.stderr }).toEqual({ args, code: 0, stderr: '' })
  return r.stdout
}

/** The map as the browser draws it: the graph the server sends, and its refines tree. */
export const graph = (p: Project) => graphOf(events(p))
export const tree = (p: Project) => refinesTree(graph(p))
export function findTree(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.node.id === id) return n
    const f = findTree(n.children, id)
    if (f) return f
  }
}
export const childIds = (p: Project, id: string) => findTree(tree(p), id)?.children.map((c) => c.node.id)
export const mark = (p: Project, id: string) => graph(p).marks[id]?.mark
