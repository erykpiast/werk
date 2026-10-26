// The live halves of #werk-hmr-swap-serve-reexec. I/O: a real child process and a timer.
import { describe, expect, test } from 'bun:test'
import { runChild, watchParent } from './hot-child.ts'

describe('the parent', () => {
  test('exits with the exit code of its child', async () => {
    expect(await runChild(['sh', '-c', 'exit 3'], { PATH: process.env.PATH ?? '' })).toBe(3)
  })

  test('counts a child that a signal ended as a failure', async () => {
    expect(await runChild(['sh', '-c', 'kill -9 $$'], { PATH: process.env.PATH ?? '' })).toBe(1)
  })

  test('counts a child that cannot start as a failure', async () => {
    expect(await runChild(['/no/such/program'], {})).toBe(1)
  })
})

describe('the child', () => {
  test('stops itself once its parent is gone, and not before', async () => {
    let up = true
    let stops = 0
    watchParent(1, () => stops++, () => up, 10)
    await Bun.sleep(40)
    expect(stops).toBe(0)
    up = false
    await Bun.sleep(40)
    expect(stops).toBe(1)
  })
})
