import { afterAll, afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { V0 } from './helpers.ts'
import { FAKE_AGENT_DIR, testEnv } from '../v0/test/env.ts'
import { makeProject, type TempProject } from '../v0/test/harness.ts'

let project: TempProject | undefined
let dir: string | undefined
afterEach(() => project?.cleanup())
afterAll(() => {
  // And the temporary project is gone after the test ends
  expect(dir).toBeDefined()
  expect(existsSync(dir!)).toBe(false)
})

test('01.5 a command-line test runs a werk command against a temporary project', () => {
  // When the test asks the harness for a temporary project directory with a git repository
  project = makeProject()
  dir = project.dir
  expect(existsSync(join(dir, '.git'))).toBe(true)
  expect(project.git(['rev-parse', '--is-inside-work-tree']).stdout.trim()).toBe('true')
  // And the test runs a werk command against that project
  const ok = project.run(['add', 'a', '--title', 'Use a log'])
  const bad = project.run(['decide', 'nope'])
  // Then the test reads the exit code of the werk command
  expect(ok.code).toBe(0)
  expect(bad.code).not.toBe(0)
  // And the test reads the output of the werk command
  console.log({ ok, bad })
  expect(ok.stdout.length).toBeGreaterThan(0)
  expect(bad.stderr).toContain('werk:')
  // And any agent that the werk command calls is the scripted fake agent
  const env = testEnv()
  expect(Bun.which('claude', { PATH: env.PATH })).toBe(join(FAKE_AGENT_DIR, 'claude'))
  expect(FAKE_AGENT_DIR.startsWith(V0)).toBe(true)
})
