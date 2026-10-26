import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { accepted, logFile, logLines, makeProject, ok, proposed, seed, show } from './helpers.ts'

const appendedOne = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

describe('62', () => {
  test('62.1 An agent proposes a card and a person accepts it into the map', () => {
    const p = makeProject()
    seed(p, [proposed('root', { title: 'Root' }), accepted('root'), proposed('other', { title: 'Other', parent: 'root' })])
    const l0 = logLines(p)
    const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
    expect(add.code).toBe(0)
    expect(add.stdout).toContain('proposed')
    const l1 = logLines(p)
    appendedOne(l0, l1)
    const s1 = show(p, 'use-log').stdout
    expect(s1).toContain('Use a log')
    expect(s1).toContain('The body text')
    expect(s1).toContain('The why text')
    expect(s1).toContain('ghost')
    const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
    expect(acc.code).toBe(0)
    appendedOne(l1, logLines(p))
    const s2 = show(p, 'use-log').stdout
    expect(s2).toContain('Use a log')
    expect(s2).toContain('The body text')
    expect(s2).toContain('The why text')
    expect(s2).toContain('state: real')
    expect(s2).not.toContain('ghost')
  })

  test('62.2 An accept without the person\'s claim refuses and leaves the ghost waiting', () => {
    const p = makeProject()
    ok(p, ['add', 'use-log', '--title', 'Use a log'])
    const l0 = logLines(p)
    const r = p.werk(['accept', 'use-log'])
    expect(r.code).not.toBe(0)
    expect(logLines(p)).toEqual(l0)
    expect(show(p, 'use-log').stdout).toContain('ghost')
    expect(p.werk(['accept', 'use-log', '--actor', 'you']).code).toBe(0)
    const s = show(p, 'use-log').stdout
    expect(s).toContain('state: real')
    expect(s).not.toContain('ghost')
  })

  test('62.3 The words of a ghost are frozen', () => {
    const p = makeProject()
    ok(p, ['add', 'use-log', '--title', 'Use a log'])
    let l = logLines(p)
    const e = p.werk(['edit', 'use-log', '--body', 'new body'])
    expect(e.code).not.toBe(0)
    expect(logLines(p)).toEqual(l)
    const rt = p.werk(['retitle', 'use-log', '--title', 'Use an append-only log'])
    expect(rt.code).not.toBe(0)
    expect(logLines(p)).toEqual(l)
    const again = p.werk(['add', 'use-log', '--title', 'A different title'])
    expect(again.code).not.toBe(0)
    expect(logLines(p)).toEqual(l)
    const s = show(p, 'use-log').stdout
    expect(s).toContain('Use a log')
    expect(s).toContain('ghost')
  })

  test('62.4 A retitle on a real card shows only the new title and keeps the old one in the log', () => {
    const p = makeProject()
    ok(p, ['add', 'use-log', '--title', 'Use a log'])
    ok(p, ['accept', 'use-log', '--actor', 'you'])
    const l0 = logLines(p)
    const rt = p.werk(['retitle', 'use-log', '--title', 'Use an append-only log'])
    expect(rt.code).toBe(0)
    const l1 = logLines(p)
    appendedOne(l0, l1)
    const s = show(p, 'use-log').stdout
    expect(s).toContain('Use an append-only log')
    expect(s).not.toContain('Use a log')
    const raw = readFileSync(logFile(p), 'utf8').split('\n')
    expect(raw.slice(0, l0.length).some((line) => line.includes('"Use a log"'))).toBe(true)
    expect(p.werk(['edit', 'use-log', '--body', 'A brand new body']).code).toBe(0)
    const s2 = show(p, 'use-log').stdout
    expect(s2).toContain('A brand new body')
    expect(s2).toContain('Use an append-only log')
  })

  test('62.5 An option, a source and an excerpt also enter as ghosts', () => {
    const p = makeProject()
    seed(p, [proposed('storage', { title: 'Storage' }), accepted('storage')])
    const adds: [string, string[]][] = [
      ['pg', ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy for one user', '--parent', 'storage']],
      ['bench', ['add', 'bench', '--kind', 'source', '--title', 'Benchmark notes']],
      ['quote1', ['add', 'quote1', '--kind', 'excerpt', '--title', 'A quoted line']],
    ]
    for (const [, args] of adds) {
      const before = logLines(p)
      const r = p.werk(args)
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('proposed')
      appendedOne(before, logLines(p))
    }
    const pg = show(p, 'pg').stdout
    expect(pg).toContain('Use Postgres')
    expect(pg).toContain('Too heavy for one user')
    expect(pg).toContain('ghost')
    expect(show(p, 'bench').stdout).toContain('Benchmark notes')
    expect(show(p, 'bench').stdout).toContain('ghost')
    expect(show(p, 'quote1').stdout).toContain('A quoted line')
    expect(show(p, 'quote1').stdout).toContain('ghost')
    expect(p.werk(['accept', 'pg', '--actor', 'you']).code).toBe(0)
    const pg2 = show(p, 'pg').stdout
    expect(pg2).toContain('state: real')
    expect(pg2).toContain('why-not: Too heavy for one user')
    expect(show(p, 'bench').stdout).toContain('ghost')
    expect(show(p, 'quote1').stdout).toContain('ghost')
  })
})
