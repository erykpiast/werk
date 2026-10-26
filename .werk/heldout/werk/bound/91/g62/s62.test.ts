import { expect, test } from 'bun:test'
import { setup } from './helpers.ts'

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  const { p, logLines, ok, show, real, appendsOne } = setup()
  try {
    real('base', 'Base card')
    ok(['say', 'base', '--text', 'an earlier note'])
    const before = logLines()
    expect(before.length).toBeGreaterThan(0)
    const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'Every change is one line.', '--why', 'We need history.'])
    expect(add.code).toBe(0)
    expect(add.stdout).toContain('proposed')
    appendsOne(before)

    const s1 = show('use-log')
    expect(s1.code).toBe(0)
    expect(s1.stdout).toContain('Use a log')
    expect(s1.stdout).toContain('Every change is one line.')
    expect(s1.stdout).toContain('We need history.')
    expect(s1.stdout).toContain('ghost')

    const mid = logLines()
    const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
    expect(acc.code).toBe(0)
    appendsOne(mid)
    const s2 = show('use-log')
    expect(s2.stdout).toContain('Use a log')
    expect(s2.stdout).toContain('Every change is one line.')
    expect(s2.stdout).toContain('We need history.')
    expect(s2.stdout).toContain('state: real')
    expect(s2.stdout).not.toContain('ghost')
  } finally {
    p.cleanup()
  }
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  const { p, logLines, ok, show } = setup()
  try {
    ok(['add', 'use-log', '--title', 'Use a log'])
    const before = logLines()
    const r = p.werk(['accept', 'use-log'])
    expect(r.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    expect(show('use-log').stdout).toContain('ghost')
    ok(['accept', 'use-log', '--actor', 'you'])
    expect(show('use-log').stdout).toContain('state: real')
  } finally {
    p.cleanup()
  }
})

test('62.3 the words of a ghost are frozen', () => {
  const { p, logLines, ok, show } = setup()
  try {
    ok(['add', 'use-log', '--title', 'Use a log', '--body', 'old body'])
    let before = logLines()
    let r = p.werk(['edit', 'use-log', '--body', 'new body'])
    expect(r.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    before = logLines()
    r = p.werk(['retitle', 'use-log', '--title', 'Use an append-only log'])
    expect(r.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    before = logLines()
    r = p.werk(['add', 'use-log', '--title', 'Another title'])
    expect(r.code).not.toBe(0)
    expect(logLines()).toEqual(before)
    const s = show('use-log').stdout
    expect(s).toContain('Use a log')
    expect(s).toContain('ghost')
  } finally {
    p.cleanup()
  }
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  const { p, logLines, ok, show, appendsOne } = setup()
  try {
    ok(['add', 'use-log', '--title', 'Use a log', '--body', 'old body'])
    ok(['accept', 'use-log', '--actor', 'you'])
    const before = logLines()
    const r = p.werk(['retitle', 'use-log', '--title', 'Use an append-only log'])
    expect(r.code).toBe(0)
    appendsOne(before)
    const s = show('use-log').stdout
    expect(s).toContain('Use an append-only log')
    expect(s).not.toContain('Use a log')
    const lines = logLines()
    const oldLine = lines.findIndex((l) => l.includes('"Use a log"'))
    expect(oldLine).toBeGreaterThanOrEqual(0)
    expect(oldLine).toBeLessThan(lines.length - 1)
    ok(['edit', 'use-log', '--body', 'the new body text'])
    const s2 = show('use-log').stdout
    expect(s2).toContain('the new body text')
    expect(s2).toContain('Use an append-only log')
  } finally {
    p.cleanup()
  }
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  const { p, logLines, ok, show, real, appendsOne } = setup()
  try {
    real('storage', 'Storage')
    const adds: [string, string[]][] = [
      ['opt-pg', ['--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy for one user', '--parent', 'storage']],
      ['src-bench', ['--kind', 'source', '--title', 'Benchmark notes', '--body', 'source body']],
      ['ex-quote', ['--kind', 'excerpt', '--title', 'a quoted line', '--body', 'excerpt body']],
    ]
    for (const [id, flags] of adds) {
      const before = logLines()
      const r = p.werk(['add', id, ...flags])
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('proposed')
      appendsOne(before)
    }
    const opt = show('opt-pg').stdout
    expect(opt).toContain('Use Postgres')
    expect(opt).toContain('too heavy for one user')
    expect(opt).toContain('ghost')
    const src = show('src-bench').stdout
    expect(src).toContain('Benchmark notes')
    expect(src).toContain('source body')
    expect(src).toContain('ghost')
    const ex = show('ex-quote').stdout
    expect(ex).toContain('a quoted line')
    expect(ex).toContain('excerpt body')
    expect(ex).toContain('ghost')

    ok(['accept', 'opt-pg', '--actor', 'you'])
    const opt2 = show('opt-pg').stdout
    expect(opt2).toContain('state: real')
    expect(opt2).toContain('why-not: too heavy for one user')
    expect(show('src-bench').stdout).toContain('ghost')
    expect(show('ex-quote').stdout).toContain('ghost')
  } finally {
    p.cleanup()
  }
})
