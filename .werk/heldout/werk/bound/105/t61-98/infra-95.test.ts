import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { makeProject, serveProject } from '../../src/test/harness.ts'

const ROOT = join(import.meta.dir, '..', '..')
const fakeBin = (process.env.PATH ?? '').split(':')[0]!
/** The person's shell PATH: the run's PATH without the preload's fake agent folder. */
const shellPath = () => (process.env.PATH ?? '').split(':').slice(1).join(':')
const readReport = (path: string) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('95.1 two tests that each write a card see only their own card', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'heldout-95-1-')), 'report.jsonl')
  writeFileSync(out, '')
  const r = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/t61-98/inner/two-tests.inner.ts'], {
    cwd: ROOT,
    env: { PATH: shellPath(), HOME: process.env.HOME!, HELDOUT_REPORT: out, CI: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const text = r.stdout.toString() + r.stderr.toString()
  const rep = readReport(out)
  const first = rep.find((e) => e.test === 'first')
  const second = rep.find((e) => e.test === 'second')
  expect(first.titles).toEqual(['Alpha'])
  expect(second.titles).toEqual(['Beta'])
  expect(first.dir).not.toBe(second.dir)
  expect(first.toplevel.endsWith(first.dir.split('/').slice(-2).join('/'))).toBe(true)
  expect(second.toplevel.endsWith(second.dir.split('/').slice(-2).join('/'))).toBe(true)
  expect(text).toMatch(/\b1 pass\b/)
  expect(text).toMatch(/\b1 fail\b/)
  expect(r.exitCode).not.toBe(0)
  expect(existsSync(first.dir)).toBe(false)
  expect(existsSync(second.dir)).toBe(false)
}, 60_000)

let served: { url: string; dir: string } | undefined
test('95.2 (part 1) a server test asks the harness for a project and opens an empty map', async () => {
  const p = makeProject()
  const s = serveProject(p)
  const url = await s.url
  const res = await fetch(`${url}api/graph`)
  expect(res.ok).toBe(true)
  const graph = (await res.json()) as { nodes?: unknown[] }
  expect(JSON.stringify(graph)).not.toMatch(/"id":"[^"]+"/)
  served = { url, dir: p.dir }
}, 30_000)

test('95.2 (part 2) after that test ends, its port answers no request and its project is gone', async () => {
  expect(served).toBeDefined()
  let answered = true
  try {
    await fetch(`${served!.url}api/graph`, { signal: AbortSignal.timeout(3000) })
  } catch {
    answered = false
  }
  expect(answered).toBe(false)
  expect(existsSync(served!.dir)).toBe(false)
})

test('95.3 a real project setting and a real agent never reach a test', () => {
  const realClaude = Bun.spawnSync(['/usr/bin/which', '-a', 'claude'], { env: { PATH: shellPath() } }).stdout.toString().trim().split('\n').filter((l) => !l.startsWith(fakeBin))
  expect(realClaude.length).toBeGreaterThan(0)
  // the map the person works in
  const workDir = mkdtempSync(join(tmpdir(), 'heldout-95-3-'))
  const workLog = join(workDir, 'log.jsonl')
  writeFileSync(workLog, JSON.stringify({ seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type: 'node.proposed', payload: { id: 'mine', kind: 'card', title: 'Mine' } }) + '\n')
  const before = readFileSync(workLog, 'utf8')
  const out = join(workDir, 'report.jsonl')
  writeFileSync(out, '')
  const r = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/t61-98/inner/env.inner.ts'], {
    cwd: ROOT,
    env: { PATH: `${dirname(realClaude[0]!)}:${shellPath()}`, HOME: process.env.HOME!, WERK_LOG: workLog, HELDOUT_REPORT: out, CI: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const rep = readReport(out)
  expect(rep.find((e) => e.test === 'setting').WERK_LOG).toBeNull()
  const agent = rep.find((e) => e.test === 'agent')
  expect(agent.stdout).toContain('FAKE-REPLY-95')
  expect(r.exitCode).toBe(0)
  expect(readFileSync(workLog, 'utf8')).toBe(before)
  rmSync(workDir, { recursive: true, force: true })
}, 60_000)
