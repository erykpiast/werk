/** Held-out steps 95.1, 95.2, 95.3: the scope and the clean environment of the unit test harness. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import { makeProject, serveProject } from '../../src/test/harness.ts'

/** macOS puts the temporary folder under /private; git names that real path. */
const norm = (p: unknown) => String(p).replace(/^\/private\//, '/')
const ROOT = join(import.meta.dir, '..', '..')
const readOut = (path: string) =>
  readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)

test(
  '95.1 two tests that each write a card see only their own card',
  () => {
    const work = mkdtempSync(join(tmpdir(), 'h951-'))
    const out = join(work, 'out.jsonl')
    const r = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/harness/scope.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, H95_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const report = r.stderr.toString()
    const seen = readOut(out)
    const first = seen.find((s) => s.test === 'first')!
    const second = seen.find((s) => s.test === 'second')!
    expect(first.titles).toEqual(['Alpha'])
    expect(second.titles).toEqual(['Beta'])
    expect(first.dir).not.toBe(second.dir)
    expect(norm(first.top)).toBe(norm(first.dir))
    expect(norm(second.top)).toBe(norm(second.dir))
    expect(report).toMatch(/\b1 pass\b/)
    expect(report).toMatch(/\b1 fail\b/)
    expect(existsSync(first.dir as string)).toBe(false)
    expect(existsSync(second.dir as string)).toBe(false)
  },
  60_000,
)

let served: { url: string; dir: string } | undefined

test('95.2 (part 1) a server test starts a server on its own port and sees an empty map', async () => {
  const p = makeProject()
  const server = serveProject(p)
  const url = await server.url
  const res = await fetch(new URL('api/graph', url))
  expect(res.ok).toBe(true)
  const graph = (await res.json()) as { nodes?: unknown[] }
  expect(graph.nodes ?? []).toEqual([])
  served = { url, dir: p.dir }
}, 30_000)

test('95.2 (part 2) after the test ends, the port gives no answer and the project directory is gone', async () => {
  expect(served).toBeDefined()
  const answered = await fetch(new URL('api/graph', served!.url), { signal: AbortSignal.timeout(3000) }).then(
    () => true,
    () => false,
  )
  expect(answered).toBe(false)
  expect(existsSync(served!.dir)).toBe(false)
})

test(
  '95.3 a real project setting and a real agent never reach a test',
  () => {
    const work = mkdtempSync(join(tmpdir(), 'h953-'))
    // The map the person works in, with one event in it.
    const real = makeProject()
    expect(real.werk(['add', 'mine', '--title', 'My own card']).code).toBe(0)
    const realLog = join(real.dir, '.werk', 'log.jsonl')
    const before = readFileSync(realLog, 'utf8')
    // The real agent: it marks that it ran.
    const realBin = join(work, 'real-bin')
    mkdirSync(realBin)
    writeFileSync(join(realBin, 'claude'), `#!/bin/sh\ntouch ${JSON.stringify(join(work, 'real-agent-ran'))}\necho REAL-AGENT\n`, { mode: 0o755 })
    const out = join(work, 'out.jsonl')
    const r = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/harness/env.fixture.ts'], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${realBin}:${process.env.PATH}`, WERK_LOG: realLog, H95_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const seen = readOut(out)
    expect(seen.find((s) => s.test === 'setting')!.WERK_LOG).toBeNull()
    const agent = seen.find((s) => s.test === 'agent')!
    expect(agent.stdout).toContain('FAKE-REPLY-MARK')
    expect(agent.stdout).not.toContain('REAL-AGENT')
    expect(existsSync(join(work, 'real-agent-ran'))).toBe(false)
    expect(r.stderr.toString()).toContain('0 fail')
    expect(readFileSync(realLog, 'utf8')).toBe(before)
    expect(fold(readLog(realLog)).nodes.size).toBe(1)
  },
  60_000,
)
