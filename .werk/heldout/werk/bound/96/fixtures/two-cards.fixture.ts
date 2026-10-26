/** 95.1: two command-line tests, each with its own project. The first fails on purpose after its add. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { makeProject } from '../../src/test/harness.ts'

const record = (line: object) => appendFileSync(process.env.HELDOUT_OUT!, JSON.stringify(line) + '\n')


test('the first test adds Alpha, then fails', async () => {
  const p = makeProject()
  const add = p.werk(['add', 'alpha', '--title', 'Alpha'])
  const log = await Bun.file(`${p.dir}/.werk/log.jsonl`).text()
  const git = p.run(['git', 'rev-parse', '--show-toplevel'])
  record({ test: 1, dir: p.dir, addCode: add.code, log, gitTop: git.stdout.trim() })
  throw new Error('this test fails on purpose')
})

test('the second test adds Beta', async () => {
  const p = makeProject()
  const add = p.werk(['add', 'beta', '--title', 'Beta'])
  const log = await Bun.file(`${p.dir}/.werk/log.jsonl`).text()
  const git = p.run(['git', 'rev-parse', '--show-toplevel'])
  record({ test: 2, dir: p.dir, addCode: add.code, log, gitTop: git.stdout.trim() })
  expect(add.code).toBe(0)
})
