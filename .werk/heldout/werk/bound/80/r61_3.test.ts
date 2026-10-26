/** 61.3: the tests pass on a machine with no real agent installed. */
import { afterAll, expect, test } from 'bun:test'
import { clone, pathWithoutClaude } from './repo.helpers.ts'

const c = clone()
afterAll(() => c.cleanup())

test('61.3 make test passes with no claude on the PATH and leaves the tree clean', () => {
  const PATH = pathWithoutClaude()
  expect(c.run(['sh', '-c', 'command -v claude || echo none'], { PATH }).out.trim()).toBe('none')
  expect(c.run(['bun', 'install', '--frozen-lockfile'], { PATH }).code).toBe(0)
  const r = c.run(['make', 'test'], { PATH })
  if (r.code !== 0) console.error(r.out.slice(-4000))
  expect(r.code).toBe(0)
  // The command-line tests use the fake agent's scripted events and edit in a temp project.
  const h = c.run(['bun', 'test', 'src/test/harness.test.ts', '-t', 'the fake agent replays its scripted events and edits a file in the project'], { PATH, CI: 'true' })
  expect(h.code).toBe(0)
  expect(h.out).toMatch(/\b1 pass\b/)
  expect(h.out).toMatch(/\b0 fail\b/)
  expect(c.run(['git', 'status', '--porcelain', '--untracked-files=all']).out.trim()).toBe('')
}, 600_000)
