import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { cloneRepo, pathWithoutClaude, sh } from './helpers.ts'

test('61.3 the tests pass with no real agent on PATH and leave the tree clean', () => {
  const { dir, done } = cloneRepo()
  try {
    const PATH = pathWithoutClaude()
    const env = { ...process.env, PATH }
    expect(sh('command -v claude', dir, env).code).not.toBe(0)
    const r = sh('make test', dir, env)
    console.log(r.out.slice(-1500))
    expect(r.code).toBe(0)
    expect(sh('git status --porcelain', dir).out.trim()).toBe('')
    // The command-line tests read the fake agent's scripted events and file edits from a temporary project.
    const harness = readFileSync(join(dir, 'src/test/harness.ts'), 'utf8')
    expect(harness).toContain("mkdtempSync(join(tmpdir(), 'werk-project-'))")
    expect(harness).toContain('fake-agent.ts')
    const fake = readFileSync(join(dir, 'src/test/fake-agent.ts'), 'utf8')
    expect(fake).toContain("'event' in step")
    expect(fake).toContain('writeFileSync(target, content)')
  } finally {
    done()
  }
}, 900_000)
