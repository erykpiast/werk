/** Run by 95.test.ts as its own bun test run: two command-line tests, each with its own project. */
import { expect, test } from 'bun:test'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject } from '../../../src/test/harness.ts'

const record = (name: string, dir: string) => {
  const titles = readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; payload: { title?: string } })
    .filter((e) => e.type === 'node.proposed')
    .map((e) => e.payload.title)
  const top = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, stdout: 'pipe' }).stdout.toString().trim()
  appendFileSync(process.env.HELDOUT_OUT!, JSON.stringify({ name, dir, real: realpathSync(dir), titles, top }) + '\n')
}

test('first: adds Alpha, then fails', () => {
  const p = makeProject()
  expect(p.werk(['add', 'alpha', '--title', 'Alpha']).code).toBe(0)
  record('first', p.dir)
  throw new Error('the first test fails on purpose')
})

test('second: adds Beta', () => {
  const p = makeProject()
  expect(p.werk(['add', 'beta', '--title', 'Beta']).code).toBe(0)
  record('second', p.dir)
})
