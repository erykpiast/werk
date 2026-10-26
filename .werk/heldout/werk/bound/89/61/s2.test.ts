import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, sh, tail } from './util.ts'

const verbsIn = (helpOut: string) =>
  helpOut
    .split('\n')
    .map((l) => /^ {2}([a-z][a-z0-9-]*)\s/.exec(l)?.[1])
    .filter((v): v is string => !!v)

// 61.2
// Scenario: The help verb lists every registered verb, and a new verb module appears in it with no other edit
// Given a person has a copy of the werk project with its dependencies installed
// When the person runs `werk help`
// Then the output names every verb that the command line registers, and `help` is one of them
// When the person adds one new module that defines and registers a verb named `ping`
// And the person changes no other file in the project
// And the person runs `werk help` again
// Then the output names `ping` together with every verb it named before
// And `git status` shows the new module as the only changed file
test('61.2', () => {
  const dir = freshClone('s2')
  const install = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(install.code, tail(install.out)).toBe(0)

  // What the command line registers: load the verbs the way main.ts does, from a script outside the clone.
  const probe = join(dir, '..', 'probe.ts')
  writeFileSync(
    probe,
    `import { loadVerbs } from ${JSON.stringify(join(dir, 'src/cli/load-verbs.ts'))}\n` +
      `import { registry } from ${JSON.stringify(join(dir, 'src/cli/registry.ts'))}\n` +
      `await loadVerbs()\nconsole.log(JSON.stringify(registry.list().map((v) => v.name)))\n`,
  )
  const registered: string[] = JSON.parse(sh(['bun', probe], dir).out.trim())

  const help1 = sh(['bun', 'src/cli/main.ts', 'help'], dir)
  expect(help1.code).toBe(0)
  const before = verbsIn(help1.out)
  expect(before).toContain('help')
  expect(before.toSorted()).toEqual(registered.toSorted())
  for (const v of registered) expect(help1.out).toContain(v)
  console.log(`61.2: help names ${before.length} verbs: ${before.join(' ')}`)

  writeFileSync(
    join(dir, 'src/cli/verbs/ping.ts'),
    `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
  )
  const help2 = sh(['bun', 'src/cli/main.ts', 'help'], dir)
  expect(help2.code).toBe(0)
  const after = verbsIn(help2.out)
  expect(after).toContain('ping')
  expect(after.toSorted()).toEqual([...before, 'ping'].toSorted())

  const status = sh(['git', 'status', '--porcelain'], dir).out.trim().split('\n')
  console.log(`61.2: git status: ${JSON.stringify(status)}`)
  expect(status).toEqual(['?? src/cli/verbs/ping.ts'])
}, 600_000)
