/** Shared helpers for the held-out command-line tests of steps 62-68. */
import { expect } from 'bun:test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import type { Event } from '../src/map/events.ts'
import { graphOf, refinesTree, type Graph, type TreeNode } from '../src/map/graph.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

export type Ctx = ReturnType<typeof ctxOf>

export function ctxOf(p: Project) {
  // Put `werk` on the project PATH, as an installed command line, so printed commands run as printed.
  const bin = p.env.PATH!.split(':')[0]!
  writeFileSync(join(bin, 'werk'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(join(bin, 'werk'), 0o755)

  const logFile = join(p.dir, '.werk', 'log.jsonl')
  const lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [])
  const events = () => lines().map((l) => JSON.parse(l) as Event)
  const w = (...args: string[]) => p.werk(args)
  const ok = (...args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`setup: werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
    return r
  }
  const sh = (cmd: string) => p.run(['sh', '-c', cmd])
  const show = (id: string) => p.werk(['show', id])
  const graph = (): Graph => graphOf(events())
  const tree = () => refinesTree(graph())
  const childIds = (id: string): string[] | undefined => {
    const find = (ts: TreeNode[]): TreeNode | undefined => {
      for (const t of ts) {
        if (t.node.id === id) return t
        const f = find(t.children)
        if (f) return f
      }
      return undefined
    }
    return find(tree())?.children.map((c) => c.node.id)
  }

  /** A real card: proposed and accepted by the person. */
  const real = (id: string, title: string, opts: { parent?: string; status?: string; body?: string } = {}) => {
    const args = ['add', id, '--title', title]
    if (opts.parent) args.push('--parent', opts.parent)
    if (opts.status) args.push('--status', opts.status)
    if (opts.body) args.push('--body', opts.body)
    ok(...args)
    ok('accept', id, '--actor', 'you')
  }
  /** A real decided card with every contract fact. */
  const decided = (id: string, title: string, opts: { parent?: string; dependsOn?: string[] } = {}) => {
    real(id, title, { parent: opts.parent })
    ok('edit', id, '--who', 'me')
    ok('kill', id, '--form', 'manual', '--text', `use ${id} for a week`)
    for (const d of opts.dependsOn ?? []) ok('link', id, d, '--type', 'depends_on')
    if (!opts.parent && !(opts.dependsOn?.length)) ok('edit', id, '--no-basis', 'a root decision')
    ok('status', id, 'decided')
  }

  /** Runs a verb and checks it appended exactly one line at the end and kept every earlier line. */
  const appendsOne = (...args: string[]) => {
    const before = lines()
    const r = p.werk(args)
    expect(r.code).toBe(0)
    const after = lines()
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
    return r
  }
  /** Runs a verb and checks it failed and left the log as it was. */
  const refuses = (...args: string[]) => {
    const before = lines()
    const r = p.werk(args)
    expect(r.code).not.toBe(0)
    expect(lines()).toEqual(before)
    return r
  }
  return { p, w, ok, sh, show, lines, events, graph, tree, childIds, real, decided, appendsOne, refuses, logFile }
}

export const newCtx = () => ctxOf(makeProject())
