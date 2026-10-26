/** 61.2: help lists every registered verb, and a new verb module appears with no other edit. */
import { afterAll, expect, test } from 'bun:test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clone } from './repo.helpers.ts'

const c = clone()
afterAll(() => c.cleanup())

test('61.2 werk help names every verb, and a new ping module joins it', () => {
  expect(c.run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
  const werk = (args: string[]) => c.run(['bun', 'src/cli/main.ts', ...args])
  const help1 = werk(['help'])
  expect(help1.code).toBe(0)
  const verbs = readdirSync(join(c.dir, 'src', 'cli', 'verbs')).filter((f) => !/\.(test|spec)\./.test(f)).map((f) => f.replace(/\.tsx?$/, ''))
  expect(verbs).toContain('help')
  for (const v of verbs) expect(help1.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))

  writeFileSync(
    join(c.dir, 'src', 'cli', 'verbs', 'ping.ts'),
    `import { registry } from '../registry.ts'\nregistry.register({ name: 'ping', summary: 'answer pong', run: (_a, io) => (io.out('pong'), 0) })\n`,
  )
  const help2 = werk(['help'])
  expect(help2.code).toBe(0)
  expect(help2.out).toMatch(/^\s+ping\s/m)
  for (const v of verbs) expect(help2.out).toMatch(new RegExp(`^\\s+${v}\\s`, 'm'))
  expect(c.run(['git', 'status', '--porcelain', '--untracked-files=all']).out.trim()).toBe('?? src/cli/verbs/ping.ts')
}, 300_000)
