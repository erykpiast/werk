import { expect, test } from 'bun:test'
import { makeProject } from '../../src/test/harness.ts'
test('smoke', () => {
  const p = makeProject()
  const r = p.werk(['add', 'a', '--title', 'A'])
  expect(r.stdout).toContain('proposed')
  p.cleanup()
})
