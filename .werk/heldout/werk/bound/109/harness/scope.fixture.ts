/** Run by scope.test.ts (95.1) as its own `bun test` run. Each test records what it saw in the file that H95_OUT names. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import { makeProject } from '../../src/test/harness.ts'

const record = (line: object) => appendFileSync(process.env.H95_OUT!, JSON.stringify(line) + '\n')
const titles = (dir: string) => [...fold(readLog(join(dir, '.werk', 'log.jsonl'))).nodes.values()].map((n) => (n as { title?: string }).title)

test('first test adds Alpha, then fails', () => {
  const p = makeProject()
  expect(p.werk(['add', 'alpha', '--title', 'Alpha']).code).toBe(0)
  record({ test: 'first', dir: p.dir, titles: titles(p.dir), top: p.run(['git', 'rev-parse', '--show-toplevel']).stdout.trim() })
  throw new Error('the first test fails on purpose')
})

test('second test adds Beta', () => {
  const p = makeProject()
  expect(p.werk(['add', 'beta', '--title', 'Beta']).code).toBe(0)
  record({ test: 'second', dir: p.dir, titles: titles(p.dir), top: p.run(['git', 'rev-parse', '--show-toplevel']).stdout.trim() })
})
