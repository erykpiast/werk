import { expect, setDefaultTimeout } from 'bun:test'
setDefaultTimeout(120_000)
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { graphOf, refinesTree, type TreeNode } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'

export type P = Project & {
  ok: (args: string[]) => string
  logLines: () => string[]
  graph: () => ReturnType<typeof graphOf>
  childrenOf: (id: string) => string[]
  card: (id: string, opts?: { parent?: string; status?: string; title?: string; body?: string }) => void
  decided: (id: string, deps?: string[], opts?: { parent?: string; title?: string }) => void
  writeSession: (session: string, lines: unknown[]) => void
}

export function project(): P {
  const p = makeProject() as P
  p.ok = (args) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
    return r.stdout
  }
  const log = join(p.dir, '.werk', 'log.jsonl')
  p.logLines = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
  // The map data: the same graph the server sends on GET /api/graph.
  p.graph = () => graphOf(readLog(log))
  p.childrenOf = (id) => {
    const find = (ts: TreeNode[]): TreeNode | undefined => {
      for (const t of ts) {
        if (t.node.id === id) return t
        const f = find(t.children)
        if (f) return f
      }
    }
    return find(refinesTree(p.graph()))?.children.map((c) => c.node.id) ?? []
  }
  p.card = (id, o = {}) => {
    p.ok(['add', id, '--title', o.title ?? id, ...(o.parent ? ['--parent', o.parent] : []), ...(o.status ? ['--status', o.status] : []), ...(o.body ? ['--body', o.body] : [])])
    p.ok(['accept', id, '--actor', 'you'])
  }
  p.decided = (id, deps = [], o = {}) => {
    p.card(id, { parent: o.parent, title: o.title, status: 'open' })
    p.ok(['edit', id, '--who', 'agent'])
    for (const d of deps) p.ok(['link', id, d, '--type', 'depends_on', '--why', `uses ${d}`])
    if (deps.length === 0 && !o.parent) p.ok(['edit', id, '--no-basis', 'a root choice'])
    p.ok(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
    p.ok(['status', id, 'decided'])
  }
  p.writeSession = (session, lines) => {
    const f = join(dirname(p.dir), '.claude', 'projects', '-tmp-proj', `${session}.jsonl`)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }
  return p
}

export const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
export const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

/** The block of stale output for one card: its head line and the trace lines under it. */
export function staleEntry(out: string, id: string): string | undefined {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^(stale|paused)\\s+#${id}\\b`).test(l))
  if (i === -1) return undefined
  const block = [lines[i]!]
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith('  ')) break
    block.push(l)
  }
  return block.join('\n')
}
export { expect }
