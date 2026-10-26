/** Held-out step 61.3: the tests pass on a machine with no real agent installed. Runs in a clone outside the repo. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { freshClone, HOURS, pathWithoutClaude, personEnv, sh, status } from './clone.ts'

test(
  '61.3 the tests pass on a machine with no real agent installed',
  async () => {
    const { dir, root } = freshClone()
    const tmp = join(root, 'tmp')
    mkdirSync(tmp)
    const base = personEnv()
    const env = { ...base, PATH: pathWithoutClaude(base.PATH!, join(root, 'shims')), TMPDIR: tmp }
    expect(Bun.which('claude', { PATH: env.PATH })).toBeNull()
    expect(Bun.spawnSync(['sh', '-c', 'command -v claude'], { env }).exitCode).not.toBe(0)

    // The dependencies are installed before the run.
    expect((await sh(['bun', 'install', '--frozen-lockfile'], dir, env)).code).toBe(0)
    expect((await sh(['touch', join(dir, 'node_modules', '.installed')], dir, env)).code).toBe(0)
    const before = status(dir)

    // Watch the temporary folder while the tests run: a command-line test's fake agent reads its script there.
    const seen = { scriptedProjects: 0, withRepo: 0 }
    let watching = true
    const watch = (async () => {
      while (watching) {
        for (const d of readdirSync(tmp)) {
          if (!d.startsWith('werk-project-')) continue
          if (existsSync(join(tmp, d, 'agent-script.json'))) seen.scriptedProjects++
          if (existsSync(join(tmp, d, 'project', '.git'))) seen.withRepo++
        }
        await Bun.sleep(100)
      }
    })()
    const r = await sh(['make', 'test'], dir, env)
    watching = false
    await watch
    if (r.code !== 0) console.log(r.out.slice(-4000))
    expect(r.code).toBe(0)
    expect(seen.scriptedProjects).toBeGreaterThan(0)
    expect(seen.withRepo).toBeGreaterThan(0)
    expect(status(dir)).toBe(before)
  },
  HOURS,
)
