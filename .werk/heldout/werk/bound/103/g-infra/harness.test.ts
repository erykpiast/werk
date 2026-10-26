/** Held-out steps 95.1 to 95.3: the test harness keeps each test apart from the person's world. */
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProject, serveProject } from '../../src/test/harness.ts'

const CHECKOUT = join(import.meta.dir, '..', '..')
const HARNESS = join(CHECKOUT, 'src/test/harness.ts')
const LOG = join(CHECKOUT, 'src/map/log.ts')

/** Runs a generated test file with the project's own test setup, from the checkout. */
function runGenerated(name: string, body: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'werk-heldout-gen-'))
  const file = join(dir, name)
  writeFileSync(file, body)
  const p = Bun.spawnSync([process.execPath, 'test', file], { cwd: CHECKOUT, env, stdout: 'pipe', stderr: 'pipe' })
  rmSync(dir, { recursive: true, force: true })
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() }
}

test(
  '95.1 two tests that each write a card see only their own card',
  () => {
    const body = `
import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject } from ${JSON.stringify(HARNESS)}
import { readLog } from ${JSON.stringify(LOG)}
const titles = (dir) => readLog(join(dir, '.werk', 'log.jsonl')).map((e) => e.payload?.title).filter(Boolean)
for (const [name, title, fails] of [['alpha', 'Alpha', true], ['beta', 'Beta', false]]) {
  test(name, () => {
    const p = makeProject()
    expect(p.werk(['add', name, '--title', title]).code).toBe(0)
    console.log('REPORT ' + JSON.stringify({ name, dir: p.dir, titles: titles(p.dir), git: existsSync(join(p.dir, '.git')) }))
    if (fails) throw new Error('made to fail')
  })
}
`
    const r = runGenerated('two.test.ts', body, { ...process.env } as Record<string, string>)
    const reports = [...r.out.matchAll(/REPORT (\{.*\})/g)].map((m) => JSON.parse(m[1]!))
    expect(reports).toHaveLength(2)
    const [a, b] = reports
    expect(a.titles).toEqual(['Alpha'])
    expect(b.titles).toEqual(['Beta'])
    expect(a.git && b.git).toBe(true)
    expect(a.dir).not.toBe(b.dir)
    expect(r.out).toMatch(/\b1 pass\b/)
    expect(r.out).toMatch(/\b1 fail\b/)
    expect(existsSync(a.dir)).toBe(false)
    expect(existsSync(b.dir)).toBe(false)
  },
  60_000,
)

let served: { url: string; dir: string } | undefined
test('95.2 (part 1) a server test opens an empty map from its own port', async () => {
  const p = makeProject()
  const s = serveProject(p)
  const url = await s.url
  const graph = (await (await fetch(`${url}api/graph`)).json()) as { nodes: unknown[] }
  expect(graph.nodes).toEqual([])
  served = { url, dir: p.dir }
}, 30_000)

test('95.2 (part 2) after the server test ends, its port gives no answer and its project is gone', async () => {
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

test(
  '95.3 a real project setting and a real agent never reach a test',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-person-'))
    try {
      // The person's own map, which their shell points at.
      const map = join(root, 'my-project', '.werk', 'log.jsonl')
      mkdirSync(join(root, 'my-project', '.werk'), { recursive: true })
      const event = JSON.stringify({ seq: 1, at: '2026-01-01T00:00:00Z', actor: 'you', type: 'propose', node: { id: 'mine', kind: 'card', title: 'Mine' } })
      writeFileSync(map, event + '\n')
      const before = readFileSync(map, 'utf8')
      // A stand-in for the real agent: it says so and writes to the person's map.
      const realBin = join(root, 'real-bin')
      mkdirSync(realBin)
      writeFileSync(join(realBin, 'claude'), `#!/bin/sh\necho '{"type":"REAL-AGENT"}'\necho '{"seq":2,"type":"leak"}' >> ${JSON.stringify(map)}\n`)
      chmodSync(join(realBin, 'claude'), 0o755)
      const body = `
import { expect, test } from 'bun:test'
import { scriptRunAgent } from ${JSON.stringify(HARNESS)}
test('reads the project setting', () => {
  console.log('SETTING ' + JSON.stringify(process.env.WERK_LOG ?? null))
  expect(process.env.WERK_LOG).toBeUndefined()
})
test('starts the agent by name', () => {
  scriptRunAgent({ steps: [{ event: { type: 'fake-reply' } }] })
  const out = Bun.spawnSync(['claude', '-p', 'x']).stdout.toString()
  console.log('AGENT ' + JSON.stringify(out))
  expect(out).toBe('{"type":"fake-reply"}\\n')
})
`
      // The person's shell: the real agent on PATH, and WERK_LOG pointing at their map.
      const shell = { ...process.env, PATH: `${realBin}:${process.env.PATH}`, WERK_LOG: map } as Record<string, string>
      const r = runGenerated('env.test.ts', body, shell)
      expect(r.out).toContain('SETTING null')
      expect(r.out).toContain('AGENT "{\\"type\\":\\"fake-reply\\"}\\n"')
      expect(r.out).toMatch(/\b2 pass\b/)
      expect(r.code).toBe(0)
      expect(readFileSync(map, 'utf8')).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  60_000,
)
