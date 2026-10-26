import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The worktree root (the merged product). */
export const WORKTREE = resolve(import.meta.dir, '..', '..')

export type R = { code: number; out: string }

export function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env, timeoutMs = 900_000): R {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs })
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
}

/** A fresh clone of the worktree repository, on the main branch, in the OS tmpdir. */
export function freshClone(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `werk-61-${tag}-`))
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', '--branch', 'main', WORKTREE, dir], root)
  if (r.code !== 0) throw new Error('clone failed: ' + r.out)
  return dir
}

export const tail = (s: string, n = 3000) => (s.length > n ? s.slice(-n) : s)
