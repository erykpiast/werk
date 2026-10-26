import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'

export type Ctx = { p: Project }

export const ctx: Ctx = { p: undefined as unknown as Project }
export const fresh = () => (ctx.p = makeProject())

export const logFile = () => join(ctx.p.dir, '.werk', 'log.jsonl')
export const logLines = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8').split('\n').filter(Boolean) : [])
export const logEvents = () => logLines().map((l) => JSON.parse(l))

export const werk = (args: string[]): RunResult => ctx.p.werk(args)
export const ok = (args: string[]): string => {
  const r = werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r.stdout
}
export const show = (id: string) => werk(['show', id]).stdout

/** The graph the map view draws (GET /api/graph): the fold of the log with its marks. */
export const graph = () => graphOf(readLog(logFile()))
export const markOf = (id: string) => graph().marks[id]?.mark
export const childrenOnMap = (id: string): string[] => {
  const find = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const n of nodes) {
      if (n.node.id === id) return n
      const f = find(n.children)
      if (f) return f
    }
  }
  return find(refinesTree(graph()))?.children.map((c) => c.node.id) ?? []
}
export const onMap = (id: string) => graph().nodes.some((n) => n.id === id)

/** A real card, accepted by the person. */
export const realCard = (id: string, title: string, extra: string[] = []) => {
  ok(['add', id, '--title', title, ...extra])
  ok(['accept', id, '--actor', 'you'])
}

/** A real decided card. `deps` are depends_on targets; without deps or parent it records a no-basis reason. */
export const decidedCard = (id: string, title: string, opts: { deps?: string[]; parent?: string } = {}) => {
  realCard(id, title, opts.parent ? ['--parent', opts.parent] : [])
  ok(['edit', id, '--who', 'me'])
  for (const d of opts.deps ?? []) ok(['link', id, d, '--type', 'depends_on', '--why', `${id} takes ${d}`])
  if (!opts.deps?.length && !opts.parent) ok(['edit', id, '--no-basis', 'a root card'])
  ok(['kill', id, '--form', 'revisit'])
  ok(['status', id, 'decided'])
}

/** The printed fix commands: lines that start with `werk` after an indent. */
export const printedCommands = (text: string) =>
  text
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

/** Runs a printed line the way a shell would: double-quoted words and `&&` between commands. */
export const runPrinted = (line: string) => {
  for (const command of line.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('werk')
    ok(words.slice(1))
  }
}
