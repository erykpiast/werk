import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { cloneRepo, sh } from './helpers.ts'

const verbsOf = (out: string) => [...out.matchAll(/^\s{2}([a-z][a-z0-9-]*)\s{2,}/gm)].map((m) => m[1]!)

test('61.2 help lists every registered verb, and a new verb module appears with no other edit', () => {
  const { dir, done } = cloneRepo()
  try {
    expect(sh('bun install --frozen-lockfile', dir).code).toBe(0)
    const before = sh('bun src/cli/main.ts help', dir)
    expect(before.code).toBe(0)
    const listed = verbsOf(before.out)
    expect(listed).toContain('help')
    // Every verb the command line registers.
    const reg = sh(
      `bun -e "const {loadVerbs}=await import('./src/cli/load-verbs.ts');const {registry}=await import('./src/cli/registry.ts');await loadVerbs();console.log(JSON.stringify(registry.list().map(v=>v.name)))"`,
      dir,
    )
    const registered = JSON.parse(reg.out.trim().split('\n').at(-1)!) as string[]
    for (const v of registered) expect(listed).toContain(v)

    writeFileSync(
      join(dir, 'src/cli/verbs/ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const after = sh('bun src/cli/main.ts help', dir)
    expect(after.code).toBe(0)
    const listedAfter = verbsOf(after.out)
    expect(listedAfter).toContain('ping')
    for (const v of listed) expect(listedAfter).toContain(v)
    expect(sh('git status --porcelain', dir).out.trim().split('\n')).toEqual(['?? src/cli/verbs/ping.ts'])
  } finally {
    done()
  }
}, 300_000)
