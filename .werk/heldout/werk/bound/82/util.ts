import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..')

export type R = { code: number; out: string }
export function sh(cmd: string, cwd: string, env: Record<string, string | undefined> = process.env): R {
  const r = spawnSync('/bin/bash', ['-c', cmd], { cwd, env: env as NodeJS.ProcessEnv, encoding: 'utf8', maxBuffer: 1 << 28 })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A fresh clone of this repository, at the main branch, with its dependencies installed. */
export function freshClone(install = true): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const r = sh(`git clone -q ${JSON.stringify(REPO)} werk`, root)
  if (r.code !== 0) throw new Error(r.out)
  const dir = join(root, 'werk')
  if (install) {
    const i = sh('bun install --frozen-lockfile && touch node_modules/.installed', dir)
    if (i.code !== 0) throw new Error(i.out)
  }
  return dir
}
