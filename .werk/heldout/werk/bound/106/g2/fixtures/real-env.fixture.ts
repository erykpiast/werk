/** Run by 95.test.ts as its own bun test run, from a shell with a real project setting and the real agent on PATH. */
import { expect, test } from 'bun:test'
import { scriptRunAgent } from '../../../src/test/harness.ts'

test('reads the project setting from its environment', () => {
  expect(process.env.WERK_LOG).toBeUndefined()
})

test('starts the agent by name with no environment of its own', () => {
  scriptRunAgent({ steps: [{ event: { type: 'assistant', message: { content: [{ type: 'text', text: 'the fake reply' }] } } }], exit: 0 })
  const r = Bun.spawnSync(['claude', '-p', 'hello'], { stdout: 'pipe', stderr: 'pipe' })
  expect(r.exitCode).toBe(0)
  expect(r.stdout.toString()).toContain('the fake reply')
})
