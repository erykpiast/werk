/** 95.3: one test reads the project setting, one starts the agent by name with no environment of its own. */
import { expect, test } from 'bun:test'
import { scriptRunAgent } from '../../src/test/harness.ts'

test('the project setting is not in the environment', () => {
  expect(process.env.WERK_LOG).toBeUndefined()
})

test('the agent started by name gives the fake reply', () => {
  scriptRunAgent({ steps: [{ event: { type: 'fake-reply' } }] })
  const r = Bun.spawnSync(['claude', '-p', 'hello'])
  expect(r.stdout.toString()).toBe('{"type":"fake-reply"}\n')
})
