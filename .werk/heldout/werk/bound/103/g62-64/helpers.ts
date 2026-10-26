import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'

export type Ctx = Project & {
  log: () => string[]
  ok: (args: string[]) => RunResult
  appendsOne: (args: string[]) => RunResult & { event: any }
  refuses: (args: string[]) => RunResult
  show: (id: string) => string
  sh: (cmd: string) => RunResult
}

export function project(): Ctx {
  const p = makeProject()
  const log = () => {
    const path = join(p.dir, '.werk', 'log.jsonl')
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
  }
  const ok = (args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
    return r
  }
  const appendsOne = (args: string[]) => {
    const before = log()
    const r = p.werk(args)
    expect(r.code).toBe(0)
    const after = log()
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
    return { ...r, event: JSON.parse(after.at(-1)!) }
  }
  const refuses = (args: string[]) => {
    const before = log()
    const r = p.werk(args)
    expect(r.code).not.toBe(0)
    expect(log()).toEqual(before)
    return r
  }
  const show = (id: string) => {
    const r = p.werk(['show', id])
    return r.stdout + r.stderr
  }
  // Runs a shell line with `werk` resolving to this checkout's command line.
  const sh = (cmd: string) => {
    const main = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')
    return p.run(['bash', '-c', `werk() { ${JSON.stringify(process.execPath)} ${JSON.stringify(main)} "$@"; }; ${cmd}`])
  }
  return { ...p, log, ok, appendsOne, refuses, show, sh }
}

/** A real card that is decided, with every fact, so a child can name it as its basis. */
export function decidedReal(c: Ctx, id: string, title: string, parent?: string) {
  c.ok(['add', id, '--title', title, '--who', 'me', ...(parent ? ['--parent', parent] : [])])
  c.ok(['accept', id, '--actor', 'you'])
  if (!parent) c.ok(['edit', id, '--no-basis', 'root of the test map'])
  c.ok(['kill', id, '--form', 'manual', '--text', 'revisit by use'])
  c.ok(['status', id, 'decided'])
}
