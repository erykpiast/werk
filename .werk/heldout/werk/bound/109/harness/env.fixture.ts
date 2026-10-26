/** Run by scope.test.ts (95.3) as its own `bun test` run, from a shell with a real project setting and a real agent. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { scriptRunAgent } from '../../src/test/harness.ts'

const record = (line: object) => appendFileSync(process.env.H95_OUT!, JSON.stringify(line) + '\n')

test('reads the project setting from its environment', () => {
  record({ test: 'setting', WERK_LOG: process.env.WERK_LOG ?? null })
  expect(process.env.WERK_LOG).toBeUndefined()
})

test('starts the agent by name with no environment of its own', () => {
  scriptRunAgent({ steps: [{ event: { type: 'assistant', text: 'FAKE-REPLY-MARK' } }] })
  const r = Bun.spawnSync(['claude', '-p', 'hello'], { stdout: 'pipe', stderr: 'pipe' })
  record({ test: 'agent', code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() })
  expect(r.stdout.toString()).toContain('FAKE-REPLY-MARK')
})
