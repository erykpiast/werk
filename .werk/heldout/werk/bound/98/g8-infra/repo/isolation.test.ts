/** 95.1, 95.3, 95.4: test isolation, run as a test writer would, in a fresh clone. */
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshClone, sh } from './clone.ts'

const LONG = 1_800_000

test('95.1 two tests that each write a card see only their own card', () => {
  const dir = freshClone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const out = join(mkdtempSync(join(tmpdir(), 'werk-heldout-95-')), 'seen.jsonl')
  writeFileSync(
    join(dir, 'src/heldout-two.test.ts'),
    `import { expect, test } from 'bun:test'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject } from './test/harness.ts'
const OUT = ${JSON.stringify(out)}
const titles = (dir: string) => readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').split('\\n').filter(Boolean)
  .map((l) => JSON.parse(l)).filter((e) => e.type === 'node.proposed').map((e) => e.payload.title)
function card(id: string, title: string) {
  const p = makeProject()
  const r = p.werk(['add', id, '--title', title])
  appendFileSync(OUT, JSON.stringify({ title, dir: p.dir, add: r.code, titles: titles(p.dir), git: existsSync(join(p.dir, '.git')) }) + '\\n')
}
test('alpha', () => {
  card('alpha', 'Alpha')
  expect('made to fail').toBe('after the card')
})
test('beta', () => {
  card('beta', 'Beta')
})
`,
  )
  const r = sh('bun test ./src/heldout-two.test.ts', dir)
  console.log(r.out.slice(-600))
  const seen = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  expect(seen).toHaveLength(2)
  expect(seen[0].titles).toEqual(['Alpha'])
  expect(seen[1].titles).toEqual(['Beta'])
  expect(seen[0].git && seen[1].git).toBe(true)
  expect(seen[0].dir).not.toBe(seen[1].dir)
  expect(r.out).toMatch(/1 pass/)
  expect(r.out).toMatch(/1 fail/)
  for (const s of seen) expect(existsSync(s.dir)).toBe(false)
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)

test('95.3 a real project setting and a real agent never reach a test', () => {
  const dir = freshClone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const base = mkdtempSync(join(tmpdir(), 'werk-heldout-95-3-'))
  // The map the person works in.
  const work = join(base, 'work')
  mkdirSync(join(work, '.werk'), { recursive: true })
  const log = join(work, '.werk', 'log.jsonl')
  writeFileSync(log, JSON.stringify({ seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'you', type: 'node.proposed', payload: { id: 'mine', kind: 'card', title: 'Mine' } }) + '\n')
  const before = readFileSync(log, 'utf8')
  // The real agent program, first on the person's search list. It leaves a mark when it runs.
  const realBin = join(base, 'real-bin')
  mkdirSync(realBin)
  const mark = join(base, 'real-agent-ran')
  writeFileSync(join(realBin, 'claude'), `#!/bin/sh\ntouch ${JSON.stringify(mark)}\necho '{"type":"real"}'\n`)
  chmodSync(join(realBin, 'claude'), 0o755)

  writeFileSync(
    join(dir, 'src/heldout-env.test.ts'),
    `import { expect, test } from 'bun:test'
import { scriptRunAgent } from './test/harness.ts'
test('finds no project setting', () => {
  expect(process.env.WERK_LOG).toBeUndefined()
})
test('starts the agent by name with no environment of its own', async () => {
  scriptRunAgent({ steps: [{ event: { type: 'fake-reply' } }], exit: 0 })
  const p = Bun.spawn(['claude', '-p', 'hello'], { stdout: 'pipe' })
  const out = await new Response(p.stdout).text()
  expect(await p.exited).toBe(0)
  expect(JSON.parse(out.trim())).toEqual({ type: 'fake-reply' })
})
`,
  )
  const env = { ...process.env, WERK_LOG: log, PATH: `${realBin}:${process.env.PATH}` }
  expect(sh('command -v claude', dir, env).out.trim()).toBe(join(realBin, 'claude'))
  const r = sh('bun test ./src/heldout-env.test.ts', dir, env)
  console.log(r.out.slice(-800))
  expect(r.out).toMatch(/2 pass/)
  expect(r.out).toMatch(/0 fail/)
  expect(existsSync(mark)).toBe(false)
  expect(readFileSync(log, 'utf8')).toBe(before)
  rmSync(join(dir, '..'), { recursive: true, force: true })
  rmSync(base, { recursive: true, force: true })
}, LONG)

test('95.4 the browser test server refuses to start when the fake agent is not first', () => {
  const dir = freshClone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const base = mkdtempSync(join(tmpdir(), 'werk-heldout-95-4-'))
  const realBin = join(base, 'real-bin')
  mkdirSync(realBin)
  writeFileSync(join(realBin, 'claude'), `#!/bin/sh\necho real\n`)
  chmodSync(join(realBin, 'claude'), 0o755)
  const env = { ...process.env, PATH: `${realBin}:${process.env.PATH}` }
  const r = sh('CI=true bunx playwright test e2e/map.spec.ts', dir, env)
  console.log(r.code, r.out.slice(-1500))
  // No browser test runs, and the server refuses with a message that names the fake agent and PATH.
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/fake agent/)
  expect(r.out).toMatch(/PATH/)
  expect(r.out).not.toMatch(/\d+ passed/)
  rmSync(join(dir, '..'), { recursive: true, force: true })
  rmSync(base, { recursive: true, force: true })
}, LONG)
