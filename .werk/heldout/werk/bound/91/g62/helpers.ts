import { existsSync, readFileSync } from 'node:fs'
import { setDefaultTimeout } from 'bun:test'
setDefaultTimeout(60_000)
import { join } from 'node:path'
import { expect } from 'bun:test'
import { makeProject, type Project } from '../../src/test/harness.ts'

export function setup() {
  const p: Project = makeProject()
  const logLines = () => {
    const path = join(p.dir, '.werk', 'log.jsonl')
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
  }
  const ok = (args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
    return r
  }
  const show = (id: string) => p.werk(['show', id])
  /** Adds a card and has the person accept it, so it is real. */
  const real = (id: string, title: string, extra: string[] = []) => {
    ok(['add', id, '--title', title, ...extra])
    ok(['accept', id, '--actor', 'you'])
  }
  /** Checks that the log grew by exactly one line at the end and kept every earlier line. */
  const appendsOne = (before: string[]) => {
    const after = logLines()
    expect(after.length).toBe(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
  }
  return { p, logLines, ok, show, real, appendsOne }
}
