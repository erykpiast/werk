/** Group 96: the scripted fake agent. */
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runHeadless } from '../../src/build/headless.ts'
import { makeProject } from '../../src/test/harness.ts'

test('96.1 an edit lands on disk between the two events that surround it', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'first' } }, { edit: { path: 'notes/plan.md', content: '# The plan\n' } }, { event: { type: 'second' } }], exit: 0 })
  const plan = join(p.dir, 'notes', 'plan.md')
  const agent = Bun.spawn(['claude', '-p', 'go'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const seen: { type: string; planThere: boolean; content?: string }[] = []
  let rest = ''
  for await (const chunk of agent.stdout) {
    const parts = (rest + new TextDecoder().decode(chunk)).split('\n')
    rest = parts.pop()!
    for (const part of parts) {
      // The check of the disk runs at the moment the line arrives.
      const there = existsSync(plan)
      seen.push({ type: (JSON.parse(part) as { type: string }).type, planThere: there, ...(there && { content: readFileSync(plan, 'utf8') }) })
    }
  }
  expect(await agent.exited).toBe(0)
  expect(seen.map((s) => s.type)).toEqual(['first', 'second'])
  expect(seen[0]!.planThere).toBe(false)
  expect(seen[1]!.planThere).toBe(true)
  expect(seen[1]!.content).toBe('# The plan\n')
})

test('96.2 the fake agent exits with the exit code of its script after the last step', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }, { event: { type: 'two' } }], exit: 3 })
  const r = p.run(['claude', '-p', 'go'])
  expect(r.code).toBe(3)
  expect(r.stdout).toBe('{"type":"one"}\n{"type":"two"}\n')
})

const snapshot = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: false })
    .map(String)
    // The project, and Bun's own runtime cache in the harness home folder, are not the edit's doing.
    .filter((f) => !f.startsWith('project/') && f !== 'project' && !f.startsWith('Library'))
    .map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`)
    .toSorted()

test('96.3 an edit that leads outside the project fails and writes nothing there', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out' } }], exit: 0 })
  const parent = dirname(p.dir)
  const before = snapshot(parent).filter((f) => !f.startsWith('agent-'))
  const r = p.run(['claude', '-p', 'go'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/outside the project/)
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  expect(snapshot(parent).filter((f) => !f.startsWith('agent-'))).toEqual(before)
})

test('96.4 two launches are recorded in order with their arguments', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'system', subtype: 'init', session_id: 's' } }], exit: 0 })
  // werk's agent launcher reads the agent's environment from the process.
  const saved = { ...process.env }
  Object.assign(process.env, p.env)
  try {
    for (const prompt of ['first request', 'second request']) {
      await runHeadless({ cwd: p.dir, role: 'builder', prompt, timeoutMs: 20_000, overseer: { silenceMs: 20_000, loopEveryMs: 60_000, classifierTimeoutMs: 5_000 } })
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const launches = p.agentLaunches()
  expect(launches).toHaveLength(2)
  expect(launches[0]!.join(' ')).toContain('first request')
  expect(launches[1]!.join(' ')).toContain('second request')
}, 60_000)

test('96.5 the fake agent refuses to run when no script is installed', () => {
  const p = makeProject()
  const r = p.run(['claude', '-p', 'go'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/no script is installed/)
  expect(r.stdout).toBe('')
})
