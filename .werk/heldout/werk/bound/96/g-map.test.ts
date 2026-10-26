/** Held-out step 69.4: the messages of a second server on the same project. */
import { expect, test } from 'bun:test'
import { makeProject, serveProject } from '../src/test/harness.ts'

test('69.4 a second server says it waits for the first pid, then stops with an error that names it', async () => {
  const p = makeProject()
  expect(p.werk(['add', 'root', '--title', 'Root card']).code).toBe(0)
  expect(p.werk(['accept', 'root', '--actor', 'you']).code).toBe(0)
  const first = serveProject(p)
  const url = await first.url
  const before = await (await fetch(`${url}api/graph`)).json()

  const t0 = Date.now()
  const second = serveProject(p)
  const code = await second.proc.exited
  const took = Date.now() - t0
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8000)
  expect(second.stderr()).toMatch(new RegExp(`wait[^\\n]*${first.proc.pid}`))
  expect(second.stderr()).toMatch(/error|already|refus/i)
  expect(second.stderr().split('\n').filter((l) => !/wait/.test(l)).join('\n')).toContain(String(first.proc.pid))

  const after = await (await fetch(`${url}api/graph`)).json()
  expect(after).toEqual(before)
}, 30_000)
