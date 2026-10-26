import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchLog } from './watch.ts'

let dir: string | undefined
let watcher: FSWatcher | undefined
afterEach(() => {
  watcher?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
  watcher = undefined
  dir = undefined
})

/** Resolves on the next call of the watcher's callback, or fails after the timeout. */
const nextCall = (calls: (() => void)[], timeoutMs = 3_000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no change seen in ${timeoutMs} ms`)), timeoutMs)
    calls.push(() => {
      clearTimeout(timer)
      resolve()
    })
  })

const start = () => {
  dir = mkdtempSync(join(tmpdir(), 'werk-watch-'))
  const path = join(dir, '.werk', 'log.jsonl')
  const calls: (() => void)[] = []
  watcher = watchLog(path, () => calls.splice(0).forEach((call) => call()))
  return { path, calls }
}

test('a log that does not exist yet is seen when the first event creates it', async () => {
  const { path, calls } = start()
  const seen = nextCall(calls)
  appendFileSync(path, '{"seq":1}\n')
  await seen
})

test('each append to the log is seen', async () => {
  const { path, calls } = start()
  appendFileSync(path, '{"seq":1}\n')
  await Bun.sleep(100)
  const seen = nextCall(calls)
  appendFileSync(path, '{"seq":2}\n')
  await seen
})

test('a removed log directory does not throw from the watcher', async () => {
  start()
  rmSync(join(dir!, '.werk'), { recursive: true, force: true })
  await Bun.sleep(100)
})
