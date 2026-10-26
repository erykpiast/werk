/** Shared helpers for the held-out command-line tests. */
import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { graphOf } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'

export const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export type P = Project & {
  lines: () => string[]
  ok: (args: string[]) => { stdout: string; stderr: string }
  appendsOne: (args: string[]) => { stdout: string; stderr: string; event: any }
  refuses: (args: string[]) => { code: number; stdout: string; stderr: string }
  graph: () => ReturnType<typeof graphOf>
  show: (id: string) => string
  parentOf: (id: string) => string | undefined
  realCard: (id: string, title?: string, extra?: string[]) => void
  decided: (id: string, opts?: { dependsOn?: string[]; parent?: string; who?: string; title?: string }) => void
  sh: (cmdline: string) => { code: number; stdout: string; stderr: string }
}

export function project(): P {
  const p = makeProject() as P
  const logFile = join(p.dir, '.werk', 'log.jsonl')
  p.lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [])
  p.ok = (args) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
    return r
  }
  p.appendsOne = (args) => {
    const before = p.lines()
    const r = p.werk(args)
    expect(r.code).toBe(0)
    const after = p.lines()
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
    return { ...r, event: JSON.parse(after.at(-1)!) }
  }
  p.refuses = (args) => {
    const before = p.lines()
    const r = p.werk(args)
    expect(r.code).not.toBe(0)
    expect(p.lines()).toEqual(before)
    return r
  }
  p.graph = () => graphOf(readLog(logFile))
  p.show = (id) => p.werk(['show', id]).stdout
  p.parentOf = (id) => {
    const g = p.graph()
    return [...g.edges, ...g.ghostEdges].find((e) => e.type === 'refines' && e.from === id)?.to
  }
  p.realCard = (id, title = `Title ${id}`, extra = []) => {
    p.ok(['add', id, '--title', title, ...extra])
    p.ok(['accept', id, '--actor', 'you'])
  }
  p.decided = (id, opts = {}) => {
    p.ok(['add', id, '--title', opts.title ?? `Title ${id}`, ...(opts.parent ? ['--parent', opts.parent] : [])])
    p.ok(['accept', id, '--actor', 'you'])
    p.ok(['edit', id, '--who', opts.who ?? 'me'])
    p.ok(['kill', id, '--form', 'revisit'])
    for (const d of opts.dependsOn ?? []) p.ok(['link', id, d, '--type', 'depends_on'])
    if (!opts.parent && !opts.dependsOn?.length) p.ok(['edit', id, '--no-basis', 'a root decision'])
    p.ok(['status', id, 'decided'])
  }
  p.sh = (cmdline) => {
    const line = cmdline.replace(/(^|&&\s*)werk /g, `$1${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} `)
    return p.run(['sh', '-c', line])
  }
  return p
}
