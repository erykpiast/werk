import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SOURCE = join(import.meta.dir, '..', '..')

export type Out = { code: number; out: string }

/** PATH without any folder that holds a `claude` program. */
export function pathWithoutClaude(): string {
  return (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d && !Bun.spawnSync(['test', '-x', join(d, 'claude')]).success)
    .join(':')
}

export function sh(cmd: string, cwd: string, env: Record<string, string | undefined> = process.env): Out {
  const p = Bun.spawnSync(['/bin/sh', '-c', `${cmd} 2>&1`], { cwd, env: { ...env, CI: 'true' } })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() }
}

export function cloneRepo(): { dir: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-61-'))
  const dir = join(root, 'werk')
  const r = sh(`git clone --quiet --branch main ${JSON.stringify(SOURCE)} ${JSON.stringify(dir)}`, root)
  if (r.code !== 0) throw new Error(`clone failed: ${r.out}`)
  return { dir, done: () => rmSync(root, { recursive: true, force: true }) }
}
