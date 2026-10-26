import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { prototype } from './prototype.ts'
import { fakeClaude, git, makeRepo } from './testing/fixture.ts'
import type { FakeRule } from './testing/fake-claude.ts'

// The worktree build of named options. See #al-build-options.

const PATH = process.env.PATH

function use(rules: FakeRule[]) {
  const fake = fakeClaude(rules)
  process.env.PATH = `${fake.bin}:${PATH}`
  process.env.FAKE_CLAUDE_SCRIPT = fake.script
  return fake
}

afterAll(() => {
  process.env.PATH = PATH
  delete process.env.FAKE_CLAUDE_SCRIPT
})

const FORK = {
  field: 'sub-card layout',
  options: [
    { label: 'A', brief: 'Show the sub-cards as a grid of tiles.' },
    { label: 'B', brief: 'Show the sub-cards as a compact list.' },
  ],
}

describe('prototype, worktree tier', () => {
  test('each named option is built in its own worktree, and its patch holds only its own change', async () => {
    const repo = makeRepo({ 'view.txt': 'plain\n' })
    const fake = use([
      { role: 'prototyper', match: 'grid of tiles', files: { 'view.txt': 'grid\n', 'grid.css': '.grid {}\n' }, result: 'built A' },
      { role: 'prototyper', match: 'compact list', files: { 'view.txt': 'list\n' }, result: 'built B' },
    ])

    const [a, b] = await prototype(repo, FORK, { tier: 'worktree', timeoutMs: 30_000 })

    expect(a.error).toBeUndefined()
    expect(b.error).toBeUndefined()
    const patchA = readFileSync(a.patchPath!, 'utf8')
    const patchB = readFileSync(b.patchPath!, 'utf8')
    expect(patchA).toContain('+grid')
    expect(patchA).toContain('grid.css')
    expect(patchA).not.toContain('+list')
    expect(patchB).toContain('+list')
    expect(patchB).not.toContain('grid')

    const cwds = fake.calls().map((c) => c.cwd)
    expect(new Set(cwds).size).toBe(2)
    for (const cwd of cwds) expect(cwd).not.toBe(repo)
  })

  test('the options build at the same time, not one after another', async () => {
    const repo = makeRepo()
    use([{ role: 'prototyper', files: { 'x.txt': 'x\n' }, hangMs: 1500, result: 'done' }])

    const started = Date.now()
    const results = await prototype(repo, FORK, { tier: 'worktree', timeoutMs: 30_000 })

    expect(results.every((r) => r.patchPath)).toBe(true)
    expect(Date.now() - started).toBeLessThan(2900)
  })

  test('a failed option reports its error, the other option still completes, and no worktree or change is left behind', async () => {
    const repo = makeRepo({ 'view.txt': 'plain\n' })
    use([
      { role: 'prototyper', match: 'grid of tiles', files: { 'view.txt': 'half\n' }, exitCode: 1, stderr: 'build broke' },
      { role: 'prototyper', match: 'compact list', files: { 'view.txt': 'list\n' }, result: 'built B' },
    ])

    const [a, b] = await prototype(repo, FORK, { tier: 'worktree', timeoutMs: 30_000 })

    expect(a.error).toBeDefined()
    expect(b.error).toBeUndefined()
    expect(readFileSync(b.patchPath!, 'utf8')).toContain('+list')
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(`${repo}/view.txt`, 'utf8')).toBe('plain\n')
  })
})
