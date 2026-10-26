/** Held-out steps 96.x: the fake agent, started by its real name in a fresh temporary project. */
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runHeadless } from '../src/build/headless.ts'
import { makeProject } from '../src/test/harness.ts'

test('96.1 An edit lands on disk between the two events that surround it', async () => {
  // Given a fresh temporary project with the fake agent first in the program search list
  const p = makeProject()
  expect(Bun.which('claude', { PATH: p.env.PATH })).toBe(join(p.env.PATH!.split(':')[0]!, 'claude'))
  // And a script with an event "first", an edit of "notes/plan.md", an event "second", exit 0.
  // A gate file holds the agent after "first" so the disk check at that moment cannot race the edit.
  const gate = join(p.dir, '..', 'gate-96-1')
  p.scriptAgent({
    steps: [
      { event: { type: 'first' } },
      { waitFor: gate },
      { edit: { path: 'notes/plan.md', content: '# The plan\n' } },
      { event: { type: 'second' } },
    ],
    exit: 0,
  })
  // When the test writer starts the agent by its real name in the project
  const agent = Bun.spawn(['claude', '-p', 'go'], { cwd: p.dir, env: p.env, stdout: 'pipe' })
  const file = join(p.dir, 'notes', 'plan.md')
  const seen: { type: string; onDisk: string | null }[] = []
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of agent.stdout) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n')
    rest = parts.pop()!
    for (const part of parts) {
      const { type } = JSON.parse(part) as { type: string }
      seen.push({ type, onDisk: existsSync(file) ? readFileSync(file, 'utf8') : null })
      if (type === 'first') writeFileSync(gate, '')
    }
  }
  const code = await agent.exited
  // Then "first" is one line; at that moment notes/plan.md is not there
  expect(seen[0]).toEqual({ type: 'first', onDisk: null })
  // And "second" is the next line; at that moment the file holds the scripted content
  expect(seen[1]).toEqual({ type: 'second', onDisk: '# The plan\n' })
  expect(seen).toHaveLength(2)
  // And the agent exits with code 0
  expect(code).toBe(0)
})

test('96.2 The fake agent exits with the exit code of its script after the last step', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'one' } }, { event: { type: 'two' } }], exit: 3 })
  const r = p.run(['claude', '-p', 'go'])
  // Then both events in script order, exit 3, nothing after the second event
  expect(r.stdout).toBe('{"type":"one"}\n{"type":"two"}\n')
  expect(r.code).toBe(3)
})

/** Every file under a folder, with its size and change time. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const s = statSync(join(dir, name))
    if (s.isFile()) out[name] = `${s.size}:${s.mtimeMs}`
  }
  return out
}

test('96.3 An edit that leads outside the project fails and writes nothing there', () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ edit: { path: '../escaped.txt', content: 'out' } }], exit: 0 })
  const parent = dirname(p.dir)
  const before = snapshot(parent)
  const r = p.run(['claude', '-p', 'go'])
  // Then the edit step fails and the agent reports the failure
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/outside the project/)
  // And no file "escaped.txt" exists in the parent directory of the project
  expect(existsSync(join(parent, 'escaped.txt'))).toBe(false)
  // And no file outside the project changed (the launch record and bun's own cache in the harness home are not the agent's edit)
  const after = snapshot(parent)
  const outside = (s: Record<string, string>) =>
    Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('project/') && !k.startsWith('Library/') && k !== 'agent-launches.jsonl'))
  expect(outside(after)).toEqual(outside(before))
})

test('96.4 Two launches are recorded in order with their arguments', async () => {
  const p = makeProject()
  p.scriptAgent({ steps: [{ event: { type: 'result', subtype: 'success' } }], exit: 0 })
  // werk starts its agents with the environment of its process: point it at the project.
  const saved = { ...process.env }
  Object.assign(process.env, p.env)
  try {
    const start = (prompt: string) =>
      runHeadless({
        cwd: p.dir,
        role: 'builder',
        prompt,
        timeoutMs: 20_000,
        overseer: { silenceMs: 10_000, loopEveryMs: 600_000, classifierTimeoutMs: 1_000 },
      })
    // When werk starts the agent with the request "first request", then again with "second request"
    await start('first request')
    await start('second request')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  // Then the launch record in the project holds two entries
  const launches = p.agentLaunches()
  expect(launches).toHaveLength(2)
  // And the first entry holds the arguments with "first request"; the second with "second request"
  // A launch is its argv plus the input lines the harness ties to that launch.
  const inputs = p.agentInputs()
  const holds = (i: number, text: string) => JSON.stringify(launches[i]).includes(text) || JSON.stringify(inputs[i]).includes(text)
  console.log(JSON.stringify({ launches, inputs }))
  expect(holds(0, 'first request')).toBe(true)
  expect(holds(1, 'second request')).toBe(true)
  expect(holds(0, 'second request')).toBe(false)
})

test('96.5 The fake agent refuses to run when no script is installed', () => {
  const p = makeProject()
  const r = p.run(['claude', '-p', 'go'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/no script is installed/)
  expect(r.stdout).toBe('')
})
