// Run by infra-95.test.ts (95.3) from a shell that has WERK_LOG set and the real agent on PATH.
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { scriptRunAgent } from '../../../src/test/harness.ts'

const report = (entry: unknown) => appendFileSync(process.env.HELDOUT_REPORT!, JSON.stringify(entry) + '\n')

test('reads the project setting from its environment', () => {
  report({ test: 'setting', WERK_LOG: process.env.WERK_LOG ?? null })
  expect(true).toBe(true)
})

test('starts the agent by name with no environment of its own', () => {
  scriptRunAgent({ steps: [{ event: { type: 'result', subtype: 'success', result: 'FAKE-REPLY-95' } }] })
  const r = Bun.spawnSync(['claude', '-p', 'hello'])
  report({ test: 'agent', code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() })
  expect(r.exitCode).toBe(0)
})
