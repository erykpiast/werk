/** Run by h95.test.ts (95.3) from a shell with a real project setting and the real agent on PATH. */
import { expect, test } from 'bun:test'
import { scriptRunAgent } from '../../src/test/harness.ts'

test('reads the project setting from its environment', () => {
  expect(process.env.WERK_LOG).toBeUndefined()
})

test('starts the agent by name with no environment of its own', () => {
  scriptRunAgent({ steps: [{ event: { type: 'fake-reply' } }] })
  expect(Bun.spawnSync(['claude', '-p', 'hello']).stdout.toString()).toBe('{"type":"fake-reply"}\n')
})
