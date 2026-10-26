import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { copyRepo } from './copy.ts'

const run = (cwd: string, ...args: string[]) => {
  const env = { ...process.env } as Record<string, string>
  for (const k of Object.keys(env)) if (k.startsWith('WERK_')) delete env[k]
  const r = spawnSync('bun', args, { cwd, env, encoding: 'utf8', timeout: 400_000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

test('01.3 bun test, then the coverage gate, then a pure file under 90%', () => {
  const repo = copyRepo()
  try {
    const plain = run(repo, 'test')
    console.log('--- bun test (tail)\n' + plain.out.split('\n').slice(-8).join('\n'))
    expect(plain.code).toBe(0)
    // Bun prints no file names on a clean run. It prints the file count, so compare it with the test files
    // on disk, which include server tests and React component tests.
    const files = readdirSync(repo, { recursive: true, encoding: 'utf8' }).filter((f) => !f.startsWith('node_modules') && /\.test\.tsx?$/.test(f))
    expect(files.some((f) => /^src\/server\/.+\.test\.ts$/.test(f))).toBe(true)
    expect(files.some((f) => /^src\/client\/.+\.test\.tsx$/.test(f))).toBe(true)
    expect(plain.out).toContain(`across ${files.length} files`)
    expect(plain.out).not.toMatch(/% Lines|coverage gate/)

    const cov = run(repo, 'run', 'test:coverage')
    console.log('--- test:coverage (gate)\n' + cov.out.split('\n').filter((l) => /^(ok|FAIL)\s|coverage gate/.test(l)).join('\n'))
    expect(cov.code).toBe(0)
    expect(cov.out).toContain('coverage gate passed')

    // tools/coverage.ts is on the pure-file list. Only tools/coverage.test.ts loads it in-process.
    rmSync(join(repo, 'tools', 'coverage.test.ts'))
    const cov2 = run(repo, 'run', 'test:coverage')
    console.log('--- test:coverage after removal (gate)\n' + cov2.out.split('\n').filter((l) => /^(ok|FAIL)\s|coverage gate/.test(l)).join('\n'))
    expect(cov2.code).not.toBe(0)
    expect(cov2.out).toMatch(/FAIL\s+tools\/coverage\.ts/)

    const plain2 = run(repo, 'test')
    expect(plain2.code).toBe(0)
    expect(plain2.out).not.toMatch(/coverage gate|% Lines/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}, 900_000)
