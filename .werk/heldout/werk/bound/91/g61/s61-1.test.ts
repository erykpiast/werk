import { expect, test } from 'bun:test'
import { cloneRepo, sh } from './helpers.ts'

test('61.1 a fresh clone builds on an empty first commit and passes every check', () => {
  const { dir, done } = cloneRepo()
  try {
    const first = sh('git rev-list --max-parents=0 main', dir).out.trim().split('\n')
    expect(first.length).toBe(1)
    expect(sh(`git ls-tree -r --name-only ${first[0]}`, dir).out.trim()).toBe('')
    const all = sh('git rev-list main', dir).out.trim().split('\n')
    for (const c of all) expect(sh(`git merge-base --is-ancestor ${first[0]} ${c}`, dir).code).toBe(0)
    const results: Record<string, { code: number; tail: string }> = {}
    for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = sh(`make ${t}`, dir)
      results[t] = { code: r.code, tail: r.out.slice(-1500) }
      console.log(`make ${t} -> ${r.code}\n${r.out.slice(-800)}`)
    }
    for (const t of Object.keys(results)) expect({ t, code: results[t]!.code }).toEqual({ t, code: 0 })
  } finally {
    done()
  }
}, 1_800_000)
