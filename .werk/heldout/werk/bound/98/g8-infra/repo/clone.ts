import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..', '..', '..')

export type Run = { code: number; out: string }

export function sh(cmd: string, cwd: string, env: Record<string, string | undefined> = process.env): Run {
  const p = Bun.spawnSync(['/bin/sh', '-c', `${cmd} 2>&1`], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() }
}

/** A fresh clone of this checkout, at the same commit, in a new temporary folder. */
export function freshClone(): string {
  const head = sh('git rev-parse HEAD', REPO).out.trim()
  const dir = join(mkdtempSync(join(tmpdir(), 'werk-heldout-clone-')), 'werk')
  const r = sh(`git clone -q ${JSON.stringify(REPO)} ${JSON.stringify(dir)} && git -C ${JSON.stringify(dir)} checkout -q ${head}`, REPO)
  if (r.code !== 0) throw new Error(`clone failed: ${r.out}`)
  return dir
}
