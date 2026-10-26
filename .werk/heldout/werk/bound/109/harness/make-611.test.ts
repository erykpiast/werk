/** Held-out step 61.1: a fresh clone builds on an empty first commit and passes every check. Runs in a clone outside the repo. */
import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, git, HOURS, personEnv, sh } from './clone.ts'

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  async () => {
    const { dir } = freshClone()
    const env = personEnv()
    // The first commit on main holds no files.
    const roots = git(dir, 'rev-list', '--max-parents=0', 'main').split('\n').filter(Boolean)
    expect(roots).toHaveLength(1)
    const first = roots[0]!
    expect(git(dir, 'ls-tree', '-r', '--name-only', first)).toBe('')
    // Every later commit on main has the first commit as an ancestor.
    const commits = git(dir, 'rev-list', 'main').split('\n').filter(Boolean)
    expect(commits.length).toBeGreaterThan(1)
    const notDescendants = commits.filter(
      (c) => Bun.spawnSync(['git', 'merge-base', '--is-ancestor', first, c], { cwd: dir, env }).exitCode !== 0,
    )
    expect(notDescendants).toEqual([])

    expect((await sh(['bun', 'install', '--frozen-lockfile'], dir, env)).code).toBe(0)
    const codes: Record<string, number | null> = {}
    const outs: Record<string, string> = {}
    for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = await sh(['make', target], dir, env)
      codes[target] = r.code
      outs[target] = r.out.slice(-3000)
    }
    if (Object.values(codes).some((c) => c !== 0)) console.log(JSON.stringify(outs, null, 1))
    expect(codes).toEqual({ test: 0, 'test-coverage': 0, typecheck: 0, lint: 0, e2e: 0 })

    // make e2e passes also when the project has no browser spec.
    for (const f of git(dir, 'ls-files', 'e2e/*.spec.ts').split('\n').filter(Boolean)) rmSync(join(dir, f))
    const empty = await sh(['make', 'e2e'], dir, env)
    if (empty.code !== 0) console.log(empty.out.slice(-3000))
    expect(empty.code).toBe(0)
  },
  2 * HOURS,
)
