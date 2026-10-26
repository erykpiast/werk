import { afterAll, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanEnv, copyWerk, run } from './helpers.ts'

const werk = copyWerk()
afterAll(() => rmSync(werk, { recursive: true, force: true }))
const env = cleanEnv()
delete env.CI

test('01.3 bun test, then the coverage gate, then the gate with a pure file under 90%', () => {
  // When the agent runs `bun test`
  const t1 = run('bun', ['test'], werk, env)
  console.log('--- bun test (tail)\n' + t1.out.split('\n').slice(-8).join('\n'))
  // Then the run includes server tests and React component tests
  // bun prints no file names when its output is not a terminal, so compare the file count with the test files on disk.
  const files = [...new Bun.Glob('{src,test,tools}/**/*.test.{ts,tsx}').scanSync(werk)]
  console.log('test files:', files)
  expect(files).toContain('src/server/hot.test.ts')
  expect(files).toContain('src/client/App.test.tsx')
  expect(t1.out).toContain(`across ${files.length} files`)
  // And the run reports its results without a coverage check
  expect(t1.out).toMatch(/\d+ pass/)
  expect(t1.out).not.toMatch(/coverage|% Funcs|% Lines/i)
  expect(t1.code).toBe(0)

  // When the agent runs `bun run test:coverage` while every pure file is at 90% or more
  const c1 = run('bun', ['run', 'test:coverage'], werk, env)
  console.log('--- coverage 1 (gate)\n' + c1.out.split('\n').filter((l) => /^(ok|FAIL)  |coverage gate/.test(l)).join('\n'))
  // Then the coverage command passes
  expect(c1.out).toContain('coverage gate passed')
  expect(c1.code).toBe(0)

  // When the agent removes tests so that one pure file falls under 90% coverage
  writeFileSync(join(werk, 'src', 'server', 'sse.test.ts'), "import { test } from 'bun:test'\nimport { sseEvent } from './sse.ts'\nvoid sseEvent\ntest('nothing', () => {})\n")
  // And the agent runs `bun run test:coverage` again
  const c2 = run('bun', ['run', 'test:coverage'], werk, env)
  console.log('--- coverage 2 (gate)\n' + c2.out.split('\n').filter((l) => /^(ok|FAIL)  |coverage gate/.test(l)).join('\n'))
  // Then the coverage command fails and names the file that is under 90%
  expect(c2.code).not.toBe(0)
  expect(c2.out).toMatch(/FAIL\s+src\/server\/sse\.ts/)
  // But `bun test` still passes without a coverage failure
  const t2 = run('bun', ['test'], werk, env)
  console.log('--- bun test 2 (tail)\n' + t2.out.split('\n').slice(-6).join('\n'))
  expect(t2.code).toBe(0)
  expect(t2.out).not.toMatch(/coverage/i)
}, 600_000)
