import { afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FAKE_AGENT_DIR, makeProject, testEnv, type TempProject } from './lib.ts'

let project: TempProject | undefined
let seenDir: string | undefined
afterEach(() => {
  project?.cleanup()
  project = undefined
})

test('01.5 a werk command runs against a temporary git project from the harness', () => {
  project = makeProject()
  seenDir = project.dir
  expect(existsSync(join(project.dir, '.git'))).toBe(true)
  expect(project.git(['rev-parse', '--is-inside-work-tree']).stdout.trim()).toBe('true')
  const added = project.run(['add', 'a', '--title', 'Use a log'])
  expect(added.code).toBe(0)
  expect(added.stdout).toContain('1 added #a')
  const bad = project.run(['retitle', 'nope', 'x'])
  expect(bad.code).toBe(1)
  expect(bad.stderr).toContain('no card #nope')
  // The command's environment: `claude` resolves to the scripted fake agent.
  expect(Bun.which('claude', { PATH: testEnv().PATH })).toBe(join(FAKE_AGENT_DIR, 'claude'))
})

test('01.5 the temporary project is gone after the test ends', () => {
  expect(seenDir).toBeDefined()
  expect(existsSync(seenDir!)).toBe(false)
})
