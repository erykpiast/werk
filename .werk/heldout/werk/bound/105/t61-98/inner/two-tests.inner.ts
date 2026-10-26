// Run by infra-95.test.ts (95.1): two command-line tests that each ask the harness for a project.
import { expect, test } from 'bun:test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fold } from '../../../src/map/fold.ts'
import { makeProject } from '../../../src/test/harness.ts'

const report = (entry: unknown) => appendFileSync(process.env.HELDOUT_REPORT!, JSON.stringify(entry) + '\n')
const titles = (dir: string) => {
  const events = readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  return [...fold(events).nodes.values()].map((n) => n.title)
}
const isRepo = (p: ReturnType<typeof makeProject>) => p.run(['git', 'rev-parse', '--show-toplevel']).stdout.trim()

test('first adds Alpha and then fails', () => {
  const p = makeProject()
  expect(p.werk(['add', 'alpha', '--title', 'Alpha']).code).toBe(0)
  report({ test: 'first', dir: p.dir, titles: titles(p.dir), toplevel: isRepo(p) })
  expect('made to fail').toBe('after it adds its card')
})

test('second adds Beta', () => {
  const p = makeProject()
  expect(p.werk(['add', 'beta', '--title', 'Beta']).code).toBe(0)
  report({ test: 'second', dir: p.dir, titles: titles(p.dir), toplevel: isRepo(p) })
})
