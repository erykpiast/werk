import { expect, test } from 'bun:test'
import { makeProject } from '../src/test/harness.ts'
test('smoke', () => {
  const p = makeProject()
  const r = p.werk(['help'])
  expect(r.code).toBe(0)
})
