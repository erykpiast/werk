/** Shared helpers for the held-out map command-line tests of tickets 62 to 66. */
import { expect } from 'bun:test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'

export const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export type P = Project & {
  logLines: () => string[]
  w: (...args: string[]) => RunResult
  ok: (...args: string[]) => RunResult
  show: (id: string) => string
  stale: () => string
  sh: (command: string) => RunResult
  real: (id: string, title: string, extra?: string[]) => void
  decided: (id: string, title: string, opts?: { parent?: string; dependsOn?: string[] }) => void
}

export function project(): P {
  const p = makeProject()
  const logLines = () => {
    const path = join(p.dir, '.werk', 'log.jsonl')
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
  }
  const w = (...args: string[]) => p.werk(args)
  const ok = (...args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
    return r
  }
  // A `werk` program on the project's PATH, so a printed command runs as the agent would run it.
  const bin = p.env.PATH!.split(':')[0]!
  const shim = join(bin, 'werk')
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${MAIN}" "$@"\n`)
  chmodSync(shim, 0o755)
  const real = (id: string, title: string, extra: string[] = []) => {
    ok('add', id, '--title', title, ...extra)
    ok('accept', id, '--actor', 'you')
  }
  const decided = (id: string, title: string, opts: { parent?: string; dependsOn?: string[] } = {}) => {
    real(id, title, opts.parent ? ['--parent', opts.parent] : [])
    ok('edit', id, '--who', 'team')
    ok('kill', id, '--form', 'revisit')
    for (const d of opts.dependsOn ?? []) ok('link', id, d, '--type', 'depends_on')
    if (!opts.parent && !(opts.dependsOn ?? []).length) ok('edit', id, '--no-basis', 'a root decision')
    ok('status', id, 'decided')
  }
  return {
    ...p,
    logLines,
    w,
    ok,
    show: (id) => ok('show', id).stdout,
    stale: () => ok('stale').stdout,
    sh: (command) => p.run(['sh', '-c', command]),
    real,
    decided,
  }
}

/** Runs a verb and expects it to succeed and append exactly one line, with every earlier line unchanged. */
export function appendsOne(p: P, ...args: string[]): RunResult & { event: Record<string, unknown> } {
  const before = p.logLines()
  const r = p.w(...args)
  expect(r.code).toBe(0)
  const after = p.logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return { ...r, event: JSON.parse(after.at(-1)!) }
}

/** Runs a verb and expects it to fail and leave the log as it was. */
export function refuses(p: P, ...args: string[]): RunResult {
  const before = p.logLines()
  const r = p.w(...args)
  expect(r.code).not.toBe(0)
  expect(p.logLines()).toEqual(before)
  return r
}

export const events = (p: P) => p.logLines().map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
