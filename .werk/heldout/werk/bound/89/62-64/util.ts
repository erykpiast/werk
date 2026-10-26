import { afterEach, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

export let p: Project
export const fresh = () => (p = makeProject())
afterEach(() => p?.cleanup())

export const logLines = () => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}
export const events = () => logLines().map((l) => JSON.parse(l))

export const ok = (args: string[]) => {
  const r = p.werk(args)
  expect({ args, code: r.code, stderr: r.stderr }).toEqual({ args, code: 0, stderr: '' })
  return r
}

/** Runs a verb; checks it succeeded, appended exactly one line at the end, and kept every earlier line. */
export const appendsOne = (args: string[]) => {
  const before = logLines()
  const r = ok(args)
  const after = logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}

/** Runs a verb; checks it exited non-zero and the log is unchanged. */
export const refuses = (args: string[]) => {
  const before = logLines()
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(logLines()).toEqual(before)
  return r
}

export const show = (id: string) => p.werk(['show', id])

/** The printed command lines: each one starts with `werk` after an indent. */
export const printedCommands = (text: string) =>
  text
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

/** Runs one printed line the way a shell would: double-quoted words and `&&` between commands. */
export const runPrinted = (line: string) => {
  for (const command of line.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('werk')
    ok(words.slice(1))
  }
}

/** The rollup line of a card's show output, parsed. */
export const rollupOf = (id: string) => {
  const m = show(id).stdout.match(/rollup: (\d+) cards · (\d+) open · (\d+) proto · (\d+) decided · (\d+) unchallenged/)
  return m ? { cards: +m[1]!, open: +m[2]!, proto: +m[3]!, decided: +m[4]!, unchallenged: +m[5]! } : undefined
}
