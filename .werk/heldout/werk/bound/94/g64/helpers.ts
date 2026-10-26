import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { graphOf } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'

export const logPathOf = (p: Project) => join(p.dir, '.werk', 'log.jsonl')

export const logLines = (p: Project) => {
  const path = logPathOf(p)
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

export const events = (p: Project) => logLines(p).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

/** The map data the server sends to the browser (/api/graph). */
export const graph = (p: Project) => graphOf(readLog(logPathOf(p)))

export const nodeOnMap = (p: Project, id: string) => graph(p).nodes.find((n) => n.id === id)
export const markOnMap = (p: Project, id: string) => graph(p).marks[id]?.mark

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}

/** Splits a printed shell command into words, with double quotes. */
export function words(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  let has = false
  for (const ch of cmd) {
    if (ch === '"') {
      inQ = !inQ
      has = true
    } else if (ch === ' ' && !inQ) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/** Runs a printed `werk ...` command line (maybe joined by &&), with placeholders filled. */
export function runPrinted(p: Project, line: string, fill: (w: string) => string = (w) => w) {
  for (const part of line.split('&&').map((s) => s.trim())) {
    const w = words(part).map(fill)
    expect(w[0]).toBe('werk')
    const r = p.werk(w.slice(1))
    if (r.code !== 0) return r
  }
  return { code: 0, stdout: '', stderr: '' }
}

/** A real card made decided with every fact: who, basis, a rejected option, a kill criterion. */
export function decided(p: Project, id: string, basis?: string, extra: string[] = []) {
  ok(p, ['add', id, '--title', `Card ${id}`, '--body', `Body of ${id}`, '--who', 'you', ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
  if (basis === undefined) ok(p, ['edit', id, '--no-basis', 'a root of the test'])
  else ok(p, ['link', id, basis, '--type', 'depends_on', '--why', `${id} needs ${basis}`])
  ok(p, ['add', `${id}-opt`, '--kind', 'option', '--title', `Not ${id}`, '--why-not', 'it lost'])
  ok(p, ['link', `${id}-opt`, id, '--type', 'alternative_to'])
  ok(p, ['accept', `${id}-opt`, '--actor', 'you'])
  ok(p, ['kill', id, '--form', 'manual', '--text', `revisit ${id}`])
  ok(p, ['status', id, 'decided'])
}
