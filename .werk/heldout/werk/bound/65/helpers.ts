/** Helpers for the held-out command-line tests. They use the product's own test harness. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../src/test/harness.ts'
import type { Event, NewEvent } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { refinesTree, toGraph, type TreeNode } from '../src/map/graph.ts'

export type P = Project & {
  logPath: string
  lines: () => string[]
  events: () => Event[]
  /** Runs a printed shell command, with `werk` on the PATH. */
  sh: (command: string) => RunResult
  writeLog: (events: NewEvent[]) => void
  show: (id: string) => RunResult
  tree: () => TreeNode[]
}

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

export function project(): P {
  const p = makeProject()
  const logPath = join(p.dir, '.werk', 'log.jsonl')
  const bin = p.env.PATH!.split(':')[0]!
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)
  const lines = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter((l) => l !== '') : [])
  const events = () => lines().map((l) => JSON.parse(l) as Event)
  return {
    ...p,
    logPath,
    lines,
    events,
    sh: (command) => p.run(['/bin/sh', '-c', command]),
    writeLog(evs) {
      mkdirSync(dirname(logPath), { recursive: true })
      const written = evs.map((e, i) => ({ actor: 'agent', ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z' }))
      writeFileSync(logPath, written.map((e) => JSON.stringify(e)).join('\n') + '\n')
    },
    show: (id) => p.werk(['show', id]),
    tree: () => refinesTree(toGraph(fold(events()))),
  }
}

/** Events for one real decided card that holds every contract fact. */
export function decidedCard(
  id: string,
  opts: { title?: string; parent?: string; deps?: string[]; who?: string; body?: string } = {},
): NewEvent[] {
  const evs: NewEvent[] = [
    {
      type: 'node.proposed',
      payload: {
        id,
        kind: 'card',
        title: opts.title ?? `title of ${id}`,
        ...(opts.body !== undefined && { body: opts.body }),
        ...(opts.parent !== undefined && { parent: opts.parent }),
      },
    },
    { type: 'node.edited', payload: { id, who: opts.who ?? 'me' } },
  ]
  for (const d of opts.deps ?? []) evs.push({ type: 'edge.linked', payload: { from: id, to: d, type: 'depends_on' } })
  if (opts.parent === undefined && !(opts.deps ?? []).length) evs.push({ type: 'node.edited', payload: { id, noBasis: 'a root' } })
  evs.push({ type: 'kill.recorded', payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } } })
  evs.push({ type: 'node.accepted', payload: { id } })
  evs.push({ type: 'node.status_set', payload: { id, status: 'decided' } })
  return evs
}

export const realCard = (id: string, title = `title of ${id}`, parent?: string): NewEvent[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...(parent !== undefined && { parent }) } },
  { type: 'node.accepted', payload: { id } },
]

export function findTree(trees: TreeNode[], id: string): TreeNode | undefined {
  for (const t of trees) {
    if (t.node.id === id) return t
    const f = findTree(t.children, id)
    if (f) return f
  }
  return undefined
}

/** The stale list split into entries: the head line and its trace lines. */
export function staleEntries(out: string): { mark: string; id: string; head: string; traces: string[] }[] {
  const entries: { mark: string; id: string; head: string; traces: string[] }[] = []
  for (const line of out.split('\n')) {
    const m = /^(stale|paused)\s+#(\S+)/.exec(line)
    if (m) entries.push({ mark: m[1]!, id: m[2]!, head: line, traces: [] })
    else if (line.startsWith('  ') && entries.length > 0) entries.at(-1)!.traces.push(line)
  }
  return entries
}

/** The inbox split into groups by blank line. Each group: head line and the note texts. */
export function inboxGroups(out: string): { head: string; id: string; notes: string[] }[] {
  return out
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const [head = '', ...rest] = block.split('\n')
      const notes = rest.map((l) => /^\s+\[\d+\] \S+ \S+: (.*)$/.exec(l)?.[1] ?? l.trim())
      return { head, id: /^#(\S+)/.exec(head)?.[1] ?? '', notes }
    })
}
