import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAKE_AGENT_DIR, testEnv } from '../env.ts'
import { makeProject, type TempProject } from '../harness.ts'

let project: TempProject | undefined
afterEach(() => {
  project?.cleanup()
  project = undefined
})

test('claude on the PATH of a test is the fake agent', () => {
  expect(Bun.which('claude')).toBe(join(FAKE_AGENT_DIR, 'claude'))
  expect(spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim()).toBe(join(FAKE_AGENT_DIR, 'claude'))
  expect(Bun.spawnSync(['sh', '-c', 'command -v claude']).stdout.toString().trim()).toBe(join(FAKE_AGENT_DIR, 'claude'))
})

test('a claude started with no explicit environment is still the fake', async () => {
  const sync = Bun.spawnSync(['claude', '-p', 'hi'])
  expect(JSON.parse(sync.stdout.toString().split('\n')[0]!).model).toBe('fake')
  const proc = Bun.spawn(['claude', '-p', 'hi'], { stdout: 'pipe' })
  expect(JSON.parse((await new Response(proc.stdout).text()).split('\n')[0]!).model).toBe('fake')
  expect((await Bun.$`claude -p hi`.text()).split('\n')[0]).toContain('"model":"fake"')
})

test('no WERK_ variable from the outer shell reaches a test', () => {
  expect(Object.keys(process.env).filter((key) => key.startsWith('WERK_'))).toEqual([])
})

test('with no script, the fake emits an init event and a success result', () => {
  const result = spawnSync('claude', ['-p', 'hi'], { env: testEnv(), encoding: 'utf8' })
  expect(result.status).toBe(0)
  const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
  expect(events.map((e) => e.type)).toEqual(['system', 'result'])
})

test('a script emits events, writes files, sets the exit code, and each call is recorded', () => {
  project = makeProject()
  const script = join(project.dir, 'script.json')
  const calls = join(project.dir, 'calls.jsonl')
  writeFileSync(
    script,
    JSON.stringify([
      { emit: { type: 'assistant', text: 'working' } },
      { write: { path: 'out/file.txt', text: 'made by the fake' } },
      { stderr: 'a warning' },
      { exit: 3 },
    ]),
  )
  const result = spawnSync('claude', ['--print', 'go'], {
    cwd: project.dir,
    env: testEnv({ WERK_FAKE_SCRIPT: script, WERK_FAKE_CALLS: calls }),
    encoding: 'utf8',
  })
  expect(result.status).toBe(3)
  expect(JSON.parse(result.stdout)).toEqual({ type: 'assistant', text: 'working' })
  expect(result.stderr).toContain('a warning')
  expect(readFileSync(join(project.dir, 'out/file.txt'), 'utf8')).toBe('made by the fake')
  expect(JSON.parse(readFileSync(calls, 'utf8'))).toEqual({ argv: ['--print', 'go'], cwd: project.dir })
})
