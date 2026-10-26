import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedModules } from './reload.ts'

let root: string | undefined
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

function tree(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'werk-reload-'))
  for (const [path, seconds] of Object.entries(files)) {
    const file = join(dir, path)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '')
    utimesSync(file, seconds, seconds)
  }
  return dir
}

test('names the server modules saved after the last load, sorted, relative to the werk root', () => {
  root = tree({ 'src/server/app.ts': 200, 'src/cli.ts': 300, 'src/server/sse.ts': 50, 'src/map/fold.ts': 99 })
  expect(changedModules(root, 100_000)).toEqual(['src/cli.ts', 'src/server/app.ts'])
})

test('leaves out tests and the client, which the server never imports', () => {
  root = tree({ 'src/server/app.test.ts': 200, 'src/client/App.tsx': 200, 'src/client/route.ts': 200, 'src/map/view.ts': 200 })
  expect(changedModules(root, 100_000)).toEqual(['src/map/view.ts'])
})

test('a file saved before the last load is not named', () => {
  root = tree({ 'src/server/app.ts': 50 })
  expect(changedModules(root, 100_000)).toEqual([])
})
