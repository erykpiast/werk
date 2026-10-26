/** Held-out helpers: clone the werk repository into a temporary directory and run commands there. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..')

export type Run = { code: number; stdout: string; stderr: string }

export function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): Run {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() }
}

export function cloneRepo(): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', '--branch', 'main', REPO, dir], root)
  if (r.code !== 0) throw new Error(`clone failed: ${r.stderr}`)
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export const show = (r: Run) => `exit ${r.code}\n--stdout--\n${r.stdout.slice(-3000)}\n--stderr--\n${r.stderr.slice(-3000)}`
