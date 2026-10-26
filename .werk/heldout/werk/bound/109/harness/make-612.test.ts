/** Held-out step 61.2: the help verb lists every registered verb, and a new verb module appears with no other edit. */
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, git, HOURS, personEnv, sh } from './clone.ts'

const LIST = `import { loadVerbs } from './src/cli/load-verbs.ts'
import { registry } from './src/cli/registry.ts'
await loadVerbs()
console.log(JSON.stringify(registry.list().map((v) => v.name)))`

const names = (help: string, verbs: string[]) => verbs.filter((v) => !new RegExp(`(^|[^a-z-])${v}([^a-z-]|$)`, 'm').test(help))

test(
  '61.2 the help verb lists every registered verb, and a new verb module appears in it with no other edit',
  async () => {
    const { dir } = freshClone()
    const env = personEnv()
    expect((await sh(['bun', 'install', '--frozen-lockfile'], dir, env)).code).toBe(0)
    const registered = JSON.parse((await sh(['bun', '-e', LIST], dir, env)).out.trim().split('\n').at(-1)!) as string[]
    expect(registered).toContain('help')

    const help1 = await sh(['bun', 'src/cli/main.ts', 'help'], dir, env)
    expect(help1.code).toBe(0)
    expect(names(help1.out, registered)).toEqual([])
    expect(names(help1.out, ['ping'])).toEqual(['ping'])

    writeFileSync(
      join(dir, 'src', 'cli', 'verbs', 'ping.ts'),
      `import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run: (_args, io) => {\n    io.out('pong')\n    return 0\n  },\n})\n`,
    )
    const help2 = await sh(['bun', 'src/cli/main.ts', 'help'], dir, env)
    expect(help2.code).toBe(0)
    expect(names(help2.out, ['ping', ...registered])).toEqual([])
    expect(git(dir, 'status', '--porcelain', '--untracked-files=all')).toBe('?? src/cli/verbs/ping.ts')
  },
  HOURS,
)
