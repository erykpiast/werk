/** 61.2, 61.3, 61.4: the help verb registry, a run with no real agent, and the coverage gate. */
import { expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh } from './clone.ts'

const LONG = 1_800_000
const verbsOf = (help: string) =>
  help
    .split('\n')
    .map((l) => /^ {2}([a-z][a-z0-9-]*)\s/.exec(l)?.[1])
    .filter((v): v is string => v !== undefined)

test('61.2 the help verb lists every registered verb, and a new verb module appears with no other edit', () => {
  const dir = freshClone()
  expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
  const before = sh('bun src/cli/main.ts help', dir)
  expect(before.code).toBe(0)
  const verbs = verbsOf(before.out)
  // Every verb that the command line registers: one module per verb in src/cli/verbs.
  const registered = sh('ls src/cli/verbs', dir)
    .out.trim()
    .split('\n')
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => readFileSync(join(dir, 'src/cli/verbs', f), 'utf8').match(/name: '([a-z][a-z0-9-]*)'/)?.[1])
  expect(verbs.toSorted()).toEqual((registered as string[]).toSorted())
  expect(verbs).toContain('help')

  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const after = sh('bun src/cli/main.ts help', dir)
  expect(after.code).toBe(0)
  const afterVerbs = verbsOf(after.out)
  expect(afterVerbs).toContain('ping')
  for (const v of verbs) expect(afterVerbs).toContain(v)
  expect(sh('git status --porcelain', dir).out.trim()).toBe('?? src/cli/verbs/ping.ts')
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)

test('61.3 the tests pass on a machine with no real agent installed', () => {
  const dir = freshClone()
  // A PATH with no folder that holds a claude program.
  const path = (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
    .join(':')
  const env = { ...process.env, PATH: path }
  expect(sh('command -v claude', dir, env).code).not.toBe(0)
  const r = sh('make test', dir, env)
  console.log(r.out.slice(-800))
  expect(r.code).toBe(0)
  // The command-line tests of the fake agent ran and passed: they script events and a file edit in a temporary project.
  const cliTest = readFileSync(join(dir, 'src/cli/build.test.ts'), 'utf8')
  expect(cliTest).toContain('makeProject')
  expect(cliTest).toMatch(/\{ edit: \{ path:/)
  expect(cliTest).toMatch(/\{ event: \{ type:/)
  expect(r.out).toMatch(/ 0 fail/)
  expect(sh('git status --porcelain', dir).out.trim()).toBe('')
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)

test('61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above', () => {
  const dir = freshClone()
  expect(sh('make test-coverage', dir).code).toBe(0)
  const testFile = join(dir, 'src/map/derive.test.ts')
  // Delete every unit test of src/map/derive.ts but its first one.
  const lines = readFileSync(testFile, 'utf8').split('\n')
  const cut = lines.findIndex((l) => l.startsWith('  })')) + 1
  writeFileSync(testFile, [...lines.slice(0, cut), '})', ''].join('\n'))

  const plain = sh('make test', dir)
  expect(plain.code).toBe(0)
  const gated = sh('make test-coverage', dir)
  console.log(gated.out.split('\n').filter((l) => /derive|gate/.test(l)).join('\n'))
  expect(gated.code).not.toBe(0)
  expect(gated.out).toMatch(/FAIL\s+\d+(\.\d+)?%\s+src\/map\/derive\.ts/)

  expect(sh('git checkout -- src/map/derive.test.ts', dir).code).toBe(0)
  expect(sh('make test-coverage', dir).code).toBe(0)
  rmSync(join(dir, '..'), { recursive: true, force: true })
}, LONG)
